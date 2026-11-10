# Speedrun

See what you actually got done with your AI agents each day, next to an honest estimate of how long the same work would have taken before AI.

Speedrun reads the session logs your AI tools already keep on your computer, asks an AI of your choice to write each day up in plain words, and shows it on a local page:

- **Day**: what you finished, grouped by project, with three bars each: a professional's time (estimate), your own time before AI (estimate), and the real time the agents worked.
- **Week**: a recap card you can screenshot.
- **Projects**: the running total per project.
- **Best splits**: the biggest believable wins.

It runs on your computer only. No account, no upload, no tracking, nothing to install besides Node.

## Try it in one minute (made-up sample data)

You need [Node.js](https://nodejs.org) 20 or newer (22 or newer to read Codex's older compressed logs).

```bash
git clone https://github.com/thoughtcrimegpt/speedrun.git
cd speedrun
npm run demo
```

Open http://127.0.0.1:8798/. Everything on that page is invented, to show what yours will look like. The demo reads nothing of yours and uses no AI.

## Let your AI set it up

Open this folder in your AI coding tool (Claude Code, Codex, or any agent that can read files and run commands) and say:

> Read AGENTS.md and set Speedrun up for me.

It will ask you a few questions (what you do, which AI should write the days up, any names to keep off the page), write your settings, run the checks and open the page.

If you only use the Claude desktop app, do this in its **Code** tab, not in Cowork (see "Using it with Claude Cowork" below).

## Or set it up by hand

1. Copy `speedrun.config.example.json` to `speedrun.config.json` and edit it. The one line that matters most is `about`: a few sentences on who you are and what you already know how to do. The "you, before AI" estimate leans on it.
2. Optional: copy `private-terms.example.txt` to `private-terms.txt` and list names that must never show on the page.
3. Start it:

```bash
npm start
```

Open http://127.0.0.1:8799/. The first update reads your logs and writes up the newest days first (up to 30 per update), so the page fills in over a few minutes. After that it updates by itself while the page server is running, at most every 30 minutes, or when you press **Update**.

## Which AI tools it reads

| Tool | Where its logs are | Status |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | Tested on real logs |
| Codex | `~/.codex/sessions` | Tested on real logs |
| Claude Cowork | The Claude desktop app's data folder, `local-agent-mode-sessions` | Built from how the desktop app saves its sessions, and checked on real transcripts placed in that layout. Not yet tried on a live Cowork session. |
| Anything else | | Add a reader: one small file, see [src/sources/README.md](src/sources/README.md). Your AI can write it for you. |

Timing needs logs with timestamps on your own computer, so chat apps that keep their history in the cloud can't be read.

Claude Code deletes its transcripts after about 30 days. Speedrun keeps what it has already read (`data/cache`), so start it early and never clear that folder.

## Using it with Claude Cowork

Tasks you ran in the Cowork tab of the Claude desktop app show up on the page next to your other tools, timed the same way. The folder you gave a task names its project.

Two things to know:

- **Set Speedrun up outside Cowork.** Cowork works in a sealed sandbox that only sees the folders you hand it, so it can't read your session logs or keep a page running on your computer. Open this folder in the **Code** tab of the same desktop app (or in any coding agent in a terminal) and use the line above. If you ask Cowork to set it up, it should tell you this and stop.
- **Only tasks that ran on your computer are read.** Their transcripts are in the desktop app's data folder: `~/Library/Application Support/Claude/local-agent-mode-sessions` on a Mac, `%APPDATA%\Claude\local-agent-mode-sessions` on Windows. Tasks that ran in the cloud leave no transcript on your computer.

## Pick the AI that writes it up

Set `ai` in `speedrun.config.json`:

| You have | Setting |
| --- | --- |
| Claude Code (uses your signed-in plan) | `{ "provider": "claude", "model": "opus" }` (or `"sonnet"`, which is cheaper) |
| Any command-line AI | `{ "provider": "command", "command": ["your-ai", "its", "flags"] }` The instructions and the day's evidence go to its standard input; its answer is read from standard output. |
| An OpenAI-compatible service | `{ "provider": "openai-compatible", "baseUrl": "https://api.openai.com/v1", "model": "<model>", "apiKeyEnv": "OPENAI_API_KEY" }` |
| A local model (Ollama, LM Studio) | `{ "provider": "openai-compatible", "baseUrl": "http://localhost:11434/v1", "model": "<model>" }` |

The `claude` setting needs the Claude Code command-line tool: if `claude --version` does nothing in a terminal, install Claude Code first or pick another row. The desktop app alone doesn't add that command.

What has been tested: the `claude` provider on macOS with a real plan, and the other two against stand-ins in the self-check. One day's write-up is one request of roughly 15,000 to 60,000 tokens of input on a busy day, so a first run over a month of history is about 30 requests.

## Privacy

- **Everything stays on your computer.** The page server listens on `127.0.0.1` only and refuses requests from other sites.
- **Read only.** Speedrun never changes a log, a note or a repository.
- **What the AI sees:** to write a day up, Speedrun sends that day's evidence (your requests, the agents' final reports, commit subjects) to the AI you chose. With Claude Code or Codex that is the same service that already has those chats. With a local model, nothing leaves your machine.
- **What the page shows:** every line passes through a filter that removes emails, phone numbers, amounts of money, street addresses and every word in your `private-terms.txt`. The AI is also told not to write them in the first place.
- `speedrun.config.json`, `private-terms.txt` and `data/` are ignored by git, so your settings and history can't be committed by accident.

## How honest are the numbers?

They are estimates, marked "est." everywhere, and built to be believable rather than impressive:

- The AI is told to use the low end of a realistic range, for that day's slice of the work only.
- Routine work (forms, email, data entry) is capped at 3× no matter what the AI says.
- Every multiplier is capped at 100×.
- Agent time comes from timestamps in the logs: pauses over 10 minutes don't count, and chats running side by side count once.
- Scheduled and automatic runs are never counted as your time.
- Work with no timed session behind it shows as "not timed" and stays out of the totals.

"Hire out" costs are rough US market ranges in dollars.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | The page, at http://127.0.0.1:8799/ |
| `npm run demo` | The page on made-up sample data, at http://127.0.0.1:8798/ |
| `npm run refresh` | One update now, without the page |
| `npm test` | The self-check: a pretend computer with made-up logs and a stand-in AI. Never touches your data. |
| `node src/summarize.mjs --dossier 2026-01-31` | Show exactly what the AI would be sent for a day |
| `node src/summarize.mjs --instructions` | Show the standing instructions the AI gets |

## Settings

All in `speedrun.config.json` (see the example file):

| Setting | Meaning |
| --- | --- |
| `about` | Who you are and what you can already do. Drives the "you, before AI" estimate. |
| `start` | First day to read (`YYYY-MM-DD`). Empty: 90 days before the first run. |
| `sources` | Which logs to read: `claude-code`, `codex`, `cowork`. |
| `ai` | Which AI writes the days up (above). |
| `categories` | Project categories and their labels. |
| `roots` | Extra folders to search for git repositories. The folders your sessions ran in are found by themselves. |
| `notes` | Dated note files to read in each repository, for example `[".agent/HANDOFF.md"]` with `## 2026-01-31 ...` headings. |
| `port` | The page's port (8799). |
| `daysPerRun` | The most days written up per update (30), newest first. |

To have every day written up again after changing `about`, bump `PROMPT_VERSION` in `src/summarize.mjs`.

## Tested on

macOS with Node 22, on real Claude Code and Codex logs. The Cowork reader has been checked on real transcripts placed in Cowork's folder layout, not yet on a live Cowork session, and its Windows folder is untried. The self-check also runs on Linux and Windows on every change (see the Actions tab), but the `claude` provider itself has not been tried on Windows.

## License

MIT. See [LICENSE](LICENSE).
