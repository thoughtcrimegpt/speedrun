// Speedrun, step 1: collect what happened each day from the logs already on this computer.
// Reads only. Never changes a log, a note or a repository.
//
// Sources: the session logs of your AI coding tools (src/sources/), git commits you made, and
// optional dated note files. Each log is parsed once and cached by size and modified time, so
// later runs only read the files that changed. Writes data/facts/YYYY-MM-DD.json, one per day.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA, HOME, config, startDay, dayKey, folderLabel, isAutoCwd } from './config.mjs';
import { SOURCES, sourceById } from './sources/index.mjs';
import { clip } from './sources/shared.mjs';

// Bump when a reader keeps more from each log. Files still on disk are read again; files the
// tools already deleted keep what was read before (never lost).
const PARSER = 1;
const GAP_MS = 10 * 60_000; // a pause longer than this ends an active stretch

// ---------- active stretches ----------

/** Sorted timestamps -> [[start, end], ...], split at local midnight. */
function stretches(times) {
  const out = [];
  let s = null, e = null;
  for (const t of times) {
    if (s === null) { s = e = t; continue; }
    if (t - e > GAP_MS) { out.push([s, Math.max(e, s + 60_000)]); s = e = t; } else e = t;
  }
  if (s !== null) out.push([s, Math.max(e, s + 60_000)]);
  const split = [];
  for (let [a, b] of out) {
    while (dayKey(a) !== dayKey(b)) {
      const d = new Date(a); d.setHours(24, 0, 0, 0);
      split.push([a, d.getTime()]); a = d.getTime();
    }
    split.push([a, b]);
  }
  return split;
}

export function mergeStretches(list) {
  const s = [...list].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}

export const minutes = (st) => Math.round(st.reduce((n, [a, b]) => n + (b - a), 0) / 60_000);

// ---------- git commits and dated notes ----------

function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => execFile(cmd, args, { maxBuffer: 32 << 20, timeout: 30_000, windowsHide: true, ...opts }, (err, out) => resolve(err ? '' : out)));
}

// A repository's own settings can name programs for git to run (for example a signature checker
// while reading the history). Speedrun only reads commit subjects, so it switches those off: a
// folder someone else made can't get a program started on your computer through Speedrun.
const SAFE_GIT = ['-c', 'log.showSignature=false', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'gpg.program=', '-c', 'gpg.ssh.program=', '-c', 'gpg.x509.program='];
const git = (args, opts) => sh('git', [...SAFE_GIT, ...args], opts);

/** Repositories under the folders in "roots", plus the ones your sessions ran in (or just above). */
async function gitRepos(cwds) {
  const repos = new Set();
  async function find(dir, depth) {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    if (ents.some((e) => e.name === '.git')) repos.add(dir);
    if (depth >= 3) return;
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
      await find(path.join(dir, e.name), depth + 1);
    }
  }
  for (const r of config.roots) await find(r, 0);
  for (const cwd of cwds) {
    if (!fs.existsSync(cwd)) continue;
    const top = (await git(['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 10_000 })).trim();
    if (top) repos.add(path.resolve(top));
    // A session started in a folder of projects works in the repositories below it.
    else if (path.resolve(cwd) !== HOME) await find(cwd, 0);
  }
  return [...repos];
}

/** Your own commits (the repository's configured author), so shared repositories don't add other people's work. */
async function commits(repos, start, startMs) {
  const out = [];
  const seen = new Set();
  for (const repo of repos) {
    const email = (await git(['-C', repo, 'config', 'user.email'], { timeout: 10_000 })).trim();
    const args = ['-C', repo, 'log', '--all', '--no-merges', '--no-show-signature', `--since=${start}T00:00:00`, '--format=%H%x09%at%x09%s'];
    if (email) args.push(`--author=${email}`);
    const log = await git(args, { timeout: 15_000 });
    for (const line of log.split('\n')) {
      const [h, at, s] = line.split('\t');
      if (!h || seen.has(h)) continue;
      seen.add(h);
      const t = Number(at) * 1000;
      if (t < startMs) continue;
      out.push({ day: dayKey(t), repo: folderLabel(repo), subject: clip(s, 140) });
    }
  }
  return out;
}

/** Optional note files with "## YYYY-MM-DD ..." headings (set "notes" in the settings). */
async function notes(repos, start, startMs) {
  const out = [];
  for (const repo of repos) {
    for (const rel of config.notes) {
      const f = path.join(repo, rel);
      const st = await fsp.stat(f).catch(() => null);
      if (!st || st.mtimeMs < startMs) continue;
      const text = await fsp.readFile(f, 'utf8').catch(() => '');
      for (const part of text.split(/^(?=##\s)/m)) {
        const m = part.match(/^##\s+(?:\D{0,12})?(\d{4}-\d{2}-\d{2})([^\n]*)\n([\s\S]*)$/);
        if (!m || m[1] < start) continue;
        out.push({ day: m[1], project: folderLabel(repo), head: clip(m[2].replace(/^[\s,:(]+|[)\s]+$/g, ''), 160), text: clip(m[3], 4000) });
      }
    }
  }
  return out;
}

// ---------- main ----------

export async function collect({ log = () => {} } = {}) {
  const START = startDay();
  const START_MS = new Date(`${START}T00:00:00`).getTime();
  const CACHE_FILE = path.join(DATA, 'cache', 'files.json');
  const FACTS = path.join(DATA, 'facts');
  await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fsp.mkdir(FACTS, { recursive: true });
  let cache = {};
  try { cache = JSON.parse(await fsp.readFile(CACHE_FILE, 'utf8')); } catch { /* first run */ }

  const sources = config.sources.map(sourceById).filter(Boolean);
  const unknown = config.sources.filter((id) => !sourceById(id));
  if (unknown.length) log(`unknown sources skipped: ${unknown.join(', ')} (known: ${SOURCES.map((s) => s.id).join(', ')})`);

  // AI tools delete old logs (Claude Code after about 30 days). Keep what was already read, so
  // past days never lose their history.
  const next = {};
  for (const [f, v] of Object.entries(cache)) next[f] = fs.existsSync(f) ? v : { ...v, gone: true };
  let parsed = 0;
  for (const src of sources) {
    const ctx = src.prepare ? await src.prepare() : null;
    for (const f of await src.files(START)) {
      const st = await fsp.stat(f).catch(() => null);
      if (!st || st.mtimeMs < START_MS) continue;
      const key = `${src.id}:p${PARSER}:${st.size}:${Math.round(st.mtimeMs)}`;
      if (cache[f]?.key === key) { src.touch?.(next[f].r, ctx); continue; }
      let r;
      try { r = await src.parse(f, ctx); } catch (e) { log(`could not read ${path.basename(f)}: ${e.message}`); continue; }
      r.times = stretches(r.times.sort((a, b) => a - b)); // store stretches, not every timestamp
      r.autoTimes = stretches((r.autoTimes || []).sort((a, b) => a - b));
      delete r.mode;
      next[f] = { key, r };
      parsed++;
      if (parsed % 50 === 0) log(`read ${parsed} session logs`);
    }
  }
  await fsp.writeFile(CACHE_FILE + '.tmp', JSON.stringify(next));
  await fsp.rename(CACHE_FILE + '.tmp', CACHE_FILE);
  log(`session logs: ${Object.keys(next).length} known, ${parsed} read this time`);

  // Merge files into sessions (helper agents fold into their parent session).
  const on = new Set(sources.map((s) => s.id));
  const sessions = new Map();
  for (const { r } of Object.values(next)) {
    if (!on.has(r.kind)) continue;
    const id = r.sub && r.parent ? r.parent : r.session;
    const key = `${r.kind}:${id}`;
    if (!sessions.has(key)) sessions.set(key, { kind: r.kind, id, title: '', cwd: '', stretches: [], autoStretches: [], tokens: {}, fresh: {}, prompts: [], outcomes: [], actions: [], spawned: [] });
    const s = sessions.get(key);
    if (!r.sub) { s.title = r.title || s.title; s.cwd = r.cwd || s.cwd; }
    else if (!s.cwd) s.cwd = r.cwd;
    if (r.guardian) s.guardianOnly = s.guardianOnly ?? true; else s.guardianOnly = false;
    s.stretches.push(...r.times);
    s.autoStretches.push(...(r.autoTimes || []));
    for (const [d, n] of Object.entries(r.tokens)) s.tokens[d] = (s.tokens[d] || 0) + n;
    for (const [d, n] of Object.entries(r.fresh || {})) s.fresh[d] = (s.fresh[d] || 0) + n;
    s.prompts.push(...r.prompts);
    s.outcomes.push(...r.outcomes);
    s.actions.push(...(r.actions || []));
    s.spawned.push(...(r.spawned || []));
  }
  const sidOf = (s) => `${sourceById(s.kind).prefix}-${String(s.id).slice(0, 8)}`;

  // Parallel sessions: a session started by another one carries the title it was given.
  // Link it to the session that started it, so both count toward the same project.
  const byTitle = new Map();
  for (const s of sessions.values()) for (const title of s.spawned) byTitle.set(title.trim().toLowerCase(), s);
  for (const s of sessions.values()) {
    const parent = s.title && byTitle.get(s.title.trim().toLowerCase());
    if (parent && parent !== s) s.parentSid = sidOf(parent);
  }

  const days = new Map();
  const day = (d) => {
    if (!days.has(d)) days.set(d, { day: d, sessions: [], tokens: {}, fresh: {}, notes: [], commits: [] });
    return days.get(d);
  };
  const cwds = new Set();
  for (const s of sessions.values()) {
    const auto = isAutoCwd(s.cwd) || s.guardianOnly;
    for (const [d, n] of Object.entries(s.tokens)) if (d >= START) day(d).tokens[s.kind] = (day(d).tokens[s.kind] || 0) + n;
    for (const [d, n] of Object.entries(s.fresh)) if (d >= START) day(d).fresh[s.kind] = (day(d).fresh[s.kind] || 0) + n;
    if (auto) continue;
    if (s.cwd) cwds.add(s.cwd);
    const byDay = new Map();
    for (const [list, key] of [[s.stretches, 'stretches'], [s.autoStretches, 'autoStretches']]) {
      for (const [a, b] of list) {
        const d = dayKey(a);
        if (d < START) continue;
        if (!byDay.has(d)) byDay.set(d, { stretches: [], autoStretches: [], prompts: [], outcomes: [], actions: [] });
        byDay.get(d)[key].push([a, b]);
      }
    }
    for (const p of s.prompts) { const d = dayKey(p.t); if (byDay.has(d)) byDay.get(d).prompts.push(p); }
    for (const p of s.outcomes) { const d = dayKey(p.t); if (byDay.has(d)) byDay.get(d).outcomes.push(p); }
    for (const p of s.actions) { const d = dayKey(p.t); if (byDay.has(d)) byDay.get(d).actions.push(p); }
    for (const [d, v] of byDay) {
      if (!v.prompts.length && !v.outcomes.length && !v.actions.length) continue; // background noise only, nothing asked, answered or done
      // A session that only ran automatic turns this day: shown as automated and never timed.
      const autoOnly = !v.stretches.length || (v.prompts.length > 0 && v.prompts.every((p) => p.kind === 'auto'));
      day(d).sessions.push({
        sid: sidOf(s),
        tool: sourceById(s.kind).label,
        title: clip(s.title, 120),
        folder: folderLabel(s.cwd),
        stretches: mergeStretches(autoOnly ? [...v.stretches, ...v.autoStretches] : v.stretches),
        ...(autoOnly ? { auto: true } : {}),
        autoMinutes: minutes(mergeStretches(v.autoStretches)),
        prompts: v.prompts.sort((a, b) => a.t - b.t),
        outcomes: v.outcomes.sort((a, b) => a.t - b.t),
        actions: v.actions.sort((a, b) => a.t - b.t),
        ...(s.parentSid ? { parent: s.parentSid } : {}),
      });
    }
  }
  // Notes and commits only count on days with sessions: Speedrun is about work done with the agents.
  const worked = (d) => (days.get(d)?.sessions.length || 0) > 0;
  const repos = await gitRepos(cwds);
  for (const n of await notes(repos, START, START_MS)) if (worked(n.day)) day(n.day).notes.push(n);
  for (const c of await commits(repos, START, START_MS)) if (worked(c.day)) day(c.day).commits.push(c);
  // Every day gets a facts file, quiet days included.
  for (const t = new Date(`${START}T12:00:00`); dayKey(t.getTime()) <= dayKey(Date.now()); t.setDate(t.getDate() + 1)) day(dayKey(t.getTime()));

  const today = dayKey(Date.now());
  const written = [];
  for (const d of [...days.values()].sort((a, b) => a.day.localeCompare(b.day))) {
    if (d.day < START || d.day > today) continue;
    d.sessions.sort((a, b) => a.stretches[0][0] - b.stretches[0][0]);
    d.activeMinutes = minutes(mergeStretches(d.sessions.filter((s) => !s.auto).flatMap((s) => s.stretches)));
    for (const s of d.sessions) s.activeMinutes = minutes(s.stretches);
    await fsp.writeFile(path.join(FACTS, `${d.day}.json`), JSON.stringify(d));
    written.push(d.day);
  }
  log(`facts written for ${written.length} days`);
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  collect({ log: (m) => console.log(`${new Date().toISOString()} ${m}`) })
    .then((d) => console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${d.length} days`))
    .catch((e) => { console.error(e); process.exit(1); });
}
