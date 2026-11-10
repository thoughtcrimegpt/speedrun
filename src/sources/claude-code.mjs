// Reader for Claude Code transcripts (~/.claude/projects/<project>/<session>.jsonl, helper agents
// in <session>/subagents/). Reads only.

import path from 'node:path';
import { HOME, dayKey } from '../config.mjs';
import { clip, eachLine, walk, newRecord, addPrompt, EFFECT, SHELL_EFFECT, OUTCOME_LEN, ACTION_MAX } from './shared.mjs';

const root = () => path.join(!process.env.SPEEDRUN_HOME && process.env.CLAUDE_CONFIG_DIR ? process.env.CLAUDE_CONFIG_DIR : path.join(HOME, '.claude'), 'projects');

function userText(msg) {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  if (c.some((b) => b?.type === 'tool_result')) return '';
  return c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
}

function realPrompt(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/^<(command-|local-command|system-reminder|task-notification|bash-)/.test(t)) return '';
  if (/^\[Request interrupted/.test(t)) return '';
  if (/^Caveat: The messages below/.test(t)) return '';
  return t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<\/?pasted_content[^>]*>/g, '').trim();
}

const shortPath = (p) => path.basename(String(p || '').replace(/\\/g, '/')).slice(0, 90);

// Key actions: the agent's own one-line description of each step that changed something
// (clicks that submit, save or send; uploads; deploys; files written; helper agents).
function action(b, t, r) {
  const name = String(b.name || ''), inp = b.input || {};
  const add = (text) => { text = clip(text, 160); if (text) r.actions.push({ t, text }); };
  const click = (x) => { if (x && x.action_summary && EFFECT.test(x.action_summary)) add(`Browser: ${x.action_summary}`); };
  if (/__(computer|form_input)$/.test(name)) return click(inp);
  if (/__browser_batch$/.test(name)) { for (const a of inp.actions || []) click(a?.input); return; }
  if (/__file_upload$/.test(name) || /__upload_image$/.test(name)) return add(`Uploaded in the browser: ${(inp.paths || [inp.path || inp.file_path || '']).map(shortPath).join(', ')}`);
  if (/__spawn_task$/.test(name)) { if (inp.title) { r.spawned.push(String(inp.title)); add(`Started a parallel session: ${inp.title}`); } return; }
  if (name === 'SendMessage' && inp.to) return add(`Messaged session "${clip(inp.to, 60)}": ${inp.summary || clip(inp.message, 100)}`);
  if (name === 'Agent' || name === 'Task') return add(`Helper agent: ${inp.description || clip(inp.prompt, 80)}`);
  if (name === 'SendUserFile') return add(`Sent the user: ${(inp.files || []).map(shortPath).join(', ')}`);
  if (name === 'Artifact' && (!inp.action || inp.action === 'publish')) return add(`Published a private page: ${shortPath(inp.file_path || inp.title)}`);
  if (name === 'Write') return add(`Wrote ${shortPath(inp.file_path)}`);
  if (name === 'Bash') { const c = String(inp.command || ''); if (SHELL_EFFECT.test(c)) add(`Ran: ${inp.description || clip(c, 120)}`); return; }
  if (/^mcp__/.test(name)) {
    const short = name.split('__').pop();
    if (/^(create|update|send|reply|forward|publish|deploy|delete|add|set|edit|import|save|confirm|prepare|label|trash|start|cancel|copy|upload|bulk|apply|schedule|run|submit)/i.test(short)) {
      const what = inp.subject || inp.title || inp.name || inp.summary || '';
      add(`${short.replace(/_/g, ' ')}${what ? `: ${clip(what, 90)}` : ''}`);
    }
  }
}

/** Reads one transcript. `base` is the projects folder it sits in. Claude Cowork keeps the same format (see cowork.mjs). */
export async function parseTranscript(file, base, kind) {
  const rel = path.relative(base, file).split(path.sep);
  const sub = rel.length > 2; // <project>/<session>/subagents/agent.jsonl
  const r = newRecord(kind);
  r.session = sub ? rel[1] : path.basename(file, '.jsonl');
  r.sub = sub;
  const seen = new Set();
  let lastText = null;
  const flush = () => { if (lastText) { r.outcomes.push({ t: lastText.t, text: clip(lastText.text, OUTCOME_LEN) }); lastText = null; } };
  await eachLine(file, (o) => {
    if (o.type === 'custom-title' && o.customTitle) { r.title = o.customTitle; return; }
    if (o.type === 'summary' && o.summary && !r.title) { r.title = o.summary; return; }
    if (o.type !== 'user' && o.type !== 'assistant') return;
    const t = Date.parse(o.timestamp);
    if (!Number.isFinite(t)) return;
    if (!r.cwd && o.cwd) r.cwd = o.cwd;
    if (o.type === 'user' && !sub && !o.isSidechain && !o.isMeta) {
      const p = realPrompt(userText(o.message));
      if (p) { flush(); addPrompt(r, t, p); }
    }
    (r.mode === 'auto' ? r.autoTimes : r.times).push(t);
    if (o.type === 'assistant') {
      const m = o.message || {};
      const u = m.usage;
      const id = m.id || o.requestId;
      if (u && id && !seen.has(id)) {
        seen.add(id);
        const fresh = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
        const d = dayKey(t);
        r.tokens[d] = (r.tokens[d] || 0) + fresh + (u.cache_read_input_tokens || 0);
        r.fresh[d] = (r.fresh[d] || 0) + fresh;
      }
      if (Array.isArray(m.content)) for (const b of m.content) if (b?.type === 'tool_use') action(b, t, r);
      if (!sub && !o.isSidechain && Array.isArray(m.content)) {
        const txt = m.content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
        if (txt) lastText = { t, text: txt };
      }
    }
  });
  flush();
  if (r.actions.length > ACTION_MAX) r.actions = r.actions.slice(0, ACTION_MAX / 2).concat(r.actions.slice(-ACTION_MAX / 2));
  return r;
}

export default {
  id: 'claude-code',
  label: 'Claude Code',
  prefix: 'C',
  where: '~/.claude/projects',
  files: () => walk(root(), (n) => n.endsWith('.jsonl')),
  parse: (file) => parseTranscript(file, root(), 'claude-code'),
};
