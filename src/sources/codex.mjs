// Reader for Codex sessions (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, older ones .jsonl.zst,
// plus ~/.codex/archived_sessions). Reads only.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HOME, dayKey } from '../config.mjs';
import { clip, eachLine, walk, newRecord, addPrompt, canReadZstd, SHELL_EFFECT, OUTCOME_LEN } from './shared.mjs';

const root = () => (!process.env.SPEEDRUN_HOME && process.env.CODEX_HOME ? process.env.CODEX_HOME : path.join(HOME, '.codex'));

const WANT = /"type":"(session_meta|token_count|task_complete)"|"role":"user"|"type":"function_call"/;
const want = (line) => WANT.test(line.length > 4000 ? line.slice(0, 4000) : line);
const isLog = (n) => n.endsWith('.jsonl') || (canReadZstd && n.endsWith('.jsonl.zst'));

function prompt(payload) {
  if (payload?.type !== 'message' || payload.role !== 'user') return '';
  const text = (payload.content || []).filter((b) => b?.type === 'input_text').map((b) => b.text).join('\n').trim();
  if (!text || /^(# AGENTS\.md|<environment_context|<INSTRUCTIONS|<user_instructions|<permissions|<turn_aborted|<subagent|<skill)/.test(text)) return '';
  return text;
}

/** Session names Codex keeps in its own index. */
function titles() {
  const m = new Map();
  try {
    for (const line of fs.readFileSync(path.join(root(), 'session_index.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      try { const o = JSON.parse(line); if (o.id && o.thread_name) m.set(o.id, o.thread_name); } catch { /* skip */ }
    }
  } catch { /* no index */ }
  return m;
}

async function files(start) {
  const sessions = path.join(root(), 'sessions');
  const out = [];
  const [y, m] = start.split('-').map(Number);
  for (const yy of await fsp.readdir(sessions).catch(() => [])) {
    for (const mm of await fsp.readdir(path.join(sessions, yy)).catch(() => [])) {
      if (Number(yy) * 12 + Number(mm) < y * 12 + m) continue;
      out.push(...await walk(path.join(sessions, yy, mm), isLog));
    }
  }
  out.push(...await walk(path.join(root(), 'archived_sessions'), isLog));
  return out;
}

async function parse(file, names) {
  const r = newRecord('codex');
  // Forked and helper sessions start with a copy of the parent's history, token counts included.
  // Only count what happened after this session began.
  let lastTotal = 0, lastFresh = 0, began = 0;
  await eachLine(file, (o) => {
    const t = Date.parse(o.timestamp);
    const p = o.payload || {};
    if (o.type === 'session_meta') {
      r.session = p.id || r.session;
      began = Date.parse(p.timestamp || o.timestamp) || began;
      r.cwd = p.cwd || r.cwd;
      if (p.source && typeof p.source === 'object' && p.source.subagent) {
        r.sub = true;
        r.parent = p.parent_thread_id || p.source.subagent?.thread_spawn?.parent_thread_id || null;
        if (p.thread_source === 'guardian_review' || p.source.subagent.other === 'guardian') r.guardian = true;
      }
      return;
    }
    if (!Number.isFinite(t)) return;
    if (o.type === 'event_msg' && p.type === 'token_count') {
      const u = p.info?.total_token_usage, last = p.info?.last_token_usage;
      const total = u?.total_tokens;
      if (!Number.isFinite(total)) return;
      const fresh = (u.input_tokens || 0) - (u.cached_input_tokens || 0) + (u.output_tokens || 0);
      if (total > lastTotal && t >= began) {
        // The first count in a file may carry a parent's running total: take only that request.
        const first = lastTotal === 0 && last;
        const add = first ? (last.total_tokens || 0) : total - lastTotal;
        const addFresh = first ? (last.input_tokens || 0) - (last.cached_input_tokens || 0) + (last.output_tokens || 0) : fresh - lastFresh;
        const d = dayKey(t);
        r.tokens[d] = (r.tokens[d] || 0) + add;
        r.fresh[d] = (r.fresh[d] || 0) + Math.max(0, addFresh);
      }
      if (total > lastTotal || t < began) { lastTotal = total; lastFresh = fresh; }
      return;
    }
    if (o.type === 'response_item' && !r.sub) { const q = prompt(p); if (q) addPrompt(r, t, q); }
    if (o.type === 'response_item' || o.type === 'event_msg') (r.mode === 'auto' ? r.autoTimes : r.times).push(t);
    if (o.type === 'response_item' && p.type === 'function_call') {
      const a = String(p.arguments || '');
      if (SHELL_EFFECT.test(a)) { const m = a.match(SHELL_EFFECT); r.actions.push({ t, text: `Ran: ${clip(m[0], 60)} (${clip(a.replace(/^\{"command":\[?"?/, ''), 100)})` }); }
      return;
    }
    if (r.sub) return;
    if (o.type === 'event_msg' && p.type === 'task_complete' && p.last_agent_message) {
      r.outcomes.push({ t, text: clip(p.last_agent_message, OUTCOME_LEN) });
    }
  }, want);
  if (!r.session) r.session = path.basename(file).replace(/^rollout-[\dT-]+-/, '').replace(/\.jsonl(\.zst)?$/, '');
  r.title = names.get(r.session) || '';
  if (r.guardian) { r.prompts = []; r.outcomes = []; }
  return r;
}

export default {
  id: 'codex',
  label: 'Codex',
  prefix: 'X',
  where: '~/.codex/sessions',
  prepare: titles,
  files,
  parse,
  /** A cached session may get its name later. */
  touch: (r, names) => { if (!r.title) r.title = names.get(r.session) || ''; },
};
