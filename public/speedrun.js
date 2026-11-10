'use strict';
// Speedrun: what you got done each day, the old way vs. the real time.
// Data comes from the local page server (api/speedrun), which reads Speedrun's files on this computer.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const API = 'api/speedrun';
const H = { day: 8, week: 40, month: 173, year: 2080 }; // work hours, matching the server

// Categories come with the data (your settings decide them). Colors go by their order.
let CATS = { other: 'Other' };
const catName = (c) => (c === 'uncounted' ? 'Not counted' : CATS[c] || 'Other');
function catClass(c) {
  if (c === 'uncounted') return 'cat-uncounted';
  const i = Object.keys(CATS).filter((k) => k !== 'other').indexOf(c);
  return i < 0 ? 'cat-other' : `cat-${i % 9}`;
}

let data = null, status = null, view = 'day', selDay = null, selWeek = null, projFilter = 'all';
let lastBuilt = null, pollTimer = null;

// ---------- formatting ----------

function dur(min) {
  if (min == null) return 'not logged';
  min = Math.round(min);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 10) return `${Math.round(min / 60)} h`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
const nice = (v) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)).replace(/\.0$/, '');
const plural = (v, unit) => `${nice(v)} ${unit}${nice(v) === '1' ? '' : 's'}`;
/** Work time in the biggest unit that reads well: "about 3 days", "2.5 weeks". */
function work(min) {
  const h = min / 60;
  if (h < 1) return `${Math.max(5, Math.round(min / 5) * 5)} min`;
  if (h < H.day) return plural(Math.round(h * 2) / 2, 'hour');
  if (h < H.week) return plural(h / H.day, 'day');
  if (h < H.month) return plural(h / H.week, 'week');
  if (h < H.year) return plural(h / H.month, 'month');
  return plural(h / H.year, 'year');
}
/** "3-week job" */
function job(min) {
  const h = min / 60;
  // Rounded down, so the headline never claims more than the estimate.
  const f = (n) => Math.max(1, Math.floor(n));
  const [v, u] = h < H.day ? [f(h), 'hour'] : h < H.week ? [f(h / H.day), 'day'] : h < H.month ? [f(h / H.week), 'week'] : h < H.year ? [f(h / H.month), 'month'] : [f(h / H.year), 'year'];
  return `${v}-${u} job`;
}
function banked(min) {
  const h = min / 60;
  if (h >= H.year) return [nice(h / H.year), h / H.year >= 1.05 ? 'work-years' : 'work-year'];
  if (h >= H.month) return [nice(h / H.month), h / H.month >= 1.05 ? 'work-months' : 'work-month'];
  if (h >= H.week) return [nice(h / H.week), 'work-weeks'];
  return [nice(h / H.day), 'work-days'];
}
const x = (m) => (m == null ? '' : `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}×`);
const tokens = (n) => (n >= 1e9 ? `${nice(n / 1e9)}B` : n >= 1e6 ? `${nice(n / 1e6)}M` : n >= 1e3 ? `${nice(n / 1e3)}K` : String(n || 0));
const dateObj = (d) => new Date(`${d}T12:00:00`);
const longDate = (d) => dateObj(d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const shortDate = (d) => dateObj(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const isGold = (p) => !p.routine && p.mult != null && p.mult >= 20 && p.oldMin >= 16 * 60;
function multClass(p) {
  if (p.mult == null) return 'none';
  if (p.routine) return 'routine';
  if (isGold(p)) return 'gold';
  return p.mult >= 8 ? 'hot' : '';
}
// ---------- "You, before AI" ----------
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
function hire(lo, hi) {
  if (!hi) return '';
  return lo && lo !== hi ? `${usd(lo)} to ${usd(hi)}` : usd(hi);
}
const MODE_WORD = { self: 'your own work', learn: 'learning it first', hire: 'hired out', mixed: 'part you, part hired' };
/** One project's "you" estimate, short: "3 days with learning", "hire out $2,000 to $4,000 + 2 hours". */
function youShort(y) {
  if (!y) return 'not estimated';
  const h = hire(y.hireLow, y.hireHigh);
  if (y.mode === 'hire') return h ? `hire out ${h}${y.min ? ` + ${work(y.min)}` : ''}` : work(y.min || 0);
  if (y.mode === 'mixed') return `${work(y.min || 0)}${h ? ` + hire ${h}` : ''}`;
  if (y.mode === 'learn') return `${work(y.min || 0)} with learning`;
  return work(y.min || 0);
}
/** Totals: your own time, plus what the hired help would have cost. */
function youTotal(t) {
  if (!t || (!t.youMin && !t.hireHigh)) return t?.youMissing ? 'not estimated yet' : '–';
  return `${work(t.youMin)}${t.hireHigh ? ` + ${hire(t.hireLow, t.hireHigh)} hired out` : ''}${t.youMissing ? ' so far' : ''}`;
}
function youMult(y, actualMin) {
  if (!y || !y.min || actualMin == null || (y.mode !== 'self' && y.mode !== 'learn')) return null; // hired help isn't comparable time
  return Math.min(100, Math.max(1, y.min / Math.max(actualMin, 10)));
}
function youWhy(y) {
  if (!y) return '';
  return `<p class="why you"><strong>You, before AI:</strong> ${esc(MODE_WORD[y.mode] || '')}. ${esc(y.why)}</p>`;
}
/** Three bars, all on one scale: pro estimate, you before AI, real time. */
function race(oldMin, y, actualMin) {
  const yMin = y ? (y.min || 0) : 0;
  const max = Math.max(oldMin, yMin, actualMin || 0, 1);
  const w = (m) => Math.max(1.5, Math.min(100, (m / max) * 100));
  const nowPct = actualMin == null ? 0 : Math.max(0.6, Math.min(100, (actualMin / max) * 100));
  return `<div class="race">
      <span class="lbl">Pro <span class="est">est.</span></span><span class="bar old" data-css="width:${w(oldMin)}%"></span><span class="t">${esc(work(oldMin))}</span>
      <span class="lbl">You, before AI <span class="est">est.</span></span><span class="bar you${y && (y.mode === 'hire' || y.mode === 'mixed') ? ' hired' : ''}" data-css="width:${y ? w(yMin) : 0}%"></span><span class="t">${esc(youShort(y))}</span>
      <span class="lbl">Agent time</span><span class="bar now"><i data-css="width:${nowPct}%"></i></span><span class="t">${esc(actualMin == null ? 'not timed' : dur(actualMin))}</span>
    </div>`;
}

function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function toast(message, error = false) {
  const el = $('toast');
  el.className = 'toast' + (error ? ' error' : '');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 5000);
}

// ---------- data ----------

async function load(force = false) {
  try {
    const r = await fetch(API, { cache: 'no-store' });
    const j = await r.json();
    status = j.status || null;
    if (j.data && (force || j.data.builtAt !== lastBuilt)) {
      data = j.data;
      CATS = data.categories || CATS;
      $('demo').hidden = !data.demo;
      lastBuilt = data.builtAt;
      if (!selDay || !data.days.some((d) => d.day === selDay)) selDay = (data.days.find((d) => d.projects.length || d.day === data.today) || data.days[0])?.day;
      if (!selWeek) selWeek = data.weeks[0]?.week;
      render();
    } else if (!data) render();
    summary();
  } catch {
    $('summary').textContent = 'Could not reach Speedrun on this computer. Is it still running?';
  }
  clearTimeout(pollTimer);
  pollTimer = setTimeout(load, status?.running ? 8000 : 120_000);
}

async function refreshNow() {
  $('refresh').disabled = true;
  try {
    const r = await fetch(`${API}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Speedrun': '1' }, body: '{}' });
    const j = await r.json();
    toast(j.message || (j.ok ? 'Updating.' : 'Could not start the update.'), !j.ok);
  } catch { toast('Could not reach Speedrun on this computer.', true); }
  $('refresh').disabled = false;
  setTimeout(load, 1500);
}

function summary() {
  const el = $('summary');
  const problem = status?.lastError && !status.running ? ` · <span class="problem" title="${esc(status.lastError)}">Last update had a problem: ${esc(status.lastError)}</span>` : '';
  if (!data) { el.innerHTML = status?.running ? '<span class="working">Reading your sessions for the first time. This takes a few minutes.</span>' : `No Speedrun data yet.${problem}`; return; }
  const a = data.totals.all;
  const [n, u] = banked(a.savedMin);
  const parts = [`${n} ${u} banked since ${shortDate(data.start)}`, `${data.shippedDays} days with something shipped`];
  if (data.streak > 1) parts.push(`${data.streak} days in a row`);
  el.innerHTML = esc(parts.join(' · ')) + (status?.running ? ` · <span class="working">${esc(status.phase || 'Updating')}</span>` : status?.lastRun ? ` · <span title="${esc(status.lastRun)}">updated ${esc(ago(status.lastRun))}</span>` : '') + (status?.waiting ? ` · ${status.waiting} older ${status.waiting === 1 ? 'day waits' : 'days wait'} for the next update` : '') + problem;
}

// ---------- views ----------

function render() {
  for (const a of document.querySelectorAll('#views a')) a.setAttribute('aria-current', String(a.dataset.view === view));
  const main = $('main');
  if (!data) {
    main.innerHTML = `<div class="empty-state">${status?.running ? '<p class="working">Reading your sessions.</p><p>The first run takes a few minutes. This page fills in by itself.</p>' : '<p>Nothing here yet.</p><p><button class="btn primary" id="go">Read my sessions</button></p>'}</div>`;
    $('go')?.addEventListener('click', refreshNow);
    return;
  }
  if (view === 'week') main.innerHTML = weekView();
  else if (view === 'projects') main.innerHTML = projectsView();
  else if (view === 'best') main.innerHTML = bestView();
  else main.innerHTML = dayView();
  wire();
}

function hero() {
  const t = data.totals;
  const a = t.all;
  const h = a.savedMin / 60;
  const marks = [[H.week, '1 work-week'], [H.month, '1 work-month'], [3 * H.month, '3 work-months'], [6 * H.month, '6 work-months'], [H.year, '1 work-year'], [2 * H.year, '2 work-years'], [3 * H.year, '3 work-years'], [5 * H.year, '5 work-years'], [10 * H.year, '10 work-years']];
  const next = marks.find(([v]) => v > h) || marks[marks.length - 1];
  const prev = [...marks].reverse().find(([v]) => v <= h);
  const pct = Math.min(100, (h / next[0]) * 100);
  const ticks = marks.filter(([v]) => v < next[0]).map(([v]) => `<b data-css="left:${(v / next[0]) * 100}%"></b>`).join('');
  const [n, u] = banked(a.savedMin);
  const tile = (k, s) => `<div class="tile"><p class="k">${k}</p><p class="v num">${s.savedMin ? `${banked(s.savedMin)[0]} <small>${banked(s.savedMin)[1]}</small>` : 'nothing yet'}</p><p class="s">${s.actualMin ? `${work(s.oldMin)} of work in ${dur(s.actualMin)} of agent time, ${dur(s.handsMin)} yours` : 'no tracked work yet'}</p>${s.actualMin && (s.youMin || s.hireHigh) ? `<p class="s">You, before AI: ${esc(youTotal(s))}</p>` : ''}</div>`;
  return `<section class="panel hero">
    <div class="bank">
      <div>
        <p class="eyebrow">Time banked since ${esc(shortDate(data.start))} <span class="est">est.</span></p>
        <p class="big num">${n}<small>${u}</small></p>
        <p class="sub">${esc(work(a.oldMin))} of work for a pro, done in ${esc(dur(a.actualMin))} of agent time${a.mult ? `, ${x(a.mult)} faster overall` : ''}. About ${esc(dur(a.handsMin))} of that was you at the keyboard <span class="est">est.</span></p>
        <p class="sub you-line"><span class="est">est.</span> You, before AI: <b>${esc(youTotal(a))}</b>, learning included.</p>
      </div>
      <div>
        <div class="meter" role="img" aria-label="${Math.round(pct)}% of the way to ${esc(next[1])} banked"><i data-css="width:${pct}%"></i>${ticks}</div>
        <div class="meter-label"><span>${prev ? `Passed ${esc(prev[1])}` : 'Just getting started'}</span><span>${Math.round(pct)}% to ${esc(next[1])}</span></div>
      </div>
    </div>
    <div class="tiles">
      ${tile('This week', t.week)}
      ${tile('This month', t.month)}
      <div class="tile"><p class="k">Finished</p><p class="v num">${a.items} <small>things</small></p><p class="s">across ${data.projects.length} projects</p></div>
      <div class="tile"><p class="k">Run</p><p class="v num">${data.streak} <small>${data.streak === 1 ? 'day' : 'days'}</small></p><p class="s">in a row with something shipped</p></div>
    </div>
  </section>`;
}

function calendar() {
  const days = [...data.days].reverse();
  const max = Math.max(1, ...days.map((d) => d.savedMin));
  const first = dateObj(days[0].day);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const cells = [];
  const all = [...Array(lead).fill(null), ...days];
  let lastMonth = '';
  for (let i = 0; i < all.length; i += 7) {
    const wk = all.slice(i, i + 7);
    const mon = dateObj(wk.find(Boolean).day).toLocaleDateString('en-US', { month: 'short' });
    cells.push(`<span class="m">${mon !== lastMonth ? mon : ''}</span>`);
    lastMonth = mon;
    for (let r = 0; r < 7; r++) {
      const d = wk[r];
      if (!d) { cells.push('<button class="pad" tabindex="-1" aria-hidden="true"></button>'); continue; }
      const lvl = d.savedMin <= 0 ? 0 : Math.min(4, 1 + Math.floor((d.savedMin / max) * 4));
      cells.push(`<button type="button" class="l${lvl}${d.thin ? ' thin' : ''}${d.day === selDay ? ' sel' : ''}" data-day="${d.day}" title="${esc(`${longDate(d.day)}: ${d.savedMin ? `${work(d.oldMin)} of work in ${dur(d.actualMin)}` : 'nothing tracked'}`)}" aria-label="${esc(longDate(d.day))}"></button>`);
    }
  }
  return `<section class="panel">
    <p class="eyebrow">Every day since ${esc(shortDate(data.start))}</p>
    <div class="cal-wrap"><div class="cal">${cells.join('')}</div></div>
    <div class="cal-legend"><span>Darker = more old-way time saved. Click a day.</span><span><i data-css="outline:1px dashed var(--faint);outline-offset:-1px"></i> thin data</span></div>
  </section>`;
}

function strip(d) {
  const start = dateObj(d.day); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime(), span = 86400_000;
  const segs = d.strip.map(([a, b, c]) => `<i class="${catClass(c)}" data-css="left:${((a - t0) / span) * 100}%;width:${Math.max(0.15, ((b - a) / span) * 100)}%"></i>`).join('');
  const cats = [...new Set(d.strip.map((s) => s[2]))];
  return `<div class="strip" role="img" aria-label="When work happened">${segs}</div>
    <div class="strip-ticks"><span data-css="left:0">12am</span><span data-css="left:25%">6am</span><span data-css="left:50%">noon</span><span data-css="left:75%">6pm</span><span data-css="left:100%">12am</span></div>
    <div class="legend">${cats.map((c) => `<span class="${catClass(c)}">${esc(catName(c))}</span>`).join('')}</div>`;
}

function split(p) {
  const mc = multClass(p);
  const ym = youMult(p.you, p.actualMin);
  const vsYou = p.mult == null || !p.you ? '' : ym ? `<small>vs. you: ${x(Math.round(ym * 10) / 10)}</small>` : p.you.hireHigh ? `<small>vs. you: ${p.you.mode === 'hire' ? 'hired out' : 'partly hired'}</small>` : '';
  const label = p.mult == null ? '<b>not timed</b><span>work ran outside logs</span>' : p.routine ? `<b>${x(p.mult)}</b><span>routine</span>${vsYou}` : `<b>${x(p.mult)}</b><span>faster</span>${vsYou}`;
  return `<article class="split ${catClass(p.category)}${isGold(p) ? ' gold' : ''}">
    <div class="split-head">
      <div><h3>${esc(p.name)}${isGold(p) ? '<span class="badge-gold">Gold split</span>' : ''}</h3><p class="cat">${esc(catName(p.category))}${p.highlight ? ` · ${esc(p.highlight)}` : ''}</p></div>
      <div class="mult ${mc}">${label}</div>
    </div>
    ${race(p.oldMin, p.you, p.actualMin)}
    <ul class="done">${p.done.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <p class="why"><strong>Pro:</strong> ${esc(p.who.join(', ') || 'one professional')}. ${esc(p.why)}</p>
    ${youWhy(p.you)}
  </article>`;
}

function dayView() {
  const i = data.days.findIndex((d) => d.day === selDay);
  const d = data.days[i];
  if (!d) return `<div class="empty-state"><p>No AI sessions were found on this computer yet.</p><p>Speedrun reads the logs of ${esc(new Intl.ListFormat('en', { type: 'conjunction' }).format(data.tools || []) || 'your AI tools')}. Work with one of them, then press Update.</p></div>`;
  const newer = data.days[i - 1], older = data.days[i + 1];
  const tracked = d.projects.filter((p) => p.actualMin != null);
  const mult = d.actualMin ? d.oldMin / Math.max(d.actualMin, 10) : null;
  return `${hero()}${calendar()}
  <div class="daybar">
    <h2>${esc(d.day === data.today ? `Today, ${shortDate(d.day)}` : longDate(d.day))}</h2>
    <div class="nav">
      <button type="button" class="btn small" data-go="${older ? older.day : ''}" ${older ? '' : 'disabled'} aria-label="Day before">‹</button>
      <button type="button" class="btn small" data-go="${data.today}" ${d.day === data.today ? 'disabled' : ''}>Today</button>
      <button type="button" class="btn small" data-go="${newer ? newer.day : ''}" ${newer ? '' : 'disabled'} aria-label="Day after">›</button>
    </div>
  </div>
  <section class="panel">
    ${d.headline ? `<p class="headline">${esc(d.headline)}</p>` : ''}
    ${d.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
    ${d.pending ? '<p class="note">This day is still being written up. It fills in after the next update.</p>' : ''}
    <div class="dayline">
      <div class="stat"><span class="k">Pro <span class="est">est.</span></span><span class="v num">${tracked.length ? esc(work(d.oldMin)) : '–'}</span></div>
      <div class="stat you"><span class="k">You, before AI <span class="est">est.</span></span><span class="v num">${tracked.length ? esc(youTotal(d)) : '–'}</span></div>
      <div class="stat"><span class="k">Agent time</span><span class="v num">${tracked.length ? esc(dur(d.actualMin)) : '–'}</span></div>
      <div class="stat"><span class="k">Your time <span class="est">est.</span></span><span class="v num">${d.handsMin ? esc(dur(d.handsMin)) : '–'}</span></div>
      <div class="stat x"><span class="k">Speed</span><span class="v num">${mult ? esc(x(Math.round(mult * 10) / 10)) : '–'}</span></div>
      <div class="stat"><span class="k">Finished</span><span class="v num">${d.projects.reduce((n, p) => n + p.done.length, 0)} things</span></div>
    </div>
    ${d.strip.length ? strip(d) : ''}
  </section>
  <div class="splits">${d.projects.map(split).join('') || '<div class="empty-state">Nothing finished was logged this day.</div>'}</div>
  <p class="tokens">${d.sessionCount} sessions · ${d.activeMin ? `${esc(dur(d.activeMin))} of agent time` : 'no agent time'}${d.commits ? ` · ${d.commits} code saves` : ''} · Tokens: ${tokens(d.tokens)} (${tokens(d.fresh)} new). "New" leaves out context the model re-read.</p>`;
}

function weekView() {
  const i = data.weeks.findIndex((w) => w.week === selWeek);
  const w = data.weeks[i] || data.weeks[0];
  if (!w) return '<div class="empty-state">No weeks yet.</div>';
  const newer = data.weeks[i - 1], older = data.weeks[i + 1];
  const end = dateObj(w.week); end.setDate(end.getDate() + 6);
  const range = `${shortDate(w.week)} to ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const catTotal = Object.values(w.cats).reduce((a, b) => a + b, 0) || 1;
  const cats = Object.entries(w.cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const wdays = [];
  const maxSaved = Math.max(1, ...data.days.filter((d) => d.week === w.week).map((d) => d.savedMin));
  for (let k = 0; k < 7; k++) {
    const dd = dateObj(w.week); dd.setDate(dd.getDate() + k);
    const key = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
    const d = data.days.find((x) => x.day === key);
    const hgt = d ? Math.max(3, (d.savedMin / maxSaved) * 70) : 0;
    wdays.push(`<div title="${esc(d ? `${longDate(key)}: ${work(d.oldMin)} in ${dur(d.actualMin)}` : longDate(key))}">${d ? `<i class="${d.thin ? 'thin' : ''}" data-css="height:${hgt}px"></i>` : ''}<span>${dd.toLocaleDateString('en-US', { weekday: 'short' })}</span></div>`);
  }
  const [bn, bu] = banked(w.savedMin);
  return `<div class="weeknav">
    <button type="button" class="btn small" data-week="${older ? older.week : ''}" ${older ? '' : 'disabled'}>‹ Earlier</button>
    <span class="proj-meta">A recap you can screenshot</span>
    <button type="button" class="btn small" data-week="${newer ? newer.week : ''}" ${newer ? '' : 'disabled'}>Later ›</button>
  </div>
  <section class="recap" id="recap">
    <div class="brand"><span>Speedrun · Week of ${esc(range)}</span><span>${w.days} days logged</span></div>
    <p class="big num">${esc(work(w.oldMin))} of work</p>
    <p class="sub">for a pro, done in <b>${esc(dur(w.actualMin))}</b> of agent time${w.mult ? `, <b>${esc(x(w.mult))}</b> faster` : ''}, about <b>${esc(dur(w.handsMin))}</b> of it yours. ${esc(bn)} ${esc(bu)} banked.</p>
    <p class="sub you-line"><span class="est">est.</span> You, before AI: <b>${esc(youTotal(w))}</b></p>
    <div class="facts"><span>${w.items} things finished</span><span>${w.workDays} working days</span>${w.thin ? `<span>${w.thin} thin-data ${w.thin === 1 ? 'day' : 'days'}</span>` : ''}</div>
    <h4>Biggest runs</h4>
    ${w.top.map((p, k) => `<div class="toprun"><span class="rank">${k + 1}</span><span class="what"><b>${esc(p.name)}</b><span>${esc(job(p.oldMin))}, done in ${esc(dur(p.actualMin))}${p.you ? ` · you: ${esc(youShort(p.you))}` : ''} · ${esc(p.line)}</span></span><span class="x${isGold(p) ? ' gold' : ''}">${esc(x(p.mult))}</span></div>`).join('') || '<p class="proj-meta">No timed runs this week.</p>'}
    <h4>Where the time went</h4>
    <div class="stack">${cats.map(([c, v]) => `<i class="${catClass(c)}" data-css="width:${(v / catTotal) * 100}%" title="${esc(catName(c))}: ${esc(work(v))}"></i>`).join('')}</div>
    <div class="legend">${cats.map(([c, v]) => `<span class="${catClass(c)}">${esc(catName(c))} ${esc(work(v))}</span>`).join('')}</div>
    <h4>Day by day</h4>
    <div class="weekdays">${wdays.join('')}</div>
    <p class="fine">Pro and "you, before AI" times are conservative estimates in work time (40-hour weeks); hired-out costs are rough market ranges. Agent time comes from session timestamps, side-by-side chats counted once; your time is estimated from when you sent messages.</p>
  </section>`;
}

function projectsView() {
  const cats = ['all', ...new Set(data.projects.map((p) => p.category))];
  const list = data.projects.filter((p) => projFilter === 'all' || p.category === projFilter);
  return `<div class="filters">${cats.map((c) => `<button type="button" data-filter="${esc(c)}" aria-pressed="${c === projFilter}">${esc(c === 'all' ? 'All' : catName(c))}</button>`).join('')}</div>
  <div class="splits">${list.map((p) => {
    const fake = { ...p, routine: false, mult: p.mult };
    const y = p.youCount ? { mode: p.youModes.length === 1 ? p.youModes[0] : 'mixed', min: p.youMin, hireLow: p.hireLow, hireHigh: p.hireHigh, why: p.youWhy } : null;
    return `<article class="split ${catClass(p.category)}${isGold(fake) ? ' gold' : ''}">
      <div class="split-head">
        <div><h3>${esc(p.name)}</h3><p class="proj-meta">${esc(catName(p.category))} · ${p.dayCount} ${p.dayCount === 1 ? 'day' : 'days'} · ${esc(p.first === p.last ? shortDate(p.first) : `${shortDate(p.first)} to ${shortDate(p.last)}`)}</p></div>
        <div class="mult ${multClass(fake)}">${p.mult ? `<b>${esc(x(p.mult))}</b><span>faster</span>` : '<b>not timed</b>'}</div>
      </div>
      ${race(p.oldMin, y, p.actualMin || null)}
      <p class="why"><strong>Pro would have needed:</strong> ${esc(p.who.join(', ') || 'one professional')}</p>
      ${y ? `<p class="why you"><strong>You, before AI:</strong> ${esc(youTotal({ youMin: p.youMin, hireLow: p.hireLow, hireHigh: p.hireHigh }))} in all${p.youMissing ? ` (${p.youMissing} older ${p.youMissing === 1 ? 'day' : 'days'} not estimated)` : ''}. ${esc(p.youWhy)}</p>` : ''}
      <details class="more"><summary>Latest ${Math.min(8, p.done.length)} things done</summary>
        <ul class="done">${p.done.map((l) => `<li><span class="d">${esc(shortDate(l.day))}</span>${esc(l.line)}</li>`).join('')}</ul>
      </details>
    </article>`;
  }).join('')}</div>`;
}

function bestView() {
  if (!data.gold.length) return '<div class="empty-state">No gold splits yet. They show up when something that would have taken days took a fraction of the time.</div>';
  return `<p class="proj-meta" data-css="margin:4px 0 12px">The biggest believable wins: at least two days of old-way work, routine work left out.</p>
  <div class="best">${data.gold.map((g, k) => `<article class="trophy ${catClass(g.category)}${k === 0 ? ' first' : ''}">
    <p class="phrase">${esc(job(g.oldMin))}, done in <em>${esc(dur(g.actualMin))}</em> of agent time</p>
    <p class="what">${esc(g.line)}</p>
    <p class="meta">${esc(g.name)} · ${esc(longDate(g.day))} · ${esc(x(g.mult))} faster</p>
    <p class="why"><strong>Pro:</strong> ${esc(g.who.join(', '))}. ${esc(g.why)}</p>
    ${g.you ? `<p class="why you"><strong>You, before AI:</strong> ${esc(youShort(g.you))}. ${esc(g.you.why)}</p>` : ''}
  </article>`).join('')}</div>`;
}

function wire() {
  // The page's security policy blocks inline style attributes, so sizes are applied here.
  for (const el of document.querySelectorAll('[data-css]')) {
    for (const decl of el.dataset.css.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
    }
  }
  for (const b of document.querySelectorAll('[data-day]')) b.addEventListener('click', () => { selDay = b.dataset.day; setHash(); render(); });
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => { if (b.dataset.go) { selDay = b.dataset.go; setHash(); render(); } });
  for (const b of document.querySelectorAll('[data-week]')) b.addEventListener('click', () => { if (b.dataset.week) { selWeek = b.dataset.week; setHash(); render(); } });
  for (const b of document.querySelectorAll('[data-filter]')) b.addEventListener('click', () => { projFilter = b.dataset.filter; render(); });
}

function setHash() {
  const h = view === 'day' ? `#day=${selDay}` : view === 'week' ? `#week=${selWeek}` : `#${view}`;
  try { history.replaceState(null, '', h); } catch { /* ignore */ }
}

function readHash() {
  const m = location.hash.match(/^#(day|week|projects|best)(?:=(\d{4}-\d{2}-\d{2}))?/);
  view = m ? m[1] : 'day';
  if (m && m[2]) { if (view === 'day') selDay = m[2]; else selWeek = m[2]; }
}

window.addEventListener('hashchange', () => { readHash(); render(); });
document.addEventListener('keydown', (e) => {
  if (view !== 'day' || !data || e.target.closest('input, textarea')) return;
  const i = data.days.findIndex((d) => d.day === selDay);
  if (e.key === 'ArrowLeft' && data.days[i + 1]) { selDay = data.days[i + 1].day; setHash(); render(); }
  if (e.key === 'ArrowRight' && i > 0) { selDay = data.days[i - 1].day; setHash(); render(); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
$('refresh').addEventListener('click', refreshNow);

readHash();
load();
