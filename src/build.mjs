// Speedrun, step 3: add it all up for the page. Reads data/facts and data/days, writes
// data/speedrun.json. Only scrubbed text reaches this file (no private words, addresses or amounts).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, DEMO, config, dayKey } from './config.mjs';
import { mergeStretches, minutes } from './collect.mjs';
import { sourceById } from './sources/index.mjs';
import { scrub } from './privacy.mjs';

const FLOOR_MIN = 10; // never divide by less than 10 minutes of real time
const ROUTINE_CAP = 3; // routine work shows at most 3x
const MAX_MULT = 100;
const READ_GAP = 10 * 60_000; // a reply read and answered within 10 minutes counts as time at the keyboard

/**
 * Your own time at the keyboard (an estimate): for each message you sent, the stretch since the
 * agent's previous report when you answered within 10 minutes (reading and typing), otherwise 3
 * minutes of typing, plus 1 minute after. Overlapping chats count once. Agents working alone
 * (overnight runs, long builds) are not your time.
 */
export function handsMinutes(f, only = null) {
  const w = [];
  for (const s of f.sessions) {
    if (s.auto || (only && !only.has(s.sid))) continue;
    const outs = s.outcomes.map((o) => o.t).sort((a, b) => a - b);
    let k = 0, prev = null;
    for (const p of s.prompts.filter((q) => !q.kind).sort((a, b) => a.t - b.t)) { // only your own messages
      while (k < outs.length && outs[k] < p.t) prev = outs[k++];
      const start = prev != null && p.t - prev <= READ_GAP ? prev : p.t - 3 * 60_000;
      w.push([start, p.t + 60_000]);
    }
  }
  return minutes(mergeStretches(w));
}

async function readJsonDir(dir) {
  const out = new Map();
  for (const n of (await fsp.readdir(dir).catch(() => [])).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))) {
    try { out.set(n.slice(0, 10), JSON.parse(await fsp.readFile(path.join(dir, n), 'utf8'))); } catch { /* skip a broken file */ }
  }
  return out;
}

function mondayOf(day) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d.getTime());
}

const total = (o) => Object.values(o || {}).reduce((n, v) => n + (Number(v) || 0), 0);

export async function build() {
  const facts = await readJsonDir(path.join(DATA, 'facts'));
  const sums = await readJsonDir(path.join(DATA, 'days'));
  let aliases = {};
  try { aliases = JSON.parse(await fsp.readFile(path.join(DATA, 'aliases.json'), 'utf8')); } catch { /* none yet */ }
  const canon = (n) => aliases[n] || n;
  // The page starts at the first day with a session; the quiet days before it are left out.
  const first = [...facts].sort().find(([, f]) => f.sessions.length)?.[0] || null;

  const today = dayKey(Date.now());
  const days = [];
  for (const [day, f] of [...facts].sort()) {
    if (!first || day < first || day > today) continue;
    const s = sums.get(day);
    const bySid = new Map(f.sessions.filter((x) => !x.auto).map((x) => [x.sid, x])); // automated runs are never timed
    const claims = new Map();
    for (const p of s?.projects || []) for (const sid of p.sessions) claims.set(sid, (claims.get(sid) || 0) + 1);

    const projects = (s?.projects || []).map((p) => {
      const own = p.sessions.filter((sid) => claims.get(sid) === 1 && bySid.has(sid));
      const shared = p.sessions.filter((sid) => claims.get(sid) > 1 && bySid.has(sid));
      let actual = minutes(mergeStretches(own.flatMap((sid) => bySid.get(sid).stretches)));
      for (const sid of shared) actual += bySid.get(sid).activeMinutes / claims.get(sid);
      actual = own.length + shared.length && !p.untracked ? Math.round(actual) : null; // only automated runs: not timed
      let oldMin = Math.round(p.oldWay.hours * 60);
      const base = Math.max(actual ?? 0, FLOOR_MIN);
      if (p.routine && actual != null) oldMin = Math.min(oldMin, Math.round(base * ROUTINE_CAP));
      if (actual != null) oldMin = Math.min(oldMin, base * MAX_MULT); // a ceiling, so one odd log can't run away
      const mult = actual == null ? null : Math.max(1, oldMin / base);
      // "You, before AI": the person alone, learning included, or hiring out. Same 100x ceiling on
      // time, no routine cap (that one belongs to the Pro number). Hire costs are kept as numbers only.
      const y = p.you || null;
      let youMin = y ? Math.round(y.hours * 60) : null;
      if (youMin != null && actual != null) youMin = Math.min(youMin, base * MAX_MULT);
      const you = y ? { mode: y.mode, min: youMin, hireLow: y.hireLow || 0, hireHigh: y.hireHigh || 0, why: y.why || '' } : null;
      return {
        name: canon(p.name), category: p.category, done: p.done, routine: p.routine, untracked: !!p.untracked || actual == null, highlight: p.highlight,
        who: p.oldWay.who, why: p.oldWay.why, oldMin, actualMin: actual, you,
        mult: mult == null ? null : Math.round(mult * 10) / 10,
        savedMin: actual == null ? 0 : Math.max(0, oldMin - actual),
        sessions: p.sessions.length,
      };
    }).sort((a, b) => b.savedMin - a.savedMin);

    // Timeline strip: when work happened, colored by the project it went to.
    const catOf = new Map();
    for (const p of s?.projects || []) for (const sid of p.sessions) if (!catOf.has(sid)) catOf.set(sid, p.category);
    const strip = [];
    for (const x of f.sessions) for (const [a, b] of x.stretches) strip.push([a, b, catOf.get(x.sid) || 'uncounted']);

    const tracked = projects.filter((p) => p.actualMin != null);
    // Agent time for the day: the session stretches behind timed projects, side-by-side chats counted once.
    const timedSids = new Set((s?.projects || []).filter((p) => !p.untracked).flatMap((p) => p.sessions).filter((sid) => bySid.has(sid)));
    const agentMin = minutes(mergeStretches([...timedSids].flatMap((sid) => bySid.get(sid).stretches)));
    const dayOld = tracked.reduce((n, p) => n + p.oldMin, 0);
    const notes = [];
    if (s?.thin) notes.push(s.thinNote || 'Not much was logged this day.');
    days.push({
      day, week: mondayOf(day),
      headline: s?.headline || (f.sessions.length ? '' : 'Nothing logged this day.'),
      thin: !!s?.thin || f.sessions.length < 3,
      notes,
      pending: !s && f.sessions.length > 0,
      activeMin: f.activeMinutes || 0,
      sessionCount: f.sessions.length,
      tokens: total(f.tokens), fresh: total(f.fresh),
      commits: (f.commits || []).length,
      ...youTotals(tracked),
      oldMin: dayOld,
      actualMin: tracked.length ? agentMin : 0,
      savedMin: tracked.length ? Math.max(0, dayOld - agentMin) : 0,
      handsMin: tracked.length ? handsMinutes(f, timedSids) : 0, // the same chats as agent time
      projects, strip,
    });
  }

  // Per project, across days.
  const projMap = new Map();
  for (const d of days) for (const p of d.projects) {
    if (!projMap.has(p.name)) projMap.set(p.name, { name: p.name, category: p.category, days: [], oldMin: 0, actualMin: 0, savedMin: 0, youMin: 0, hireLow: 0, hireHigh: 0, youCount: 0, youMissing: 0, youModes: new Set(), youWhy: '', who: new Set(), done: [], best: null });
    const q = projMap.get(p.name);
    q.days.push(d.day);
    if (p.actualMin != null) {
      q.oldMin += p.oldMin; q.actualMin += p.actualMin; q.savedMin += p.savedMin;
      if (p.you) { q.youMin += p.you.min || 0; q.hireLow += p.you.hireLow; q.hireHigh += p.you.hireHigh; q.youCount++; q.youModes.add(p.you.mode); if (p.you.why) q.youWhy = p.you.why; } else q.youMissing++;
    }
    for (const w of p.who) q.who.add(w);
    for (const line of p.done) q.done.push({ day: d.day, line });
    if (p.mult != null && (!q.best || p.mult > q.best.mult)) q.best = { day: d.day, mult: p.mult };
  }
  const projects = [...projMap.values()].map((q) => ({
    ...q, who: [...q.who].slice(0, 6), done: q.done.slice(-8).reverse(), youModes: [...q.youModes],
    first: q.days[0], last: q.days[q.days.length - 1], dayCount: new Set(q.days).size,
    mult: q.actualMin ? Math.round((q.oldMin / Math.max(q.actualMin, FLOOR_MIN)) * 10) / 10 : null,
  })).sort((a, b) => b.savedMin - a.savedMin);

  // Gold splits: the biggest believable wins (at least two days of old-way work, not routine).
  const gold = [];
  for (const d of days) for (const p of d.projects) {
    if (p.routine || p.mult == null || p.oldMin < 16 * 60) continue;
    gold.push({ day: d.day, name: p.name, category: p.category, oldMin: p.oldMin, actualMin: p.actualMin, mult: p.mult, line: p.highlight || p.done[0], who: p.who, why: p.why, you: p.you });
  }
  gold.sort((a, b) => b.mult - a.mult);

  // Totals and weeks.
  const sum = (list) => {
    const oldMin = list.reduce((n, d) => n + d.oldMin, 0), actualMin = list.reduce((n, d) => n + d.actualMin, 0);
    const yt = { youMin: list.reduce((n, d) => n + d.youMin, 0), hireLow: list.reduce((n, d) => n + d.hireLow, 0), hireHigh: list.reduce((n, d) => n + d.hireHigh, 0), youMissing: list.reduce((n, d) => n + d.youMissing, 0) };
    return { ...yt, handsMin: list.reduce((n, d) => n + (d.handsMin || 0), 0), days: list.length, workDays: list.filter((d) => d.projects.length).length, oldMin, actualMin, savedMin: list.reduce((n, d) => n + d.savedMin, 0), mult: actualMin ? Math.round((oldMin / actualMin) * 10) / 10 : null, items: list.reduce((n, d) => n + d.projects.reduce((m, p) => m + p.done.length, 0), 0), tokens: list.reduce((n, d) => n + d.tokens, 0) };
  };
  const thisWeek = mondayOf(today), thisMonth = today.slice(0, 7);
  const weeks = [];
  for (const w of [...new Set(days.map((d) => d.week))].sort().reverse()) {
    const list = days.filter((d) => d.week === w);
    const top = list.flatMap((d) => d.projects.filter((p) => !p.routine && p.mult != null).map((p) => ({ ...p, day: d.day }))).sort((a, b) => b.savedMin - a.savedMin);
    const cats = {};
    for (const d of list) for (const p of d.projects) cats[p.category] = (cats[p.category] || 0) + p.savedMin;
    weeks.push({ week: w, ...sum(list), top: top.slice(0, 5).map((p) => ({ day: p.day, name: p.name, category: p.category, line: p.highlight || p.done[0], oldMin: p.oldMin, actualMin: p.actualMin, mult: p.mult, you: p.you })), cats, thin: list.filter((d) => d.thin).length });
  }

  // Streak: days in a row (ending today, or yesterday if today is still empty) with real work done.
  const shipped = new Set(days.filter((d) => d.projects.some((p) => !p.routine)).map((d) => d.day));
  let streak = 0;
  const cur = new Date(`${today}T12:00:00`);
  if (!shipped.has(today)) cur.setDate(cur.getDate() - 1);
  while (shipped.has(dayKey(cur.getTime()))) { streak++; cur.setDate(cur.getDate() - 1); }

  const out = {
    builtAt: new Date().toISOString(), start: first || today, today, demo: DEMO,
    categories: { ...config.categories, other: 'Other' },
    tools: config.sources.map((id) => sourceById(id)?.label).filter(Boolean),
    totals: { week: sum(days.filter((d) => d.week === thisWeek)), month: sum(days.filter((d) => d.day.startsWith(thisMonth))), all: sum(days) },
    streak, shippedDays: shipped.size,
    days: days.reverse(), projects, gold: gold.slice(0, 24), weeks,
  };
  const json = scrubDeep(out);
  await fsp.mkdir(DATA, { recursive: true });
  await fsp.writeFile(path.join(DATA, 'speedrun.json.tmp'), JSON.stringify(json));
  await fsp.rename(path.join(DATA, 'speedrun.json.tmp'), path.join(DATA, 'speedrun.json'));
  return json;
}

/** Day totals for "You, before AI". youMissing counts timed projects that have no such estimate. */
function youTotals(tracked) {
  const withYou = tracked.filter((p) => p.you);
  return {
    youMin: withYou.reduce((n, p) => n + (p.you.min || 0), 0),
    hireLow: withYou.reduce((n, p) => n + p.you.hireLow, 0),
    hireHigh: withYou.reduce((n, p) => n + p.you.hireHigh, 0),
    youMissing: tracked.length - withYou.length,
  };
}

/** One last pass over every string (the write-ups were scrubbed already; this catches anything new). */
function scrubDeep(v, key = '') {
  if (typeof v === 'string') return /^(day|week|first|last|today|start|builtAt|category|mode|youModes)$/.test(key) ? v : scrub(v);
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, key));
  if (v && typeof v === 'object') return key === 'categories' || key === 'cats' ? v : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x, k)]));
  return v;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then((j) => console.log(`built: ${j.days.length} days, ${j.projects.length} projects, saved ${Math.round(j.totals.all.savedMin / 60)} h`)).catch((e) => { console.error(e); process.exit(1); });
}
