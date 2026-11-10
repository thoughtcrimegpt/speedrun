// Speedrun, step 2: turn one day's facts into "what got done", grouped by project, with an honest
// "before AI" estimate for each. The write-up comes from the AI you picked (src/ai.mjs).
// Writes data/days/YYYY-MM-DD.json. A finished day is written up once; today is refreshed as it changes.

import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DATA, config, dayKey } from './config.mjs';
import { ask, aiName, parseJson } from './ai.mjs';
import { scrub, privateTerms } from './privacy.mjs';

const FACTS = path.join(DATA, 'facts');
const DAYS = path.join(DATA, 'days');
// Bump to have every day written up again (after changing the instructions below).
export const PROMPT_VERSION = 1;

const clip = (s, n) => { s = String(s || ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const catIds = () => [...Object.keys(config.categories), 'other'];

/** The standing instructions. The "about" text and the categories come from speedrun.config.json. */
export function systemPrompt() {
  const about = config.about.trim()
    ? `About the person (in their own words): ${config.about.trim()}`
    : 'About the person: nothing was provided. Judge what they already know how to do from the work itself, and stay cautious.';
  const renamed = privateTerms().filter(([, rep]) => rep !== '(private)').map(([term, rep]) => `- "${term}" is always written as "${rep}".`).join('\n');
  return `You write one day of a person's "Speedrun" log: what they actually got done that day working with AI coding agents, and an honest estimate of how long the same work would have taken the old way, before AI.

${about}

What to write
- Only work the evidence shows happened that day. Never invent or embellish. Finished results first. Substantial progress on something unfinished can be listed, starting with "Progress:".
- Group by project. When a project matches one in KNOWN PROJECTS, reuse that exact name.
- Leave out chatter, failed attempts that produced nothing, and tiny lookups.
- Each "done" line is one plain-language sentence (max 110 characters), no jargon, no file names, no em dashes. 1 to 8 lines per project: busy projects get more lines, so nothing real is left out.
- Read everything: every request, every agent report, the KEY ACTIONS (the agents' own one-line records of submissions, uploads, saved drafts, deploys and files written) and the PROJECT NOTES. Busy days often have one long main session plus parallel sessions; their work counts too. Count every distinct finished result, not just the last thing discussed.
- Sessions marked "automated runs only" ran on their own (scheduled checks, alerts). Count a real result they produced, but they are not the person's work and not timed. Lines marked "Automatic check-in, not the user" or "Context carried over" are not the person's requests.
- Sessions marked "started by" another session were launched from it as parallel workers: put them in the same project unless their work is clearly a different project. One product, site or client job is one project, even when its work is spread over many sessions.
- Keep descriptions neutral and factual. No judgments about people or content, no venting, nothing embarrassing.

Privacy (strict; this page may end up in a screenshot)
- Never write the names of clients, customers, colleagues or other private people, street addresses, emails, phone numbers, account or ID numbers, prices, salaries, or any amount of money.
- Work for a client gets a generic but distinct project name that describes the job, never who or where: "Client site: bakery", "Invoice tool", "Wedding video edit".
${renamed ? `${renamed}\n` : ''}
Voice: the person reads this page themselves. Talk to them in the second person everywhere ("you", "your"): "You would brief a web developer", "Fixed the checkout bug you reported". Never refer to them by name or as "he", "she", "they" or "the user".

The old-way estimate, "oldWay" (be conservative; it has to be believable)
- hours = focused working hours that competent professionals would need to deliver what was actually delivered that day (only that day's slice, not the whole project). Normal professional pace, not a gold-plated agency. Use the LOW end of the realistic range. Include hand-offs and revisions only modestly.
- who = the roles that would have been hired, e.g. "web developer", "designer", "game developer", "video editor", "copywriter", "data analyst", "bookkeeper", "assistant".
- why = one short sentence on what the old way involved.
- Routine work AI barely speeds up (filling in forms, phone calls, email back-and-forth, scheduling, data entry, approvals, account setup): set routine true and keep hours close to the actual time. Those should show 1x to 3x, never a big number.
- An estimate more than 40 times the actual active time needs a concrete reason in "why".
- Size the estimate to everything delivered that day. A day with many separate results adds up all of them.

The second estimate, "you" = this person alone, before AI (also an estimate; also conservative)
- How long they would have needed without AI, given what the "About the person" text says they can already do. Where it says nothing, assume a capable person who is not a professional in that kind of work.
- mode "self": work they already know how to do. hours = their own focused hours (often close to the professional's, sometimes more).
- mode "learn": they could realistically learn enough to do it. hours = learning time needed for this result (not mastery; count it only on the first day it would be needed for that project) plus doing it at a beginner's pace.
- mode "hire": learning is not realistic for them. hours = only their own time to find, brief and review the hire. hireLow and hireHigh = a rough market cost range in US dollars to hire it out for this day's slice (round numbers, low end of typical freelance rates). Never put amounts of money in any text field.
- mode "mixed": some of each; give hours for their own part and a hire range for the rest.
- why = one short sentence to the person explaining the "you" estimate, in the second person ("You would have had to learn...", "You would brief a web developer and review the fix").
- Use 0 for hireLow and hireHigh unless mode is "hire" or "mixed".
- Actual time is computed from the session timestamps, so list the session ids (like C-1a2b3c4d or X-01a1517f) that did the work for each project. A session can belong to more than one project.

Thin data: if the evidence is too thin to say much (few or unclear sessions), set thin true and give a short reason in thinNote.

Answer with JSON only, no prose and no code fence:
{"headline":"one plain sentence about the day, max 90 characters","thin":false,"thinNote":"","projects":[{"name":"","category":"${catIds().join('|')}","done":[""],"sessions":[""],"oldWay":{"hours":0,"who":[""],"why":""},"you":{"mode":"self|learn|hire|mixed","hours":0,"hireLow":0,"hireHigh":0,"why":""},"routine":false,"untracked":false,"highlight":"optional short phrase for the most impressive item, else empty"}]}`;
}

// ---------- the day's evidence, sized to fit ----------

/** Busy days get a bigger budget instead of a fixed trim (about 4 characters per token). */
export function budgetFor(f) {
  const n = 50_000 + (f.activeMinutes || 0) * 350 + f.sessions.length * 1_500;
  return Math.max(50_000, Math.min(240_000, n));
}

/** Keep n items spread evenly over the day (first and last always kept), instead of only the ends. */
function spread(list, n) {
  if (list.length <= n) return list;
  if (n <= 1) return list.slice(-1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

/** Group "Wrote x / Wrote y" into one line; keep the rest as they are, without repeats. */
function actionLines(actions, lim, len) {
  const writes = actions.filter((a) => a.text.startsWith('Wrote ')).map((a) => a.text.slice(6));
  const rest = [];
  const seen = new Set();
  for (const a of actions) {
    if (a.text.startsWith('Wrote ')) continue;
    const k = a.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    rest.push(a);
  }
  const lines = spread(rest, lim).map((a) => `${hhmm(a.t)} ${clip(a.text, len)}`);
  if (writes.length) lines.push(`wrote or rewrote ${writes.length} files, e.g. ${[...new Set(writes)].slice(0, 8).join(', ')}`);
  return lines;
}

/** What the AI sees for one day. */
export function dossier(f, known, budget = budgetFor(f)) {
  const sids = new Set(f.sessions.map((s) => s.sid));
  // Parallel sessions sit right after the session that started them.
  const order = [];
  const kids = new Map();
  for (const s of f.sessions) if (s.parent && sids.has(s.parent)) { if (!kids.has(s.parent)) kids.set(s.parent, []); kids.get(s.parent).push(s); }
  for (const s of f.sessions) if (!(s.parent && sids.has(s.parent))) { order.push(s); order.push(...(kids.get(s.sid) || [])); }

  const build = (pLim, oLim, aLim, pLen, oLen, aLen, hLen) => {
    const L = [];
    L.push(`DAY ${f.day} (${new Date(`${f.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })})`);
    L.push(`Total active time across all sessions (overlaps counted once): ${f.activeMinutes} min`);
    L.push(`\nKNOWN PROJECTS: ${known.length ? known.join(' | ') : '(none yet)'}`);
    L.push(`\nSESSIONS (${f.sessions.length})`);
    for (const s of order) {
      const first = s.stretches[0][0], last = s.stretches[s.stretches.length - 1][1];
      const parent = s.parent ? ` | started by ${s.parent}${sids.has(s.parent) ? '' : ' on an earlier day'} as a parallel session` : '';
      L.push(`\n[${s.sid}] ${s.tool} | folder: ${s.folder || '?'} | ${s.title ? `title: ${s.title} | ` : ''}${s.auto ? 'automated runs only (scheduled checks or alerts), not timed' : `${s.activeMinutes} active min`}, ${hhmm(first)} to ${hhmm(last)}${parent}`);
      // Repeated automatic check-ins collapse to one line.
      const own = [];
      for (const p of s.prompts) {
        if (p.kind === 'auto' && own.length && own[own.length - 1].kind === 'auto' && own[own.length - 1].text.slice(0, 60) === p.text.slice(0, 60)) { own[own.length - 1].more = (own[own.length - 1].more || 0) + 1; continue; }
        own.push({ ...p });
      }
      const ps = spread(own, pLim), os = spread(s.outcomes, oLim);
      if (ps.length < own.length) L.push(`  (${own.length} requests, ${ps.length} shown, spread over the day)`);
      if (os.length < s.outcomes.length) L.push(`  (${s.outcomes.length} reports, ${os.length} shown, spread over the day)`);
      const said = (p) => p.kind === 'auto' ? `Automatic check-in, not the user${p.more ? ` (repeated ${p.more + 1} times)` : ''}: ${clip(p.text, 160)}` : p.kind === 'meta' ? `Context carried over, not a new request: ${clip(p.text, oLen)}` : `User asked: ${clip(p.text, pLen)}`;
      const items = [...ps.map((p) => ({ t: p.t, line: `  ${hhmm(p.t)} ${said(p)}` })), ...os.map((o) => ({ t: o.t, line: `  ${hhmm(o.t)} Agent reported: ${clip(o.text, oLen)}` }))].sort((a, b) => a.t - b.t);
      for (const it of items) L.push(it.line);
      const acts = actionLines(s.actions || [], aLim, aLen);
      if (acts.length) { L.push(`  KEY ACTIONS (${(s.actions || []).length} recorded):`); for (const a of acts) L.push(`   - ${a}`); }
    }
    if (f.notes?.length) {
      L.push(`\nPROJECT NOTES dated this day (the agents' own records, ${f.notes.length})`);
      for (const h of f.notes) L.push(`- [${h.project}] ${h.head}: ${clip(h.text, hLen)}`);
    }
    if (f.commits?.length) {
      const by = new Map();
      for (const c of f.commits) { if (!by.has(c.repo)) by.set(c.repo, []); by.get(c.repo).push(c.subject); }
      L.push(`\nGIT COMMITS`);
      for (const [repo, subs] of by) L.push(`- ${repo}: ${subs.length} commits, e.g. ${subs.slice(0, 10).join(' / ')}`);
    }
    return L.join('\n');
  };
  // Shorten each item before dropping any. Counts are cut only on the very largest days, and then
  // evenly across the day, never just the middle.
  const tiers = [
    [999, 999, 80, 600, 2400, 160, 4000],
    [999, 999, 60, 450, 1600, 150, 3000],
    [999, 999, 45, 350, 1100, 140, 2200],
    [999, 999, 35, 280, 800, 130, 1600],
    [999, 999, 25, 220, 600, 120, 1200],
    [40, 40, 20, 200, 500, 110, 900],
    [24, 24, 14, 160, 380, 100, 600],
    [14, 12, 8, 120, 260, 90, 400],
  ];
  let text = '';
  for (const t of tiers) { text = build(...t); if (text.length <= budget) break; }
  return text.slice(0, budget);
}

export function fingerprint(f) {
  const basis = JSON.stringify([PROMPT_VERSION, f.sessions.map((s) => [s.sid, s.prompts.length, s.outcomes.length, (s.actions || []).length]), (f.notes || []).length, (f.commits || []).length]);
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12);
}

// ---------- cleaning the answer ----------

const MODES = new Set(['self', 'learn', 'hire', 'mixed']);
const roundCost = (n) => { n = Math.max(0, Number(n) || 0); return n < 1000 ? Math.round(n / 50) * 50 : Math.round(n / 250) * 250; };
const list = (v) => (Array.isArray(v) ? v : []);

/** "You, before AI". Hire costs are kept as numbers only (never in text). */
function youOf(y) {
  if (!y || typeof y !== 'object') return null;
  const mode = MODES.has(y.mode) ? y.mode : 'self';
  let lo = roundCost(y.hireLow), hi = roundCost(y.hireHigh);
  if (mode === 'self' || mode === 'learn') lo = hi = 0;
  if (hi < lo) [lo, hi] = [hi, lo];
  return { mode, hours: Math.max(0, Number(y.hours) || 0), hireLow: lo, hireHigh: hi, why: scrub(clip(String(y.why || ''), 220)) };
}

export function clean(j, f) {
  const sids = new Set(f.sessions.map((s) => s.sid));
  const cats = new Set(catIds());
  const projects = list(j.projects).map((p) => ({
    name: scrub(clip(String(p.name || 'Other').trim(), 60)),
    category: cats.has(p.category) ? p.category : 'other',
    done: list(p.done).slice(0, 8).map((d) => scrub(clip(String(d).trim(), 140))).filter(Boolean),
    sessions: list(p.sessions).map(String).filter((s) => sids.has(s)),
    oldWay: {
      hours: Math.max(0, Number(p.oldWay?.hours) || 0),
      who: list(p.oldWay?.who).slice(0, 4).map((w) => scrub(clip(String(w), 40))),
      why: scrub(clip(String(p.oldWay?.why || ''), 220)),
    },
    you: youOf(p.you),
    routine: !!p.routine,
    untracked: !!p.untracked,
    highlight: scrub(clip(String(p.highlight || ''), 80)),
  })).filter((p) => p.done.length);
  return {
    headline: scrub(clip(String(j.headline || ''), 120)),
    thin: !!j.thin,
    thinNote: scrub(clip(String(j.thinNote || ''), 200)),
    projects,
  };
}

// ---------- writing days up ----------

export async function summarizeDay(day, known) {
  const f = JSON.parse(await fsp.readFile(path.join(FACTS, `${day}.json`), 'utf8'));
  const fp = fingerprint(f);
  if (!f.sessions.length) {
    return { day, fp, model: null, at: new Date().toISOString(), headline: 'Nothing logged this day.', thin: true, thinNote: 'No sessions were found for this day.', projects: [] };
  }
  const text = await ask(systemPrompt(), dossier(f, known));
  return { day, fp, model: aiName(), at: new Date().toISOString(), ...clean(parseJson(text), f) };
}

/** Days whose write-up is missing or out of date, newest first. Past days: when their facts changed. Today: every 30 minutes. */
export async function staleDays() {
  await fsp.mkdir(DAYS, { recursive: true });
  const today = dayKey(Date.now());
  const out = [];
  for (const n of (await fsp.readdir(FACTS).catch(() => [])).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse()) {
    const day = n.slice(0, 10);
    const f = JSON.parse(await fsp.readFile(path.join(FACTS, n), 'utf8'));
    let prev = null;
    try { prev = JSON.parse(await fsp.readFile(path.join(DAYS, n), 'utf8')); } catch { /* not written yet */ }
    if (!prev) { if (f.sessions.length) out.push(day); continue; }
    if (prev.v !== PROMPT_VERSION) { out.push(day); continue; }
    if (prev.fp === fingerprint(f)) continue;
    if (day !== today || Date.now() - Date.parse(prev.at) > 30 * 60_000) out.push(day);
  }
  return out;
}

export async function knownProjects() {
  const names = new Map();
  for (const n of await fsp.readdir(DAYS).catch(() => [])) {
    try { for (const p of JSON.parse(await fsp.readFile(path.join(DAYS, n), 'utf8')).projects) names.set(p.name, (names.get(p.name) || 0) + 1); } catch { /* skip */ }
  }
  let aliases = {};
  try { aliases = JSON.parse(await fsp.readFile(path.join(DATA, 'aliases.json'), 'utf8')); } catch { /* none yet */ }
  const canon = new Map();
  for (const [n, c] of names) { const k = aliases[n] || n; canon.set(k, (canon.get(k) || 0) + c); }
  return [...canon.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([n]) => n);
}

export async function writeDay(s) {
  await fsp.mkdir(DAYS, { recursive: true });
  const file = path.join(DAYS, `${s.day}.json`);
  await fsp.writeFile(file + '.tmp', JSON.stringify({ ...s, v: PROMPT_VERSION }, null, 1));
  await fsp.rename(file + '.tmp', file);
}

/** Write up the given days, a few at a time. */
export async function summarizeMany(days, { concurrency = 2, log = () => {} } = {}) {
  const known = await knownProjects();
  let i = 0, ok = 0;
  const failures = [];
  let lastError = '';
  async function worker() {
    while (i < days.length) {
      const day = days[i++];
      try { await writeDay(await summarizeDay(day, known)); ok++; log(`wrote up ${day}`); }
      catch (e) { failures.push(day); lastError = e.message; log(`could not write up ${day}: ${e.message}`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, days.length) }, worker));
  return { ok, failures, lastError };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
  (async () => {
    if (args[0] === '--dossier') { // print what the AI would see for a day
      const f = JSON.parse(await fsp.readFile(path.join(FACTS, `${args[1]}.json`), 'utf8'));
      console.log(dossier(f, await knownProjects()));
      return;
    }
    if (args[0] === '--instructions') { console.log(systemPrompt()); return; }
    const days = args.length ? args : await staleDays();
    log(`writing up ${days.length} days`);
    console.log(await summarizeMany(days, { log }));
  })().catch((e) => { console.error(e); process.exit(1); });
}
