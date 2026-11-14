# Security

## Reporting a problem

Please report security problems privately: open the **Security** tab of this repository and click **Report a vulnerability**. Only the maintainer sees the report. Please don't open a public issue for a security problem.

Helpful to include: what you found, the steps to reproduce it, and your operating system and Node version.

You'll get a reply as soon as possible, and fixes go out as a normal update to `main`. There is no paid bug bounty, but you'll be credited in the fix if you'd like.

## What counts

Anything that would let Speedrun:

- be reached from another device or from a website you visit
- send your data anywhere other than the AI you chose
- start a program you didn't set up, or change, move or delete files outside its own `data/` folder
- show private words or details on the page that the privacy filter should have removed

Problems in the AI tools themselves (Claude Code, Codex, Claude Cowork or the AI service you pick) belong with those projects.

## How Speedrun stays safe

- **Runs only on your computer.** The page server listens on `127.0.0.1` only, so other devices can't reach it, and it refuses requests made under any other site name.
- **No accounts, no analytics, no tracking.** Nothing reports back to the maintainer, to GitHub or to anyone else.
- **One thing leaves your computer, on purpose:** each day's evidence (your requests, the agents' final reports, commit subjects) goes to the AI you picked in `speedrun.config.json`, to write that day up. With a local model, nothing leaves at all.
- **The AI that writes the days up gets no tools.** With the `claude` or `openai-compatible` setting it can only answer with text, so a web page or file quoted in your logs can't make it do anything on your computer. (With the `command` setting, it gets whatever the command you chose allows.)
- **Read only.** Speedrun reads your session logs and git history and never changes them. It writes only inside its own `data/` folder.
- **No outside packages.** Speedrun has no dependencies and nothing runs when you download it, so there is no hidden code from other projects.
- **A locked-down page.** Everything shown is treated as plain text, and the page's security policy blocks scripts from anywhere but Speedrun itself. Only the page itself can start an update.
- **Git is read safely.** Settings inside a repository can't make Speedrun start a program while it reads commit history.
- **Checked on every change.** The self-check (`npm test`) runs on fresh Mac, Windows and Linux machines on every update, including checks that the server stays local and that private details are removed.
