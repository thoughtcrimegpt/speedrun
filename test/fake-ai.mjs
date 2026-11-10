// A stand-in for a real AI, used only by the self-check. It reads the instructions and the day's
// evidence from standard input, like any "command" provider, and answers with a fixed write-up.
// The answer hides private details on purpose (a made-up name, email and amount) to prove that
// Speedrun removes them before anything reaches the page.

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  if (input.includes('PROJECT NAMES')) { console.log('{"aliases":{}}'); return; }
  const sids = [...new Set([...input.matchAll(/^\[([A-Z]-[0-9a-f]{8})\]/gm)].map((m) => m[1]))];
  const projects = sids.map((sid, i) => (i === 0 ? {
    name: 'Garden shop site', category: 'websites', sessions: [sid],
    done: ['Built the landing page for Zebulon Quince', 'Sent the draft to zeb@example.com for $4,500'],
    oldWay: { hours: 400, who: ['web developer'], why: 'A developer would build each page by hand.' },
    you: { mode: 'hire', hours: 2, hireLow: 900, hireHigh: 2100, why: 'You would brief a web developer.' },
    routine: false, untracked: false, highlight: '',
  } : {
    name: 'Recipe app', category: 'not-a-category', sessions: [sid],
    done: ['Added a unit converter'],
    oldWay: { hours: 30, who: ['app developer'], why: 'Forms are slow either way.' },
    you: { mode: 'self', hours: 1, hireLow: 500, hireHigh: 900, why: 'You already know how.' },
    routine: true, untracked: false, highlight: '',
  }));
  // Wrapped in a sentence and a code fence, as real models sometimes do.
  console.log('Here is the day:\n```json\n' + JSON.stringify({ headline: 'Two projects moved forward.', thin: false, thinNote: '', projects }) + '\n```');
});
