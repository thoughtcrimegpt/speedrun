// Speedrun: the page server. Local only (127.0.0.1), no accounts, nothing uploaded.
// Serves public/ and two addresses: GET /api/speedrun (the page data and update status) and
// POST /api/speedrun/refresh (the Update button). Updates run as a separate low-priority process,
// at most every 30 minutes, so the page never slows the computer down.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, DATA, DEMO, config } from './config.mjs';

const PUBLIC = path.join(ROOT, 'public');
const EVERY_MS = 30 * 60_000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
let lastKick = 0;

function status() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(DATA, 'status.json'), 'utf8')); } catch { /* no run yet */ }
  if (s.running && s.pid) { try { process.kill(s.pid, 0); } catch { s.running = false; s.phase = ''; } }
  return s;
}

/** Start an update in the background, unless one ran in the last 30 minutes (force skips that wait). */
function kick(force = false) {
  if (DEMO) return { ok: true, message: 'This is sample data. Run "npm start" to read your own sessions.' };
  const s = status();
  if (s.running) return { ok: true, message: 'Already updating.' };
  const last = Math.max(lastKick, Date.parse(s.lastRun || 0) || 0);
  if (!force && Date.now() - last < EVERY_MS) return { ok: true, message: 'Up to date.' };
  lastKick = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'refresh.mjs')], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
  return { ok: true, message: 'Updating. New sessions show up in a minute or two.' };
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { ...HEADERS, 'Content-Type': type });
  res.end(body);
}
const sendJson = (res, code, o) => send(res, code, JSON.stringify(o), 'application/json; charset=utf-8');

export function start({ port = config.port, auto = !process.env.SPEEDRUN_NO_AUTO } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const mine = new Set([`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]);
      // Only this computer's own browser may talk to the page (blocks other sites and odd host names).
      if (!mine.has(String(req.headers.host || ''))) return send(res, 403, 'Refused.');
      const url = new URL(req.url, 'http://127.0.0.1');

      if (url.pathname === '/api/speedrun' && req.method === 'GET') {
        // Other websites can't read this page's data, but they could still make the browser ask for it.
        // Only the page itself starts an update, so no other site can make Speedrun call your AI.
        const site = req.headers['sec-fetch-site'];
        if (auto && (!site || site === 'same-origin' || site === 'none')) kick();
        const raw = await fsp.readFile(path.join(DATA, 'speedrun.json'), 'utf8').catch(() => null);
        return sendJson(res, 200, { ok: true, demo: DEMO, status: status(), data: raw ? JSON.parse(raw) : null });
      }
      if (url.pathname === '/api/speedrun/refresh' && req.method === 'POST') {
        const origin = req.headers.origin;
        if (req.headers['x-speedrun'] !== '1' || (origin && !mine.has(origin.replace(/^https?:\/\//, '')))) return sendJson(res, 403, { ok: false, message: 'Refused.' });
        return sendJson(res, 200, kick(true));
      }
      if (req.method !== 'GET') return send(res, 405, 'Method not allowed.');

      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file)]) return send(res, 404, 'Not found.');
      const body = await fsp.readFile(file).catch(() => null);
      if (!body) return send(res, 404, 'Not found.');
      return send(res, 200, body, TYPES[path.extname(file)]);
    } catch (e) {
      return send(res, 500, `Something went wrong: ${e.message}`);
    }
  });
  if (auto && !DEMO) {
    setTimeout(() => kick(), 5_000).unref();
    setInterval(() => kick(), 3600_000).unref(); // hourly, so today never lags far behind
  }
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use. Is Speedrun already running? Otherwise set "port" in speedrun.config.json.`) : e));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().then((server) => {
    console.log(`Speedrun is running at http://127.0.0.1:${server.address().port}/  (Ctrl+C stops it)`);
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
