# Readers

One file per AI coding tool. A reader turns that tool's session logs into the same small record, so the rest of Speedrun doesn't care which tool did the work.

## The contract

A reader's default export:

```js
export default {
  id: 'my-tool',            // used in "sources" in speedrun.config.json and as the token bucket
  label: 'My Tool',         // shown on the page
  prefix: 'M',              // one capital letter; session ids look like M-1a2b3c4d
  where: '~/.my-tool/logs', // for people, not used by the code
  prepare: () => ctx,       // optional: load anything shared by all files (an index of titles)
  files: async (start) => [absolutePath, ...],  // every log file that may hold work since `start` (YYYY-MM-DD)
  parse: async (file, ctx) => record,           // read one file
  touch: (record, ctx) => {},                   // optional: update a cached record cheaply
};
```

`parse` starts from `newRecord('my-tool')` in `shared.mjs` and fills in:

| Field | Meaning |
| --- | --- |
| `session` | A stable id for the session (at least 8 characters). |
| `sub`, `parent` | `sub: true` for a helper agent's file; `parent` is the session it belongs to, when the log says so. |
| `title` | The session's name, if the tool keeps one. |
| `cwd` | The folder the session ran in. |
| `times` | Every timestamp (milliseconds) at which something happened in a turn the person started. Speedrun turns these into active stretches; pauses over 10 minutes don't count. |
| `autoTimes` | The same for turns nobody typed (scheduled runs, heartbeats). `addPrompt()` sets `r.mode` so you can choose the right list. |
| `prompts` | What the person asked: call `addPrompt(r, t, text)` for each message they typed. It sorts out automatic and carried-over context. |
| `outcomes` | The agent's final report for each turn: `{ t, text }`, clipped to `OUTCOME_LEN`. |
| `actions` | Optional one-line records of steps that changed something (files written, deploys): `{ t, text }`. |
| `tokens`, `fresh` | Tokens per day (`{ 'YYYY-MM-DD': n }`): all tokens, and tokens without re-read cached context. |

Then add the reader to the list in `index.mjs`.

## Checklist

- Read only. Open files for reading; never write next to them.
- Stream big files line by line (`eachLine` in `shared.mjs`); logs can be hundreds of megabytes.
- Skip messages the tool injects on the person's behalf (system reminders, attached context), or `prompts` fills with noise and "your time" is wrong.
- Count each model response's tokens once (logs often repeat usage across lines).
- Add made-up fixture logs and checks to `test/test.mjs`. Never commit real logs.
