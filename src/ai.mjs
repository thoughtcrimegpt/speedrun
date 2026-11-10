// Speedrun: the AI that writes each day up. One function, ask(system, prompt) -> text, with three
// ways to reach a model (set "ai" in speedrun.config.json):
//
//   { "provider": "claude", "model": "opus" }
//       The Claude Code command on this computer, with no tools, no MCP servers and no saved session.
//   { "provider": "command", "command": ["your-ai", "--flags"] }
//       Any command-line AI: the instructions and the day's evidence go to its standard input,
//       and its answer is read from standard output.
//   { "provider": "openai-compatible", "baseUrl": "http://localhost:11434/v1", "model": "...", "apiKeyEnv": "OPENAI_API_KEY" }
//       Any service or local model that speaks the OpenAI chat format.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA, HOME, config } from './config.mjs';

const WORK = path.join(DATA, 'work'); // an empty folder the AI command runs in

function childEnv(bin) {
  const env = { ...process.env };
  const extra = [path.isAbsolute(bin) ? path.dirname(bin) : '', path.join(HOME, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean);
  env.PATH = [env.PATH || '', ...extra].join(path.delimiter);
  // When Speedrun itself is started from inside an agent session, don't pass that session along.
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
  return env;
}

function run(bin, args, input, timeoutMs, what) {
  fs.mkdirSync(WORK, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: WORK, env: childEnv(bin), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${what} took too long.`)); }, timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `${what}: the command "${bin}" was not found. Check "ai" in speedrun.config.json.` : `${what}: ${e.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ out, err, code }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function askClaude(system, prompt, timeoutMs) {
  const bin = config.ai.bin || 'claude';
  const args = ['-p', '--model', config.ai.model || 'opus', '--tools', '', '--strict-mcp-config', '--setting-sources', 'local', '--no-session-persistence', '--system-prompt', system, '--output-format', 'json'];
  const { out, err } = await run(bin, args, prompt, timeoutMs, 'Claude');
  try {
    const j = JSON.parse(out);
    if (j.is_error) throw new Error(String(j.result || j.subtype));
    return String(j.result || '');
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`Claude did not answer (${(err || out).trim().slice(-300)})`);
    throw e;
  }
}

async function askCommand(system, prompt, timeoutMs) {
  const cmd = config.ai.command;
  if (!Array.isArray(cmd) || !cmd.length) throw new Error('Set "ai.command" in speedrun.config.json, for example ["my-ai", "--quiet"].');
  const { out, err, code } = await run(String(cmd[0]), cmd.slice(1).map(String), `${system}\n\n=====\n\n${prompt}`, timeoutMs, 'The AI command');
  if (!out.trim()) throw new Error(`The AI command gave no answer (exit ${code}: ${err.trim().slice(-300)})`);
  return out;
}

async function askOpenAI(system, prompt, timeoutMs) {
  const base = String(config.ai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (!config.ai.model) throw new Error('Set "ai.model" in speedrun.config.json.');
  const key = config.ai.apiKeyEnv ? process.env[config.ai.apiKeyEnv] : '';
  if (config.ai.apiKeyEnv && !key) throw new Error(`The environment variable ${config.ai.apiKeyEnv} is not set.`);
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: config.ai.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`The AI service answered ${r.status}: ${text.slice(0, 300)}`);
  const answer = JSON.parse(text).choices?.[0]?.message?.content;
  if (!answer) throw new Error('The AI service gave no answer.');
  return String(answer);
}

/** Which model wrote a day up, for the record. */
export const aiName = () => (config.ai.provider === 'command' ? String(config.ai.command?.[0] || 'command') : `${config.ai.provider}:${config.ai.model || ''}`);

export function ask(system, prompt, timeoutMs = 15 * 60_000) {
  const p = config.ai.provider;
  if (p === 'claude') return askClaude(system, prompt, timeoutMs);
  if (p === 'command') return askCommand(system, prompt, timeoutMs);
  if (p === 'openai-compatible') return askOpenAI(system, prompt, timeoutMs);
  return Promise.reject(new Error(`Unknown "ai.provider" in speedrun.config.json: ${p}. Use claude, command or openai-compatible.`));
}

/** Models sometimes wrap JSON in a code fence or a sentence. Take the outermost object. */
export function parseJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The AI did not answer with JSON.');
  return JSON.parse(t.slice(a, b + 1));
}
