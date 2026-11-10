// Speedrun demo: fills a separate folder (demo-data/) with made-up sample days and opens the page
// on them, so you can see what Speedrun looks like before it reads anything of yours.
// Nothing here touches your session logs, your settings or an AI. Usage: npm run demo

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Always its own folder, never your real data folder (SPEEDRUN_DATA is ignored on purpose).
const OUT = path.resolve(process.env.SPEEDRUN_DEMO_DATA || path.join(ROOT, 'demo-data'));
const MARK = path.join(OUT, '.speedrun-demo');
// The settings are read when config.mjs loads, so they are set before anything is imported.
process.env.SPEEDRUN_DATA = OUT;
process.env.SPEEDRUN_DEMO = '1';
process.env.SPEEDRUN_CONFIG = path.join(OUT, 'no-settings.json'); // defaults only
process.env.SPEEDRUN_TERMS = path.join(OUT, 'no-terms.txt');
process.env.SPEEDRUN_PORT ||= '8798';

// Invented projects for an invented small bakery owner. hours = [low, high] for one day's slice.
const PROJECTS = [
  { name: 'Bakery website', category: 'websites', tool: 'C', folder: 'Projects/bakery-site', hours: [10, 26], who: ['web developer', 'designer'], why: 'A developer would design, build and test each page by hand.',
    you: { mode: 'hire', hours: 2, hire: [800, 2000], why: 'You would brief a web developer and review the pages.' },
    done: ['Built the order-ahead page with pickup times', 'Added a photo gallery for the seasonal menu', 'Fixed the phone menu so it opens on small screens', 'Set up the contact form and its thank-you page', 'Made every page load faster by shrinking the photos'] },
  { name: 'Recipe scaler app', category: 'apps', tool: 'C', folder: 'Projects/recipe-scaler', hours: [12, 30], who: ['app developer'], why: 'An app developer would build the screens, the math and the saved data.',
    you: { mode: 'hire', hours: 2, hire: [1000, 2500], why: 'You would brief an app developer and test each build.' },
    done: ['Built the screen that scales a recipe to any batch size', 'Added conversion between cups, grams and ounces', 'Saved favorite recipes on the device', 'Added a print view for the kitchen wall'] },
  { name: 'Pixel maze game', category: 'games', tool: 'X', folder: 'Projects/pixel-maze', hours: [14, 32], who: ['game developer', 'pixel artist'], why: 'Levels, art and movement rules would each take days of trial and error.',
    you: { mode: 'hire', hours: 3, hire: [1200, 3000], why: 'You would hire a game developer and playtest the levels.' },
    done: ['Built three new maze levels with moving walls', 'Added a level timer and a best-times screen', 'Fixed the bug where the player slipped through corners', 'Drew a new set of wall and floor tiles in code'] },
  { name: 'Launch video', category: 'videos', tool: 'C', folder: 'Projects/launch-video', hours: [8, 18], who: ['video editor', 'motion designer'], why: 'An editor would cut the clip and animate the titles frame by frame.',
    you: { mode: 'mixed', hours: 5, hire: [400, 900], why: 'You could rough-cut the clip yourself but would hire out the animated titles.' },
    done: ['Cut a 40-second launch clip with captions', 'Made animated title cards in code', 'Exported tall and wide versions for different apps'] },
  { name: 'Monthly newsletter', category: 'writing', tool: 'C', folder: 'Projects/newsletter', hours: [3, 7], who: ['copywriter'], why: 'A copywriter would draft, revise and lay out the issue.',
    you: { mode: 'self', hours: 5, hire: [0, 0], why: 'You write to your customers yourself, just more slowly.' },
    done: ['Drafted the newsletter and three subject lines', 'Built the email layout and checked it at phone width', 'Wrote the seasonal specials section'] },
  { name: 'Sales dashboard', category: 'data', tool: 'X', folder: 'Projects/sales-dashboard', hours: [6, 16], who: ['data analyst'], why: 'An analyst would clean the exports by hand and build each chart.',
    you: { mode: 'learn', hours: 14, hire: [0, 0], why: 'You would have had to learn spreadsheet formulas and charts first.' },
    done: ['Combined a year of order exports into one clean sheet', 'Charted best sellers by month', 'Flagged the slow weekdays and the busiest hours'] },
  { name: 'Logo and menu refresh', category: 'design', tool: 'C', folder: 'Projects/menu-refresh', hours: [8, 20], who: ['designer'], why: 'A designer would redraw the mark and typeset the menu over several rounds.',
    you: { mode: 'hire', hours: 2, hire: [600, 1500], why: 'You would brief a designer and pick between drafts.' },
    done: ['Redrew the logo as a clean file that prints at any size', 'Laid out the new printed menu', 'Made matching price cards for the display case'] },
  { name: 'Bookkeeping cleanup', category: 'admin', tool: 'C', folder: 'Projects/books', hours: [1, 2], routine: true, who: ['bookkeeper'], why: 'Sorting and form filling take about as long either way.',
    you: { mode: 'self', hours: 1.5, hire: [0, 0], why: 'You already do this yourself each month.' },
    done: ['Sorted last month\'s receipts into categories', 'Filled in the supplier order forms', 'Matched the card statement against the receipts'] },
];
const HEADLINES = ['A strong building day across the shop\'s projects.', 'Steady progress, with one big jump.', 'Short sessions, real results.', 'Several things finished and handed over.', 'A focused day on one project.'];

// A small repeatable random number generator, so the demo looks the same on every computer.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeDays(dayKey) {
  const rand = rng(20260101);
  const between = (lo, hi) => lo + rand() * (hi - lo);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const hex = () => Array.from({ length: 8 }, () => Math.floor(rand() * 16).toString(16)).join('');
  const out = [];
  for (let back = 27; back >= 0; back--) {
    const noon = new Date(); noon.setHours(12, 0, 0, 0); noon.setDate(noon.getDate() - back);
    const day = dayKey(noon.getTime());
    const midnight = new Date(noon); midnight.setHours(0, 0, 0, 0);
    const facts = { day, sessions: [], tokens: {}, fresh: {}, notes: [], commits: [] };
    const sum = { day, fp: 'sample', model: 'sample', at: new Date().toISOString(), v: 1, headline: '', thin: false, thinNote: '', projects: [] };
    const quiet = back > 3 && rand() < 0.2; // a few days off, but none in the last few days
    const count = quiet ? 0 : 1 + Math.floor(rand() * 3);
    const chosen = [...PROJECTS].sort(() => rand() - 0.5).slice(0, count);
    let clock = midnight.getTime() + between(8, 10) * 3600_000;
    for (const p of chosen) {
      const len = Math.round(between(p.routine ? 25 : 14, p.routine ? 50 : 75)) * 60_000;
      const a = Math.round(clock), b = a + len;
      if (back === 0 && b > Date.now()) break; // nothing in the future
      clock = b + between(20, 150) * 60_000;
      const sid = `${p.tool}-${hex()}`;
      const src = p.tool === 'C' ? 'claude-code' : 'codex';
      const lines = [...p.done].sort(() => rand() - 0.5).slice(0, 1 + Math.floor(rand() * 3));
      facts.sessions.push({
        sid, tool: p.tool === 'C' ? 'Claude Code' : 'Codex', title: p.name, folder: p.folder,
        stretches: [[a, b]], activeMinutes: Math.round(len / 60_000), autoMinutes: 0,
        prompts: [{ t: a, text: 'Sample request' }, { t: Math.round(a + len * 0.5), text: 'Sample follow-up' }],
        outcomes: [{ t: Math.round(a + len * 0.45), text: 'Sample report' }, { t: b, text: 'Sample report' }],
        actions: [],
      });
      const tok = Math.round(between(400_000, 6_000_000));
      facts.tokens[src] = (facts.tokens[src] || 0) + tok;
      facts.fresh[src] = (facts.fresh[src] || 0) + Math.round(tok * 0.12);
      facts.commits.push({ day, repo: p.folder, subject: 'Sample commit' });
      sum.projects.push({
        name: p.name, category: p.category, done: lines, sessions: [sid],
        oldWay: { hours: Math.round(between(...p.hours)), who: p.who, why: p.why },
        you: { mode: p.you.mode, hours: p.you.hours, hireLow: p.you.hire[0], hireHigh: p.you.hire[1], why: p.you.why },
        routine: !!p.routine, untracked: false, highlight: '',
      });
    }
    facts.activeMinutes = facts.sessions.reduce((n, s) => n + s.activeMinutes, 0);
    sum.headline = facts.sessions.length ? pick(HEADLINES) : 'Nothing logged this day.';
    out.push({ day, facts, sum: facts.sessions.length ? sum : null });
  }
  return out;
}

export async function makeDemo() {
  const { dayKey } = await import('./config.mjs');
  const { build } = await import('./build.mjs');
  // Sample data only, rebuilt on every start. Refuse to clear a folder the demo did not make.
  if (fs.existsSync(OUT) && fs.readdirSync(OUT).length && !fs.existsSync(MARK)) throw new Error(`${OUT} is not a demo folder. Pick another SPEEDRUN_DEMO_DATA.`);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'facts'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'days'), { recursive: true });
  fs.writeFileSync(MARK, 'Made-up sample data for the Speedrun demo. Safe to remove.\n');
  for (const d of makeDays(dayKey)) {
    fs.writeFileSync(path.join(OUT, 'facts', `${d.day}.json`), JSON.stringify(d.facts));
    if (d.sum) fs.writeFileSync(path.join(OUT, 'days', `${d.day}.json`), JSON.stringify(d.sum));
  }
  return build();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const j = await makeDemo();
  if (process.argv.includes('--build-only')) {
    console.log(`Sample data built: ${j.days.length} days, ${j.projects.length} projects.`);
  } else {
    const { start } = await import('./server.mjs');
    const server = await start();
    console.log(`Speedrun demo (made-up sample data) is running at http://127.0.0.1:${server.address().port}/  (Ctrl+C stops it)`);
  }
}
