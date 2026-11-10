// The session-log readers Speedrun knows. To support another AI coding tool, add a file here
// (see README.md in this folder) and list it below.

import claudeCode from './claude-code.mjs';
import codex from './codex.mjs';
import cowork from './cowork.mjs';

export const SOURCES = [claudeCode, codex, cowork];

export const sourceById = (id) => SOURCES.find((s) => s.id === id);
