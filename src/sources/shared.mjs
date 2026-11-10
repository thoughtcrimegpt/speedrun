// Helpers shared by the session-log readers.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

export const OUTCOME_LEN = 2400; // how much of each final report is kept
export const ACTION_MAX = 400;

export const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// Steps that change something (the rest, like reading and searching, are left out of "key actions").
export const EFFECT = /\b(submit|send|sent|reserv|book|upload|publish|post|sign|save|confirm|place|deploy|creat|attach|apply|approv|schedul|add|move|file[sd]?\b|renam|replac|order|pay|insert|fill|draft|launch|enabl|connect|archiv|merg|release|push|import|export|download|delet|remov|accept|invit|share|tag|upgrade|cancel|refund|correct|fix|update|chang)/i;
export const SHELL_EFFECT = /\b(wrangler (pages )?deploy|wrangler deploy|git push|gh (repo|pr|release) create|vercel|netlify deploy|firebase deploy|npm publish|rclone (copy|sync|move)|aws s3 (cp|sync)|launchctl (load|bootstrap)|crontab)\b/i;

export const canReadZstd = typeof zlib.createZstdDecompress === 'function'; // Node 22.15 and later

/** A fresh, empty record for one log file. */
export function newRecord(kind) {
  return { kind, session: '', sub: false, title: '', cwd: '', times: [], autoTimes: [], mode: 'human', tokens: {}, fresh: {}, prompts: [], outcomes: [], actions: [], spawned: [] };
}

/** Calls fn(object) per line. If want(line) says no, fn gets only { timestamp, type } (cheap, no full parse). */
export async function eachLine(file, fn, want = null) {
  let input = fs.createReadStream(file, { highWaterMark: 1 << 20 });
  if (file.endsWith('.zst')) input = input.pipe(zlib.createZstdDecompress());
  input.setEncoding('utf8');
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    if (want && !want(line)) {
      const m = line.slice(0, 80).match(/^\{"timestamp":"([^"]+)"(?:,"ordinal":\d+)?,"type":"([a-z_]+)"/);
      if (m) fn({ timestamp: m[1], type: m[2], payload: {} });
      continue;
    }
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    fn(o);
  }
}

export async function walk(dir, test, out = [], depth = 0) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 6) await walk(p, test, out, depth + 1); } else if (test(e.name)) out.push(p);
  }
  return out;
}

// ---------- whose message is it ----------
// Some "user" messages are not typed by the person: automation heartbeats, scheduled tasks and goal
// nudges ("auto"), and context the apps attach or carry over ("meta"). Auto turns are kept apart, so
// overnight automations never count as the person's time or as the time a result took.

const CONTEXT_BLOCKS = /<(in-app-browser-context|recommended_plugins|external_codex_apps_open_page)\b[^>]*>[\s\S]*?<\/\1>/g;
const AUTO = /^<(heartbeat|scheduled-task|codex_internal_context)\b/;
const META = /^(This session is being continued from a previous conversation|<external_codex_apps_open_page)/;

/** -> { kind: 'human' | 'auto' | 'meta', text } */
export function promptKind(text) {
  const raw = String(text || '').trim();
  if (AUTO.test(raw)) return { kind: 'auto', text: raw };
  if (META.test(raw)) return { kind: 'meta', text: raw };
  const rest = raw.replace(CONTEXT_BLOCKS, '').replace(/^\s*##\s*My request:\s*/i, '').replace(/&#x20;/g, ' ').trim();
  return rest ? { kind: 'human', text: rest } : { kind: 'meta', text: raw };
}

export function addPrompt(r, t, text) {
  const k = promptKind(text);
  r.prompts.push(k.kind === 'human' ? { t, text: clip(k.text, 600) } : { t, text: clip(k.text, 600), kind: k.kind });
  if (k.kind !== 'meta') r.mode = k.kind; // context carried over keeps whoever started the turn
  return k.kind;
}
