# Speedrun: instructions for AI agents

You are an AI coding agent (Claude Code, Codex or another) and a person has asked you to set up or change Speedrun. Speedrun reads the session logs of AI coding tools on this computer, has an AI write each day up, and shows what got done next to an honest "before AI" estimate on a local page. `README.md` describes it for people.

## Setting it up for someone

Do these in order. Speak plainly; many users don't code.

1. **Check Node.** `node --version` must be 20 or newer (22 or newer to read Codex's compressed older logs). If it is missing or older, tell the person how to install it and stop.
2. **Run the self-check.** `npm test` must end with "All passed." It uses a pretend home folder and a stand-in AI; it never reads the person's logs. If it fails, fix nothing silently: show the failing lines.
3. **Show the demo** (optional but kind): `npm run demo`, then open http://127.0.0.1:8798/. Say that the data is made up. Stop it before the next step.
4. **Ask the person four things**, one short message:
   - What do you do, and what can you already do yourself without AI? (Two or three sentences. This becomes `about`.)
   - Which AI should write the daily write-ups? Default: the tool they are talking to you in, if it has a command-line form. See "Pick the AI that writes it up" in `README.md`.
   - Any names that must never appear on the page (clients, employers, people, project code names)?
   - How far back to start? Default: 90 days.
5. **Write the settings.** Copy `speedrun.config.example.json` to `speedrun.config.json` and fill it in. Write their private words to `private-terms.txt` (format in `private-terms.example.txt`). Both files are git-ignored; never commit them.
6. **Check what will be read.** Look for `~/.claude/projects` and `~/.codex/sessions`. If the person's main tool is neither, see "Adding a tool" below before going on.
7. **Try one day before a full run.** Run `node src/collect.mjs`, then pick a recent day with sessions and run `node src/summarize.mjs YYYY-MM-DD && node src/build.mjs`. If the AI setting is wrong, this fails fast with a plain message. Read the result in `data/days/YYYY-MM-DD.json` and sanity-check it against what the person did that day.
8. **Start it.** `npm start`, open http://127.0.0.1:8799/, and tell the person: the first update takes a few minutes, newest days first, and each day's write-up is one AI request.
9. **Offer to keep it running.** Only if they want it: a login item, a launchd or systemd user service, or a scheduled task that runs `npm start` in this folder. Ask first; don't install background jobs on your own.

## Rules that must survive any change

- **Read only.** Never write to, move or delete a session log, a note file or a repository Speedrun reads.
- **Local only.** The server binds to `127.0.0.1` and checks the `Host` header. Don't add sharing, uploads, analytics, tunnels or a wider bind address.
- **Never clear `data/cache`.** AI tools delete old logs; the cache is the only copy of what was already read.
- **Privacy twice.** Every string that reaches `data/speedrun.json` goes through `scrub()` in `src/privacy.mjs`, and the instructions in `src/summarize.mjs` forbid the same things. Keep both.
- **Honesty caps stay.** Routine work at most 3×, everything at most 100×, automatic runs never timed, untimed work out of the totals, estimates marked "est.". Don't raise a cap to make numbers look better.
- **Second person.** The page talks to its reader as "you".
- **No personal data in git.** `speedrun.config.json`, `private-terms.txt`, `data/` and `demo-data/` stay ignored. Tests and examples use invented names only.

## How it works

1. `src/collect.mjs` runs each reader in `src/sources/`, caches every parsed log by size and modified time (`data/cache/files.json`), merges helper agents into their parent session, and writes `data/facts/YYYY-MM-DD.json`: the day's sessions (active stretches, the person's requests, the agents' final reports, key actions), commits and notes.
2. `src/summarize.mjs` builds the day's evidence (`dossier()`), sends it with the standing instructions (`systemPrompt()`) to the AI in `src/ai.mjs`, cleans the answer (`clean()`), and writes `data/days/YYYY-MM-DD.json`. A finished day is written once; today is refreshed when it changes. Bump `PROMPT_VERSION` to rewrite every day.
3. `src/build.mjs` adds everything up into `data/speedrun.json`: actual time per project from the session stretches, the caps, totals, weeks, best splits.
4. `src/refresh.mjs` runs 1 to 3 in order under a lock, plus a pass that merges project names written differently on different days (`data/aliases.json`).
5. `src/server.mjs` serves `public/` and `/api/speedrun`, and starts `refresh.mjs` in the background at most every 30 minutes.
6. `src/demo.mjs` writes invented days into `demo-data/` and serves them; it never touches `data/`.

## Adding a tool

If the person's AI tool isn't `claude-code` or `codex`, find where it keeps its session logs on disk and write a reader: `src/sources/README.md` has the contract and a checklist. Add made-up fixture logs for it to `test/test.mjs`, never real ones.

## After any change

Run `npm test`. It must end with "All passed." Add a check for what you changed.
