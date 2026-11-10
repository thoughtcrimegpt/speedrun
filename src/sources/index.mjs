// The session-log readers Speedrun knows. To support another AI coding tool, add a file here
// (see README.md in this folder) and list it below.

import claudeCode from './claude-code.mjs';
import codex from './codex.mjs';

export const SOURCES = [claudeCode, codex];

export const sourceById = (id) => SOURCES.find((s) => s.id === id);
