// Speedrun self-check. Runs the whole thing the way a stranger's computer would: a pretend, empty
// home folder with made-up session logs, a stand-in AI, and a throwaway data folder. It never
// reads your real logs, your settings or a real AI. Usage: npm test   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speedrun-check-'));
const home = path.join(tmp, 'home'), data = path.join(tmp, 'data'), repo = path.join(tmp, 'work', 'garden-notes');
// Settings are read when the code loads, so the pretend ones are in place before any import.
process.env.SPEEDRUN_HOME = home;
process.env.SPEEDRUN_DATA = data;
process.env.SPEEDRUN_CONFIG = path.join(tmp, 'speedrun.config.json');
process.env.SPEEDRUN_TERMS = path.join(tmp, 'private-terms.txt');
delete process.env.SPEEDRUN_DEMO;
delete process.env.SPEEDRUN_PORT;

let failed = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); if (!ok) failed++; };

// ---------- a pretend computer ----------

const dayStart = new Date(); dayStart.setDate(dayStart.getDate() - 2); dayStart.setHours(10, 0, 0, 0);
const t0 = dayStart.getTime();
const at = (min) => new Date(t0 + min * 60_000).toISOString();
const pad = (n) => String(n).padStart(2, '0');
const DAY = `${dayStart.getFullYear()}-${pad(dayStart.getMonth() + 1)}-${pad(dayStart.getDate())}`;
const lines = (list) => list.map((o) => JSON.stringify(o)).join('\n') + '\n';
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

const C_ID = 'aaaaaaaa-1111-4111-8111-111111111111', X_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const usage = (n) => ({ input_tokens: n, output_tokens: n, cache_creation_input_tokens: 0, cache_read_input_tokens: n * 4 });
const claudeDir = path.join(home, '.claude', 'projects', '-home-sample-projects-garden-site');
const claudeFile = path.join(claudeDir, `${C_ID}.jsonl`);
put(claudeFile, lines([
  { type: 'user', timestamp: at(0), cwd: '/home/sample/projects/garden-site', message: { role: 'user', content: 'Build a landing page for the garden shop' } },
  { type: 'assistant', timestamp: at(1), message: { id: 'msg_1', role: 'assistant', usage: usage(1000), content: [{ type: 'text', text: 'Working on it.' }, { type: 'tool_use', name: 'Write', input: { file_path: '/home/sample/projects/garden-site/index.html' } }] } },
  { type: 'user', timestamp: at(2), message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
  { type: 'assistant', timestamp: at(6), message: { id: 'msg_2', role: 'assistant', usage: usage(500), content: [{ type: 'text', text: 'Done: the landing page is built and opens on phones.' }] } },
  { type: 'user', timestamp: at(8), message: { role: 'user', content: 'Make the header green' } },
  { type: 'assistant', timestamp: at(12), message: { id: 'msg_3', role: 'assistant', usage: usage(200), content: [{ type: 'text', text: 'The header is green now.' }] } },
  { type: 'user', timestamp: at(60), message: { role: 'user', content: '<scheduled-task name="nightly">Check the site is up</scheduled-task>' } },
  { type: 'assistant', timestamp: at(61), message: { id: 'msg_4', role: 'assistant', usage: usage(100), content: [{ type: 'text', text: 'The site is up.' }] } },
]));
put(path.join(claudeDir, C_ID, 'subagents', 'agent-1.jsonl'), lines([
  { type: 'assistant', timestamp: at(3), isSidechain: true, message: { id: 'msg_s1', role: 'assistant', usage: usage(300), content: [{ type: 'text', text: 'Helper: checked the images.' }] } },
]));
// A session that ran in a temporary folder is an automated call, not the person's work.
put(path.join(home, '.claude', 'projects', '-tmp-job', 'cccccccc-3333-4333-8333-333333333333.jsonl'), lines([
  { type: 'user', timestamp: at(30), cwd: path.join(os.tmpdir(), 'job'), message: { role: 'user', content: 'Summarize this' } },
  { type: 'assistant', timestamp: at(31), message: { id: 'msg_a1', role: 'assistant', usage: usage(50), content: [{ type: 'text', text: 'Summary.' }] } },
]));
put(path.join(home, '.codex', 'sessions', String(dayStart.getFullYear()), pad(dayStart.getMonth() + 1), pad(dayStart.getDate()), `rollout-${DAY}T10-05-00-${X_ID}.jsonl`), lines([
  { timestamp: at(5), type: 'session_meta', payload: { id: X_ID, timestamp: at(5), cwd: '/home/sample/projects/recipe-app' } },
  { timestamp: at(5), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Add a unit converter' }] } },
  { timestamp: at(7), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 4000, cached_input_tokens: 1000, output_tokens: 1000, total_tokens: 5000 }, last_token_usage: { input_tokens: 4000, cached_input_tokens: 1000, output_tokens: 1000, total_tokens: 5000 } } } },
  { timestamp: at(9), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["bash","-lc","git push origin main"]}' } },
  { timestamp: at(17), type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'Added the converter between cups and grams.' } },
]));
put(path.join(home, '.codex', 'session_index.jsonl'), lines([{ id: X_ID, thread_name: 'Unit converter' }]));

// Claude Cowork keeps its sessions in the desktop app's data folder. The next day: one session with
// a helper agent, one started by a scheduled task, and look-alike files that are not transcripts.
const W_ID = 'dddddddd-4444-4444-8444-444444444444', W2_ID = 'eeeeeeee-5555-4555-8555-555555555555';
const at2 = (min) => at(24 * 60 + min);
const next = new Date(t0 + 24 * 60 * 60_000);
const DAY2 = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
const coworkStore = path.join(home, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
const coworkSpace = path.join(coworkStore, 'account-0000', 'workspace-0000');
const coworkLog = path.join(coworkSpace, 'local_one', '.claude', 'projects', '-sessions-quiet-fern');
put(path.join(coworkSpace, 'local_one.json'), JSON.stringify({ sessionId: 'local_one', cliSessionId: W_ID, sessionType: 'cowork', title: 'Spring plant order', cwd: '/sessions/quiet-fern', userSelectedFolders: ['/home/sample/work/orders'] }));
put(path.join(coworkLog, `${W_ID}.jsonl`), lines([
  { type: 'user', timestamp: at2(0), cwd: '/sessions/quiet-fern', message: { role: 'user', content: 'Turn the supplier price lists into one order sheet' } },
  { type: 'assistant', timestamp: at2(1), message: { id: 'msg_w1', role: 'assistant', usage: usage(400), content: [{ type: 'text', text: 'Reading the price lists.' }, { type: 'tool_use', name: 'Write', input: { file_path: '/sessions/quiet-fern/mnt/orders/order-sheet.csv' } }] } },
  { type: 'assistant', timestamp: at2(9), message: { id: 'msg_w2', role: 'assistant', usage: usage(100), content: [{ type: 'text', text: 'Done: the order sheet lists every plant with its cheapest supplier.' }] } },
]));
put(path.join(coworkLog, W_ID, 'subagents', 'agent-1.jsonl'), lines([
  { type: 'assistant', timestamp: at2(3), isSidechain: true, message: { id: 'msg_w3', role: 'assistant', usage: usage(50), content: [{ type: 'text', text: 'Helper: compared two price lists.' }] } },
]));
put(path.join(coworkSpace, 'local_two.json'), JSON.stringify({ sessionId: 'local_two', cliSessionId: W2_ID, sessionType: 'scheduled', title: 'Weekly stock check' }));
put(path.join(coworkSpace, 'local_two', '.claude', 'projects', '-sessions-calm-moss', `${W2_ID}.jsonl`), lines([
  { type: 'user', timestamp: at2(30), cwd: '/sessions/calm-moss', message: { role: 'user', content: 'Check which plants are low on stock' } },
  { type: 'assistant', timestamp: at2(34), message: { id: 'msg_w4', role: 'assistant', usage: usage(20), content: [{ type: 'text', text: 'Three plants are low.' }] } },
]));
const stray = lines([{ type: 'user', timestamp: at2(40), message: { role: 'user', content: 'Not a session' } }]);
put(path.join(coworkSpace, 'local_one', 'outputs', 'export.jsonl'), stray);
put(path.join(coworkStore, 'skills-plugin', 'workspace-0000', 'notes.jsonl'), stray);

// A repository with one commit of "ours" and one by someone else, plus a dated note file.
let hasGit = true;
try {
  fs.mkdirSync(repo, { recursive: true });
  const git = (args, env = {}) => execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: at(30), GIT_COMMITTER_DATE: at(30), ...env }, stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'me@example.com']); git(['config', 'user.name', 'Me']); git(['config', 'commit.gpgsign', 'false']);
  put(path.join(repo, 'NOTES.md'), `# Notes\n\n## ${DAY} Shipped the landing page\n\nThe page went live after the header fix.\n`);
  git(['add', '.']); git(['commit', '-q', '-m', 'Add the landing page']);
  put(path.join(repo, 'other.txt'), 'x');
  git(['add', '.']); git(['-c', 'user.email=someone@example.com', '-c', 'user.name=Someone', 'commit', '-q', '-m', 'Work by someone else']);
} catch { hasGit = false; }

// A booby-trapped repository: its own settings name a "signature checker" program and it holds a
// signed-looking commit, so a plain `git log` there would start that program. Reading it must not.
const trapMark = path.join(tmp, 'trap-ran');
let hasTrap = false;
if (hasGit && process.platform !== 'win32') {
  try {
    const trap = path.join(path.dirname(repo), 'downloaded-thing');
    fs.mkdirSync(trap, { recursive: true });
    const tg = (args, input) => execFileSync('git', ['-C', trap, ...args], { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    tg(['init', '-q']);
    tg(['config', 'user.email', 'me@example.com']);
    const tree = tg(['write-tree']);
    const stamp = Math.floor((t0 - 86_400_000) / 1000); // a day with no sessions, so it never counts as work
    const commit = tg(['hash-object', '-t', 'commit', '-w', '--stdin'], `tree ${tree}\nauthor Me <me@example.com> ${stamp} +0000\ncommitter Me <me@example.com> ${stamp} +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n x\n -----END PGP SIGNATURE-----\n\nTrap commit\n`);
    tg(['update-ref', 'HEAD', commit]);
    const evil = path.join(tmp, 'evil.sh');
    put(evil, `#!/bin/sh\ntouch "${trapMark}"\n`);
    fs.chmodSync(evil, 0o755);
    tg(['config', 'log.showSignature', 'true']);
    tg(['config', 'gpg.program', evil]);
    hasTrap = true;
  } catch { /* git too old to build the trap: check skipped */ }
}

put(process.env.SPEEDRUN_CONFIG, JSON.stringify({
  about: 'I run a small garden shop and do not code.',
  ai: { provider: 'command', command: [process.execPath, path.join(ROOT, 'test', 'fake-ai.mjs')] },
  roots: [path.dirname(repo)], notes: ['NOTES.md'],
}));
put(process.env.SPEEDRUN_TERMS, '# made-up private words\nZebulon Quince => a client\nQuince\n');

const { config, folderLabel, isAutoCwd } = await import('../src/config.mjs');
const { scrub, leaks } = await import('../src/privacy.mjs');
const { collect } = await import('../src/collect.mjs');
const { dossier, systemPrompt, clean } = await import('../src/summarize.mjs');
const { handsMinutes } = await import('../src/build.mjs');
const { refresh } = await import('../src/refresh.mjs');
const { ask, parseJson } = await import('../src/ai.mjs');
const { start } = await import('../src/server.mjs');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// ---------- privacy filter ----------

for (const [input, banned] of [
  ['Deck for 4321 N Sample Road, $6.5M, due Friday', ['4321', 'Sample', '$']],
  ['Email pat.sample@example.com or call 555-010-0142', ['@', '555-010']],
  ['Pages for Zebulon Quince and Quince\'s team', ['Zebulon', 'Quince']],
]) {
  const out = scrub(input);
  check(banned.every((b) => !out.includes(b)), `scrub hides private details: "${input.slice(0, 40)}..."`, out);
}
check(scrub('Built 24 levels and 1,200 lines in the Morning') === 'Built 24 levels and 1,200 lines in the Morning', 'scrub leaves ordinary text alone');
check(!scrub('one — two').includes('—'), 'no em dashes');
check(folderLabel('/home/sample/projects/garden-site') === 'projects/garden-site' && folderLabel(home) === 'Home folder', 'folders get short, readable labels');
check(isAutoCwd(path.join(os.tmpdir(), 'job')) && isAutoCwd(path.join(data, 'work')) && !isAutoCwd('/home/sample/projects/garden-site'), 'temporary folders and Speedrun\'s own count as automated');

// ---------- reading the session logs ----------

await collect();
const factsFile = path.join(data, 'facts', `${DAY}.json`);
const f = readJson(factsFile);
const c = f.sessions.find((s) => s.sid === 'C-aaaaaaaa'), x = f.sessions.find((s) => s.sid === 'X-bbbbbbbb');
check(f.sessions.length === 2 && !!c && !!x, 'finds the Claude Code and Codex sessions, and skips the automated one', f.sessions.map((s) => s.sid).join(', '));
check(f.activeMinutes === 17, 'side-by-side sessions count once (10:00 to 10:17)', `${f.activeMinutes} min`);
check(c?.activeMinutes === 12 && c?.autoMinutes === 1, 'a scheduled check-in is kept apart from the person\'s own time', `${c?.activeMinutes} + ${c?.autoMinutes} auto`);
check(c?.prompts.filter((p) => !p.kind).length === 2 && c?.prompts.filter((p) => p.kind === 'auto').length === 1, 'requests are told apart from automatic turns');
check(c?.outcomes.some((o) => o.text.includes('landing page is built')) && c?.actions.some((a) => a.text === 'Wrote index.html'), 'agent reports and key actions are kept');
check(x?.title === 'Unit converter' && x?.actions.some((a) => a.text.startsWith('Ran: git push')) && x?.outcomes.length === 1, 'Codex title, report and deploy step are read');
check(f.tokens['claude-code'] === (1000 + 500 + 200 + 100 + 300 + 50) * 6 && f.tokens.codex === 5000, 'tokens add up, helper agents and automated calls included', JSON.stringify(f.tokens));
const f2 = readJson(path.join(data, 'facts', `${DAY2}.json`));
const w = f2.sessions.find((s) => s.sid === 'W-dddddddd'), w2 = f2.sessions.find((s) => s.sid === 'W-eeeeeeee');
check(f2.sessions.length === 2 && w?.tool === 'Claude Cowork' && w?.title === 'Spring plant order' && w?.folder === 'work/orders', 'a Claude Cowork session is read, with its title and the folder you chose', f2.sessions.map((s) => `${s.sid} ${s.title} ${s.folder}`).join(', '));
check(w?.activeMinutes === 9 && w?.actions.some((a) => a.text === 'Wrote order-sheet.csv') && w?.outcomes.length === 1 && f2.tokens.cowork === (400 + 100 + 50 + 20) * 6, 'Cowork time, reports, key actions and tokens are read, helper agents included', `${w?.activeMinutes} min, ${f2.tokens.cowork} tokens`);
check(w2?.auto === true && f2.activeMinutes === 9, 'a Cowork session started by a scheduled task is not counted as your time', `${f2.activeMinutes} min, auto ${w2?.auto}`);
if (hasGit) {
  check(f.commits.length === 1 && f.commits[0].subject === 'Add the landing page', 'only your own commits count, not other people\'s', f.commits.map((k) => k.subject).join(' | '));
  check(f.notes.length === 1 && f.notes[0].head === 'Shipped the landing page', 'dated project notes are read');
} else console.log('SKIP  git is not installed here: commit and note checks skipped');
if (hasTrap) check(!fs.existsSync(trapMark), 'a repository\'s own settings can\'t make Speedrun start a program');
else console.log('SKIP  booby-trapped repository check (Windows or no git)');
const text = dossier(f, []);
check(/User asked: Build a landing page/.test(text) && /KEY ACTIONS/.test(text) && /Automatic check-in, not the user/.test(text), 'the day\'s evidence reaches the AI in full');
check(systemPrompt().includes('I run a small garden shop') && systemPrompt().includes('"Zebulon Quince" is always written as "a client"') && !/\bundefined\b/.test(systemPrompt()), 'the instructions carry your "about" text and renamed words');
check(clean({ projects: 'nonsense', headline: 5 }, f).projects.length === 0, 'a malformed AI answer is cleaned, not trusted');

// ---------- a full update with the stand-in AI ----------

const r = await refresh();
const status = readJson(path.join(data, 'status.json'));
check(r.ok && !status.running && !status.lastError, 'a full update finishes cleanly', r.message);
const day = readJson(path.join(data, 'days', `${DAY}.json`));
check(day.projects.length === 2 && day.projects[1].category === 'other' && day.projects[1].you.hireHigh === 0, 'the write-up is tidied (unknown category, hire cost without hiring)');
const page = readJson(path.join(data, 'speedrun.json'));
const raw = JSON.stringify(page);
check(!/Zebulon|Quince|zeb@|4,500|\$/.test(raw), 'nothing private from the AI\'s answer reaches the page data');
const found = [];
(function walk(v) { if (typeof v === 'string') found.push(...leaks(v)); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(page);
check(found.length === 0, 'page data has no private words, emails, amounts or em dashes', found.slice(0, 5).join(' | '));
check(!raw.includes(home) && !raw.includes(tmp), 'page data holds no folder paths from this computer');
const pd = page.days.find((d) => d.day === DAY);
const site = pd?.projects.find((p) => p.name === 'Garden shop site'), app = pd?.projects.find((p) => p.name === 'Recipe app');
check(site?.mult === 100 && site?.actualMin === 12, 'a runaway estimate is capped at 100x', `${site?.mult}x of ${site?.actualMin} min`);
check(app?.mult === 3 && app?.routine === true, 'routine work is capped at 3x', `${app?.mult}x`);
check(pd?.actualMin === 17 && pd?.handsMin > 0 && pd?.handsMin <= pd?.actualMin, 'agent time and your time are both there', `${pd?.actualMin} / ${pd?.handsMin} min`);
check(page.start === DAY && page.days[page.days.length - 1].day === DAY, 'the page starts at the first day with work');
check(page.categories.websites === 'Websites' && page.categories.other === 'Other' && page.tools.join() === 'Claude Code,Codex,Claude Cowork', 'categories and tools come from the settings');

// Your time at the keyboard: reading a quick reply counts, an agent working alone for an hour doesn't.
{
  const m = (n) => t0 + n * 60_000;
  const g = { sessions: [{ prompts: [{ t: m(0) }, { t: m(15) }, { t: m(90) }], outcomes: [{ t: m(12) }, { t: m(80) }] }, { prompts: [{ t: m(14) }], outcomes: [] }] };
  // windows: [-3,1], [12,16] (with the side chat at [11,15] merged), [80,91] -> 4 + 5 + 11 = 20
  check(handsMinutes(g) === 20, 'your time counts reading and typing, not agents working alone', `${handsMinutes(g)} min`);
}

// AI tools delete old logs. What was already read must stay.
fs.rmSync(claudeFile);
await collect();
check(readJson(factsFile).sessions.length === 2, 'a day keeps its history after the tool deletes the log');
const again = await refresh();
check(again.ok && readJson(path.join(data, 'days', `${DAY}.json`)).at === day.at, 'an unchanged day is not written up twice');

// ---------- the other ways to reach an AI ----------

{
  let got = null;
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { got = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) }; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '{"aliases":{}}' } }] })); });
  });
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
  const saved = config.ai;
  process.env.SPEEDRUN_CHECK_KEY = 'made-up-key';
  config.ai = { provider: 'openai-compatible', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, model: 'sample-model', apiKeyEnv: 'SPEEDRUN_CHECK_KEY' };
  const answer = await ask('SYSTEM TEXT', 'USER TEXT').catch((e) => `error: ${e.message}`);
  check(answer === '{"aliases":{}}' && got?.url === '/v1/chat/completions' && got?.auth === 'Bearer made-up-key' && got?.body.model === 'sample-model' && got?.body.messages[0].content === 'SYSTEM TEXT' && got?.body.messages[1].content === 'USER TEXT', 'an OpenAI-compatible service or local model can write the days up', String(answer).slice(0, 80));
  config.ai = { provider: 'command', command: ['speedrun-no-such-command'] };
  const missing = await ask('a', 'b').catch((e) => e.message);
  check(/was not found/.test(missing), 'a missing AI command is reported in plain words', missing);
  config.ai = saved;
  mock.close();
  check(parseJson('Sure!\n```json\n{"a":1}\n```').a === 1, 'JSON wrapped in a sentence and a code fence is still read');
}

// ---------- the page server ----------

{
  const server = await start({ port: 0, auto: false });
  const port = server.address().port;
  const get = (p, headers = {}, method = 'GET') => new Promise((ok) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ code: res.statusCode, body: b, headers: res.headers })); });
    req.end(method === 'POST' ? '{}' : undefined);
  });
  const pageHtml = await get('/');
  check(pageHtml.code === 200 && pageHtml.body.includes('<title>Speedrun</title>') && /default-src 'self'/.test(pageHtml.headers['content-security-policy'] || ''), 'the page is served, with a strict security policy');
  const api = await get('/api/speedrun');
  check(api.code === 200 && JSON.parse(api.body).data.days.some((d) => d.day === DAY), 'the page data is served');
  check((await get('/speedrun.js')).code === 200 && (await get('/speedrun.css')).code === 200 && (await get('/icon.svg')).code === 200, 'the page\'s files are served');
  check((await get('/../package.json')).code === 404 && (await get('/%2e%2e/package.json')).code === 404 && (await get('/missing.html')).code === 404, 'nothing outside the page folder is served');
  check((await get('/api/speedrun/refresh', {}, 'POST')).code === 403, 'the Update button only works from the page itself');
  check((await get('/api/speedrun', { Host: 'elsewhere.example' })).code === 403, 'requests under another site name are refused');
  check(server.address().address === '127.0.0.1', 'the server listens on this computer only');
  server.close();
}

// ---------- the demo ----------

{
  const demo = path.join(tmp, 'demo');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'src', 'demo.mjs'), '--build-only'], { env: { ...process.env, SPEEDRUN_DEMO_DATA: demo }, encoding: 'utf8' });
  const d = run.status === 0 ? readJson(path.join(demo, 'speedrun.json')) : null;
  const bad = d ? d.days.flatMap((k) => k.projects.filter((p) => p.mult != null && (p.mult > 100 || (p.routine && p.mult > 3.05)))) : [];
  check(!!d && d.demo === true && d.days.length >= 20 && d.projects.length >= 6 && d.gold.length > 0 && bad.length === 0, 'the demo builds sample data within the honesty caps', run.stderr.trim().slice(-200));
  check(fs.existsSync(path.join(data, 'speedrun.json')) && !fs.existsSync(path.join(data, '.speedrun-demo')), 'the demo keeps to its own folder');
}

// ---------- nothing personal in the package ----------

{
  const personal = [os.homedir(), os.userInfo().username.length >= 5 ? `/${os.userInfo().username}/` : null].filter(Boolean);
  const hits = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'data', 'demo-data'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (/\.(mjs|js|json|md|html|css|txt|yml|svg)$/.test(e.name) && !['speedrun.config.json', 'private-terms.txt'].includes(e.name)) {
        const body = fs.readFileSync(p, 'utf8');
        if (personal.some((s) => body.includes(s))) hits.push(path.relative(ROOT, p));
      }
    }
  };
  scan(ROOT);
  check(hits.length === 0, 'no file in the package names this computer\'s user or home folder', hits.join(', '));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nAll passed.');
process.exit(failed ? 1 : 0);
