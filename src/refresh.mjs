// Speedrun: one full update. collect -> write up the days that changed -> merge project names -> build.
// Started by the page server (at most every 30 minutes, in the background, at low priority), or by
// hand: npm run refresh. Only one runs at a time (data/refresh.lock).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, config } from './config.mjs';
import { collect } from './collect.mjs';
import { staleDays, summarizeMany } from './summarize.mjs';
import { ask, parseJson } from './ai.mjs';
import { build } from './build.mjs';
import { scrub } from './privacy.mjs';

const LOCK = path.join(DATA, 'refresh.lock');
const STATUS = path.join(DATA, 'status.json');
const LOG = path.join(DATA, 'refresh.log');

const log = (m) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);

async function setStatus(patch) {
  let s = {};
  try { s = JSON.parse(await fsp.readFile(STATUS, 'utf8')); } catch { /* first run */ }
  Object.assign(s, patch);
  await fsp.writeFile(STATUS + '.tmp', JSON.stringify(s));
  await fsp.rename(STATUS + '.tmp', STATUS);
}

function takeLock() {
  try {
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    try {
      const pid = Number(fs.readFileSync(LOCK, 'utf8'));
      const age = Date.now() - fs.statSync(LOCK).mtimeMs;
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch { /* gone */ }
      if (!alive || age > 3 * 3600_000) { fs.renameSync(LOCK, `${LOCK}.stale`); return takeLock(); }
    } catch { /* someone else just took it */ }
    return false;
  }
}

// ---------- one name per project ----------

const CANON_SYSTEM = `You keep a list of project names consistent. Some names are the same project written differently on different days (for example "Bakery website" and "Bakery site", or "Client site: bakery" and "Bakery client site"). Map each variant to one canonical name, picking the clearest existing name. Only merge names that are clearly the same project; when unsure, keep them separate. Never add names of people, addresses or amounts. Answer with JSON only: {"aliases":{"variant name":"canonical name"}} with only the names that change.`;

async function canonPass() {
  const dir = path.join(DATA, 'days');
  const seen = new Map();
  for (const n of await fsp.readdir(dir).catch(() => [])) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(n)) continue;
    try {
      for (const p of JSON.parse(await fsp.readFile(path.join(dir, n), 'utf8')).projects) {
        if (!seen.has(p.name)) seen.set(p.name, { category: p.category, days: 0, sample: p.done[0] || '' });
        seen.get(p.name).days++;
      }
    } catch { /* skip */ }
  }
  const file = path.join(DATA, 'aliases.json');
  let aliases = {};
  try { aliases = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* none yet */ }
  const checked = new Set(JSON.parse(await fsp.readFile(file + '.checked', 'utf8').catch(() => '[]')));
  const fresh = [...seen.keys()].filter((n) => !checked.has(n));
  if (!fresh.length || seen.size < 2) return;
  const list = [...seen.entries()].map(([n, v]) => `- ${n} [${v.category}, ${v.days} days] e.g. ${v.sample}`).join('\n');
  const j = parseJson(await ask(CANON_SYSTEM, `PROJECT NAMES\n${list}\n\nCurrent aliases: ${JSON.stringify(aliases)}`, 5 * 60_000));
  for (const [a, b] of Object.entries(j.aliases || {})) if (a !== b && seen.has(a)) aliases[a] = scrub(String(b).slice(0, 60));
  // Follow chains (a -> b -> c) to the end.
  for (const k of Object.keys(aliases)) { let v = aliases[k], hops = 0; while (aliases[v] && hops++ < 5) v = aliases[v]; aliases[k] = v; }
  await fsp.writeFile(file, JSON.stringify(aliases, null, 1));
  await fsp.writeFile(file + '.checked', JSON.stringify([...seen.keys()]));
  log(`names: ${Object.keys(aliases).length} aliases`);
}

// ---------- main ----------

export async function refresh() {
  fs.mkdirSync(DATA, { recursive: true });
  if (!takeLock()) return { ok: false, message: 'Another update is already running.' };
  const t0 = Date.now();
  try {
    await setStatus({ running: true, phase: 'Reading sessions', startedAt: new Date().toISOString(), pid: process.pid });
    log('update started');
    await collect({ log });
    const stale = await staleDays();
    const days = stale.slice(0, config.daysPerRun);
    let lastError = null, wrote = 0;
    if (days.length) {
      await setStatus({ phase: `Writing up ${days.length} ${days.length === 1 ? 'day' : 'days'}` });
      // Build after every few days, so a long first run fills the page as it goes.
      for (let i = 0; i < days.length; i += 4) {
        const r = await summarizeMany(days.slice(i, i + 4), { concurrency: 2, log });
        wrote += r.ok;
        if (r.failures.length) lastError = `Could not write up ${r.failures.length === 1 ? r.failures[0] : `${r.failures.length} days`}: ${r.lastError}`;
        await build();
        await setStatus({ phase: `Writing up days (${Math.min(i + 4, days.length)} of ${days.length})` });
        if (!r.ok && i === 0) break; // the AI isn't answering at all: stop instead of failing every day
      }
    }
    if (wrote) { try { await canonPass(); } catch (e) { log(`name pass skipped: ${e.message}`); } }
    await build();
    const left = stale.length - days.length;
    await setStatus({ running: false, phase: '', lastRun: new Date().toISOString(), lastError, waiting: left, lastSeconds: Math.round((Date.now() - t0) / 1000) });
    log(`update done in ${Math.round((Date.now() - t0) / 1000)}s (${wrote} days written up${left ? `, ${left} older days wait for the next update` : ''})`);
    return { ok: !lastError, message: lastError || `Updated: ${wrote} days written up.` };
  } catch (e) {
    log(`update failed: ${e.stack || e.message}`);
    await setStatus({ running: false, phase: '', lastError: e.message, lastRun: new Date().toISOString() });
    return { ok: false, message: e.message };
  } finally {
    try { fs.unlinkSync(LOCK); } catch { /* already gone */ }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { os.setPriority(os.constants.priority.PRIORITY_LOW); } catch { /* not allowed here: run at normal priority */ }
  refresh().then((r) => { console.log(r.message); if (!r.ok) process.exitCode = 1; });
}
