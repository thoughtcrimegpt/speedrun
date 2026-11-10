// Speedrun: settings and small helpers shared by every step.
// Everything personal lives in speedrun.config.json and private-terms.txt, which git ignores.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// SPEEDRUN_HOME points the readers at another home folder (the self-check uses a pretend one).
export const HOME = path.resolve(process.env.SPEEDRUN_HOME || os.homedir());
export const DATA = path.resolve(process.env.SPEEDRUN_DATA || path.join(ROOT, 'data'));
export const CONFIG_FILE = path.resolve(process.env.SPEEDRUN_CONFIG || path.join(ROOT, 'speedrun.config.json'));
export const TERMS_FILE = path.resolve(process.env.SPEEDRUN_TERMS || path.join(ROOT, 'private-terms.txt'));
export const DEMO = process.env.SPEEDRUN_DEMO === '1';

// Work time, not calendar time: a "week" of the old way is 40 working hours.
export const HOURS = { day: 8, week: 40, month: 173, year: 2080 };

const DEFAULTS = {
  // A few sentences about you and what you already know how to do. The estimates lean on this.
  about: '',
  // First day to read, as YYYY-MM-DD. Empty: 90 days before the first run.
  start: '',
  // Which session logs to read. See src/sources/.
  sources: ['claude-code', 'codex'],
  // Which AI writes each day up. See README, "Pick the AI that writes it up".
  ai: { provider: 'claude', model: 'opus' },
  // Project categories: id -> label on the page. "other" always exists.
  categories: {
    websites: 'Websites', apps: 'Apps', games: 'Games', videos: 'Videos', design: 'Design',
    writing: 'Writing', data: 'Data', marketing: 'Marketing', admin: 'Admin',
  },
  // Extra folders to search for git repositories (the folders your sessions ran in are found by themselves).
  roots: [],
  // Dated note files to read inside each repository, e.g. [".agent/HANDOFF.md"] ("## 2026-01-31 ..." headings).
  notes: [],
  port: 8799,
  // The most days written up in one update, newest first. The rest follow on later updates.
  daysPerRun: 30,
};

function readConfig() {
  let user = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch (e) { throw new Error(`speedrun.config.json is not valid JSON: ${e.message}`); }
  }
  const c = { ...DEFAULTS, ...user, ai: { ...DEFAULTS.ai, ...(user.ai || {}) } };
  if (user.ai?.provider && user.ai.provider !== 'claude' && !user.ai.model) delete c.ai.model;
  if (!c.categories || typeof c.categories !== 'object' || !Object.keys(c.categories).length) c.categories = DEFAULTS.categories;
  c.categories = Object.fromEntries(Object.entries(c.categories).filter(([k]) => /^[a-z][a-z0-9-]*$/.test(k) && k !== 'other').map(([k, v]) => [k, String(v)]));
  c.sources = Array.isArray(c.sources) && c.sources.length ? c.sources.map(String) : DEFAULTS.sources;
  c.roots = (Array.isArray(c.roots) ? c.roots : []).map((r) => expandHome(String(r)));
  c.notes = (Array.isArray(c.notes) ? c.notes : []).map(String);
  c.about = String(c.about || '');
  c.start = /^\d{4}-\d{2}-\d{2}$/.test(c.start) ? c.start : '';
  c.port = Number(process.env.SPEEDRUN_PORT || c.port) || DEFAULTS.port;
  c.daysPerRun = Math.max(1, Number(c.daysPerRun) || DEFAULTS.daysPerRun);
  return c;
}

export function expandHome(p) {
  return p === '~' ? HOME : p.startsWith('~/') || p.startsWith('~\\') ? path.join(HOME, p.slice(2)) : path.resolve(p);
}

export const config = readConfig();

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The first day Speedrun reads. Set once and kept, so old days never fall off the page. */
export function startDay() {
  if (config.start) return config.start;
  const file = path.join(DATA, 'state.json');
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (/^\d{4}-\d{2}-\d{2}$/.test(s.start)) return s.start;
  } catch { /* first run */ }
  const start = dayKey(Date.now() - 90 * 86_400_000);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ start }));
  return start;
}

const slash = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

/** A short, readable label for a working folder ("Projects/garden-site", "Home folder"). */
export function folderLabel(dir) {
  if (!dir) return '';
  const p = slash(dir).replace(/\/\.(claude|codex)\/worktrees\/.*$/, '');
  const home = slash(HOME);
  if (p === home) return 'Home folder';
  const seg = (p.startsWith(home + '/') ? p.slice(home.length + 1) : p).split('/').filter(Boolean);
  return seg.slice(-2).join('/');
}

/** Folders used by automated, app-driven agent calls (not your own sessions), Speedrun's own included. */
export function isAutoCwd(cwd) {
  const c = slash(cwd);
  if (!c) return false;
  const inside = (dir) => { const d = slash(dir); return c === d || c.startsWith(d + '/'); };
  return /^\/(private\/)?(var\/folders|tmp)(\/|$)/.test(c) || inside(os.tmpdir()) || inside(path.join(HOME, 'Library')) || inside(DATA);
}
