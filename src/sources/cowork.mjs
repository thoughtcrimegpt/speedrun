// Reader for Claude Cowork (the Cowork tab of the Claude desktop app). Each session keeps a
// transcript in Claude Code's format inside the app's own data folder:
//   <app data>/local-agent-mode-sessions/<account>/<workspace>/<session>/.claude/projects/<name>/<id>.jsonl
// and <session>.json beside that folder holds its title and the folder you chose. Reads only.
// Sessions that ran in the cloud leave no transcript on this computer, so they can't be read.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { HOME } from '../config.mjs';
import { walk } from './shared.mjs';
import { parseTranscript } from './claude-code.mjs';

const STORE = 'local-agent-mode-sessions';
const APP = /^Claude(?:[- ]|$)/; // "Claude", and side-by-side installs such as "Claude Nightly"
const PROJECTS = `${path.sep}.claude${path.sep}projects`;

const dirs = async (dir) => {
  try { return (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
};

// Where the desktop app keeps its data: macOS, Windows (the installer and the Store version), Linux.
async function stores() {
  const bases = new Set([path.join(HOME, 'Library', 'Application Support'), path.join(HOME, 'AppData', 'Roaming'), path.join(HOME, '.config')]);
  const packages = [path.join(HOME, 'AppData', 'Local', 'Packages')];
  if (!process.env.SPEEDRUN_HOME) {
    if (process.env.APPDATA) bases.add(path.resolve(process.env.APPDATA));
    if (process.env.LOCALAPPDATA) packages.push(path.join(process.env.LOCALAPPDATA, 'Packages'));
  }
  for (const p of new Set(packages)) for (const n of await dirs(p)) if (/claude/i.test(n)) bases.add(path.join(p, n, 'LocalCache', 'Roaming'));
  const out = [];
  for (const b of bases) for (const n of await dirs(b)) if (APP.test(n) && (await dirs(path.join(b, n))).includes(STORE)) out.push(path.join(b, n, STORE));
  return out;
}

// Session folders are the ones holding .claude/projects. Looking only there keeps Speedrun out of
// the files a session worked on.
async function sessionDirs(dir, depth = 0, out = []) {
  for (const n of await dirs(dir)) {
    if (n.startsWith('.') || n === 'skills-plugin') continue;
    const p = path.join(dir, n);
    if ((await dirs(path.join(p, '.claude'))).includes('projects')) out.push(p);
    else if (depth < 3) await sessionDirs(p, depth + 1, out);
  }
  return out;
}

async function files() {
  const out = [];
  for (const store of await stores()) {
    for (const dir of await sessionDirs(store)) await walk(dir + PROJECTS, (n) => n.endsWith('.jsonl'), out, 0, 4);
  }
  return out;
}

async function parse(file) {
  const dir = file.slice(0, file.lastIndexOf(PROJECTS + path.sep));
  const r = await parseTranscript(file, dir + PROJECTS, 'cowork');
  let info = {};
  try { info = JSON.parse(await fsp.readFile(`${dir}.json`, 'utf8')) || {}; } catch { /* no details saved for this session */ }
  // The transcript's own folder is inside Cowork's sandbox and means nothing here. The folder you
  // gave the session does (it names the project and is where your commits are found).
  const chosen = Array.isArray(info.userSelectedFolders) ? info.userSelectedFolders[0] : '';
  r.cwd = typeof chosen === 'string' ? chosen : String(chosen?.path || '');
  if (r.sub) return r;
  if (info.title) r.title = String(info.title);
  // A session started by a scheduled task: nobody typed its first message, so that turn is not your time.
  const first = r.prompts.find((p) => p.kind !== 'meta');
  if (info.sessionType === 'scheduled' && first && !first.kind) {
    first.kind = 'auto';
    const next = r.prompts.find((p) => !p.kind)?.t ?? Infinity;
    r.autoTimes.push(...r.times.filter((t) => t < next));
    r.times = r.times.filter((t) => t >= next);
  }
  return r;
}

export default {
  id: 'cowork',
  label: 'Claude Cowork',
  prefix: 'W',
  where: 'the Claude desktop app\'s data folder (local-agent-mode-sessions)',
  files,
  parse,
};
