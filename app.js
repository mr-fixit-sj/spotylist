// SpotyList front end: static chart data (built by scraper/build.mjs) linked to Spotify.
// Track links and cover images come precomputed in the data. The only API calls are for the
// optional Spotify login, to save a list as a playlist (spotify.js).
// Pages: #home (this week's charts and a random year back), #<chart>/<period> (a list),
// #artist/<slug>/<nl|uk|us> (an artist's songs in one chart); the bare address opens home.
import { artKind, artSvg } from './art.js';
import { openHistory } from './history.js';
import { prefs, isMobile, getOpenMode, isFixMode, renderAccount, showVersion, menuReady } from './menu.js';
import { logout, loggedInAs, findPlaylist, playlistExists, canFindPlaylists, createPlaylist, replacePlaylist, SpotifyError } from './spotify.js';

const COUNTRIES = { NL: 'Netherlands', GB: 'United Kingdom', US: 'United States', Beatport: 'Beatport Top 100', Collections: 'Collections' };
const $ = (id) => document.getElementById(id);

const ui = {
  chart: $('chart'), year: $('year'), period: $('period'),
  yearField: $('year-field'), periodField: $('period-field'), periodLabel: $('period-label'),
  prev: $('prev'), next: $('next'),
  head: $('list-head'), title: $('list-title'), stats: $('list-stats'), source: $('list-source'),
  copy: $('copy'), copyHint: $('copy-hint'), status: $('status'), tracks: $('tracks'),
  playlist: $('playlist'), playlistHint: $('playlist-hint'),
  home: $('home'), homeWeek: $('home-week'), homeHistory: $('home-history'),
  historyTitle: $('history-title'), historySub: $('history-sub'), historyNext: $('history-next'), historyPause: $('history-pause'),
  backdrop: $('backdrop'), stepper: $('prev').parentElement,
  sourceWrap: $('list-source-wrap'), about: $('list-about'),
  fact: $('fact'), factText: $('fact-text'), factLink: $('fact-link'), factNext: $('fact-next'),
  artistQ: $('artist-q'), artistResults: $('artist-results'), tabs: $('artist-tabs'), career: $('artist-career'), photo: $('artist-photo'),
};

// Settings live in the ☰ menu (menu.js), shared by every page; this page follows their changes.
let openMode = getOpenMode();
let fixMode = isFixMode();

/** The week opened when a year is picked in the Year menu. */
const MID_YEAR_WEEK = 26;
const REPO = 'mr-fixit-sj/git-repos-spotylist';

let catalogue = [];
let homeData = null;
let historyYear = null;
let artShown = null;
const fileCache = new Map();
let current = { chart: null, period: null, links: [], ids: [], total: 0 };

const fileFor = (chart, period) => (chart.kind === 'weekly' ? period.slice(0, 4) : 'all');

/** All periods of a chart in chronological order, for prev/next. */
const allPeriods = (chart) => Object.keys(chart.files).sort().flatMap((f) => chart.files[f]);

/** `short` omits the year, for the week dropdown that sits next to the year dropdown. */
function periodLabel(chart, period, { short = false } = {}) {
  if (chart.kind === 'list') return '';
  if (chart.kind === 'yearly' || chart.kind === 'collection') return period; // "1985", "1980s"
  const week = period.match(/^(\d{4})-(\d{2})$/);
  if (week) return short ? `Week ${Number(week[2])}` : `Week ${Number(week[2])}, ${week[1]}`;
  const date = new Date(`${period}T00:00:00Z`);
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(short ? {} : { year: 'numeric' }), timeZone: 'UTC' });
  return short ? day : `Week of ${day}`;
}

async function loadFile(chart, file) {
  const key = `${chart.id}/${file}`;
  if (!fileCache.has(key)) {
    fileCache.set(key, fetch(`data/${key}.json`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }));
  }
  return fileCache.get(key);
}

function option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function fillChartSelect() {
  const placeholder = option('', 'Choose a chart…');
  placeholder.disabled = true;
  ui.chart.append(placeholder);
  const byCountry = Map.groupBy(catalogue, (c) => c.country);
  for (const [country, charts] of byCountry) {
    const group = document.createElement('optgroup');
    group.label = COUNTRIES[country] ?? country;
    // Charts of a group (the decade lists) share one entry; the Decade menu picks one of them.
    const listed = new Set();
    for (const c of charts) {
      if (!c.group) group.append(option(c.id, c.label));
      else if (!listed.has(c.group.id)) group.append(option(c.group.id, c.group.label)), listed.add(c.group.id);
    }
    ui.chart.append(group);
  }
}

/** The charts of a group, in menu order (e.g. the decade lists 60's … 00's). */
const groupMembers = (groupId) => catalogue.filter((c) => c.group?.id === groupId);

function fillPeriodSelects(chart, period) {
  if (chart.group) {
    // A chart of a group: its menu picks the group's chart (e.g. Decade: 60's … 00's).
    const members = groupMembers(chart.group.id);
    ui.yearField.hidden = true;
    ui.periodField.hidden = false;
    ui.periodLabel.textContent = 'Decade';
    ui.period.replaceChildren(...members.map((c) => option(c.id, c.group.item)));
    ui.period.value = chart.id;
    const i = members.indexOf(chart);
    ui.prev.disabled = i <= 0;
    ui.next.disabled = i >= members.length - 1;
    ui.prev.parentElement.hidden = false;
    return;
  }
  ui.yearField.hidden = chart.kind !== 'weekly';
  ui.periodField.hidden = chart.kind === 'list';
  ui.periodLabel.textContent = chart.periodName ?? (chart.kind === 'yearly' ? 'Year' : 'Week');

  const file = fileFor(chart, period);
  if (chart.kind === 'weekly') {
    ui.year.replaceChildren(...Object.keys(chart.files).sort().reverse().map((y) => option(y, y)));
    ui.year.value = file;
  }
  const periods = [...(chart.files[file] ?? [])].reverse();
  ui.period.replaceChildren(...periods.map((p) => option(p, periodLabel(chart, p, { short: true }))));
  ui.period.value = period;

  const all = allPeriods(chart);
  const i = all.indexOf(period);
  ui.prev.disabled = i <= 0;
  ui.next.disabled = i < 0 || i >= all.length - 1;
  ui.prev.parentElement.hidden = chart.kind === 'list';
}

/** Track (or search, without a match) link for the chosen open mode. */
function spotifyHref(spotifyId, query) {
  if (openMode === 'app') {
    return spotifyId ? `spotify:track:${spotifyId}` : `spotify:search:${encodeURIComponent(query)}`;
  }
  return spotifyId
    ? `https://open.spotify.com/track/${spotifyId}`
    : `https://open.spotify.com/search/${encodeURIComponent(query)}`;
}

function fixIssueUrl(track) {
  const [artist, title, spotifyId, , spName, spArtists] = track;
  const now = spotifyId ? `${spName ?? 'a track'} – ${spArtists ?? ''} (${spotifyId})` : 'no Spotify link';
  const body = [
    'Paste the right Spotify song link here (in Spotify: ··· → Share → Copy Song Link),',
    'or write none on its own line if this song is not on Spotify. Then click Create.',
    '',
    '',
    '',
    `Chart: ${artist} – ${title}`,
    `Now linked to: ${now}`,
    `<!-- spotylist-fix ${JSON.stringify({ artist, title })} -->`,
    '',
  ].join('\n');
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(`Spotify fix: ${artist} – ${title}`)}&body=${encodeURIComponent(body)}`;
}

// Faint magnifier in the cover spot of songs without a linked track: the row opens a search.
const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// Badges before the artist (scraper/build.mjs): this week's "new" / "new:us:1972" / "back:N" /
// "weeks:N" from the chart week, and a Christmas classic ("x" in the track row) everywhere.
const OTHER_CHART = { nl: ['NL', 'the Dutch Top 40'], uk: ['UK', 'the UK chart'], us: ['US', 'the US Hot 100'] };
function badgeList(badge, flags) {
  const out = [];
  const [kind, n, year] = String(badge ?? '').split(':');
  const other = OTHER_CHART[n];
  if (kind === 'new' && other && year) out.push([`NEW · ${other[0]} ${year}`, `First week in this chart, but in ${other[1]} since ${year}`, 'new']);
  else if (kind === 'new') out.push(['NEW', 'First week in this chart', 'new']);
  if (kind === 'back') out.push([`↺ ${n} yrs`, `Back in this chart after ${n} years away`, 'back']);
  if (kind === 'weeks') out.push([`${n} wks`, `${n} weeks in this chart so far`, 'weeks']);
  if (flags === 'x') out.push(['🎄', 'Christmas classic: back in the charts every Christmas', 'xmas']);
  return out.map(([text, title, cls]) => Object.assign(document.createElement('span'), { className: `badge badge-${cls}`, textContent: text, title }));
}

// Country flags, drawn (Windows shows emoji flags as the letters "NL", "GB", "US"): on an
// artist's page, by each song's peak and in the filter.
const FLAGS = {
  nl: ['the Dutch Top 40', '<svg viewBox="0 0 9 6" preserveAspectRatio="none"><path fill="#ae1c28" d="M0 0h9v2H0z"/><path fill="#fff" d="M0 2h9v2H0z"/><path fill="#21468b" d="M0 4h9v2H0z"/></svg>'],
  uk: ['the UK chart', '<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice"><path fill="#012169" d="M0 0h60v30H0z"/><path d="M0 0l60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30M60 0L0 30" stroke="#c8102e" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6"/></svg>'],
  us: ['the US Hot 100', '<svg viewBox="0 0 19 10" preserveAspectRatio="xMidYMid slice"><path fill="#b22234" d="M0 0h19v10H0z"/><path d="M0 1.15h19M0 2.69h19M0 4.23h19M0 5.77h19M0 7.31h19M0 8.85h19" stroke="#fff" stroke-width=".77"/><path fill="#3c3b6e" d="M0 0h7.6v5.38H0z"/></svg>'],
};

function trackItem(pos, track, badge) {
  const [artist, title, spotifyId, imageId, spName, spArtists, pending, flags] = track;
  const li = document.createElement('li');
  li.dataset.pos = pos;
  const a = document.createElement('a');
  a.className = 'track';
  a.href = spotifyHref(spotifyId, `${artist} ${title}`);
  // spotify: links hand over to the app and leave this page as it is. Web links all reuse
  // one named tab, so clicking through a list does not pile up web-player tabs.
  // (No rel="noopener": browsers then always open a fresh tab, even for a named target.)
  if (openMode === 'web') a.target = 'spotylist-player';
  if (!spotifyId) {
    li.className = 'missing';
    a.title = pending ? 'Not looked up on Spotify yet: opens a search' : 'No Spotify track linked: opens a search';
  }

  const posEl = document.createElement('span');
  posEl.className = 'pos';
  posEl.textContent = pos;

  const cover = document.createElement(imageId ? 'img' : 'span');
  cover.className = 'cover';
  if (imageId) {
    cover.src = `https://i.scdn.co/image/${imageId}`;
    cover.alt = '';
    cover.loading = 'lazy';
    cover.addEventListener('error', () => {
      const blank = document.createElement('span');
      blank.className = 'cover';
      cover.replaceWith(blank);
    });
  } else if (!spotifyId) {
    cover.innerHTML = SEARCH_ICON;
  }

  const names = document.createElement('span');
  names.className = 'names';
  const t = document.createElement('span');
  t.className = 'title';
  t.textContent = spName ?? title;
  const ar = document.createElement('span');
  ar.className = 'artist';
  ar.textContent = spArtists ?? artist;
  // In front, so a long artist name cut off with "…" never hides them.
  ar.prepend(...badgeList(badge, flags));
  names.append(t, ar);

  const go = document.createElement('span');
  go.className = 'go';
  const arrow = openMode === 'web' ? ' ↗' : '';
  go.textContent = spotifyId ? `Open in Spotify${arrow}` : `Search Spotify${arrow}`;

  a.append(posEl, cover, names, go);
  li.append(a);
  // The song's chart history (history.js), for songs of the weekly NL, UK and US charts.
  const songId = track[8];
  if (songId) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'history-btn';
    more.title = 'Chart history';
    more.setAttribute('aria-label', `Chart history of ${spName ?? title}`);
    more.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 17l5-6 4 3 7-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 21h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    more.addEventListener('click', () => openHistory(track, {
      spotify: spotifyHref(spotifyId, `${artist} ${title}`),
      go: (hash, pos) => {
        spotlight = { hash, positions: [pos] };
        if (decodeURIComponent(location.hash) === decodeURIComponent(hash)) applySpotlight(); // already on that week
      },
    }));
    li.append(more);
  }
  if (fixMode) {
    const fix = document.createElement('a');
    fix.className = 'fix';
    fix.href = fixIssueUrl(track);
    fix.target = '_blank';
    fix.rel = 'noopener';
    fix.textContent = 'Fix';
    fix.title = 'Correct the Spotify link of this song';
    li.append(fix);
  }
  return li;
}

/** The faint background art: a fresh variation when the kind of chart changes (or on home). */
function setArt(kind, { force = false } = {}) {
  if (!force && kind === artShown) return;
  artShown = kind;
  ui.backdrop.innerHTML = artSvg(kind);
}

async function show(chartId, period, { updateHash = true } = {}) {
  const chart = catalogue.find((c) => c.id === chartId);
  ui.home.hidden = true;
  scheduleHistory(); // stops turning the years
  ui.tracks.hidden = false;
  setArt(artKind(chart.id));
  const periods = allPeriods(chart);
  if (!periods.includes(period)) period = periods.at(-1);
  current = { chart, period, links: [], ids: [], total: 0 };
  ui.tabs.hidden = true;
  ui.career.hidden = true;
  ui.photo.hidden = true;
  ui.head.classList.remove('with-photo');

  ui.chart.value = chart.group?.id ?? chart.id;
  fillPeriodSelects(chart, period);
  if (updateHash) history.replaceState(null, '', `#${chart.id}/${period}`);

  ui.status.textContent = 'Loading…';
  ui.copyHint.hidden = true;
  ui.head.after(ui.playlistHint); // back from under an artist page's section heading
  ui.playlistHint.hidden = true;
  let data;
  try {
    data = await loadFile(chart, fileFor(chart, period));
  } catch (err) {
    ui.status.textContent = `Could not load this chart (${err.message}).`;
    return;
  }
  if (current.period !== period || current.chart !== chart) return; // a newer selection won

  const { url, entries } = data.periods[period];
  // Position column as wide as the longest number in this list (2 digits for a Top 40).
  ui.tracks.style.setProperty('--pos-digits', String(Math.max(...entries.map(([pos]) => pos))).length);
  const rows = entries.map(([pos, idx, badge]) => trackItem(pos, data.tracks[idx], badge));
  current.ids = entries.map(([, idx]) => data.tracks[idx][2]).filter(Boolean);
  current.links = current.ids.map((id) => `https://open.spotify.com/track/${id}`);
  current.total = entries.length;

  ui.tracks.replaceChildren(...rows);
  ui.title.textContent = [chart.title ?? chart.label, periodLabel(chart, period)].filter(Boolean).join(' — ');
  const pending = entries.filter(([, idx]) => data.tracks[idx][6]).length;
  ui.stats.textContent = `${current.links.length} of ${entries.length} on Spotify`
    + (pending ? ` · ${pending} not looked up yet` : '');
  // A collection has no source page of its own; it says what it is instead.
  ui.source.href = url ?? '';
  ui.sourceWrap.hidden = !url;
  ui.about.textContent = chart.about ?? '';
  ui.about.hidden = !chart.about;
  ui.copy.disabled = current.links.length === 0;
  ui.copy.textContent = `Copy ${current.links.length} Spotify link${current.links.length === 1 ? '' : 's'}`;
  ui.playlist.disabled = current.ids.length === 0;
  updateActions();
  ui.head.hidden = false;
  ui.status.textContent = '';
  document.title = `${ui.title.textContent} · SpotyList`;
}

function card(chart, period, entries, { periodText } = {}) {
  const href = `#${chart.id}/${period}`;
  const el = document.createElement('article');
  el.className = 'card';
  const head = document.createElement('a');
  head.className = 'card-head';
  head.href = href;
  const art = document.createElement('div');
  art.className = 'card-art';
  art.innerHTML = artSvg(artKind(chart.id));
  const group = document.createElement('span');
  group.className = 'card-group';
  group.textContent = COUNTRIES[chart.country] ?? chart.country;
  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = chart.label;
  const when = document.createElement('span');
  when.className = 'card-period';
  when.textContent = periodText ?? periodLabel(chart, period);
  head.append(art, group, title, when);
  const list = document.createElement('ol');
  list.className = 'tracks mini';
  list.style.setProperty('--pos-digits', 1);
  list.append(...(entries ?? []).map(([pos, track]) => trackItem(pos, track, null)));
  const more = document.createElement('a');
  more.className = 'card-more';
  more.href = href;
  more.textContent = 'Full list →';
  el.append(head, list, more);
  return el;
}

const historyYears = () => [...new Set(Object.values(homeData?.history ?? {}).flatMap((years) => Object.keys(years)))].map(Number).sort();

function renderHistory() {
  const years = historyYears();
  if (!years.length) {
    ui.historyTitle.parentElement.hidden = true;
    return;
  }
  historyYear ??= years[Math.floor(Math.random() * years.length)];
  ui.historyTitle.textContent = `This week in ${historyYear}`;
  ui.historySub.textContent = 'The charts of this same week, back then.';
  const cards = [];
  for (const chart of catalogue) {
    const entry = homeData.history[chart.id]?.[historyYear];
    if (!entry) continue;
    const periodText = periodLabel(chart, entry.period);
    cards.push(card(chart, entry.period, entry.entries, { periodText }));
  }
  ui.homeHistory.replaceChildren(...cards);
}

function nextHistoryYear({ turned = false } = {}) {
  const years = historyYears().filter((y) => y !== historyYear);
  if (!years.length) return;
  historyYear = years[Math.floor(Math.random() * years.length)];
  renderHistory();
  ui.homeHistory.classList.toggle('turned', turned);
  scheduleHistory();
}

// "This week in <year>" turns to another year every HISTORY_TURN_MS on the home page, unless
// paused, while the pointer or focus is on those cards (someone is reading or clicking), or
// while the section is scrolled out of view.
const HISTORY_TURN_MS = 10_000;
let historyTimer = null;
let historyPaused = false;
let historyHeld = false;
let historyOutOfView = false;

function scheduleHistory() {
  clearTimeout(historyTimer);
  historyTimer = null;
  if (historyPaused || historyHeld || historyOutOfView || ui.home.hidden || document.hidden || historyYears().length < 2) return;
  historyTimer = setTimeout(() => nextHistoryYear({ turned: true }), HISTORY_TURN_MS);
}

function holdHistory(held) {
  historyHeld = held;
  scheduleHistory();
}

function pauseHistory(paused) {
  historyPaused = paused;
  ui.historyPause.setAttribute('aria-pressed', String(paused));
  ui.historyPause.setAttribute('aria-label', paused ? 'Turn the years again' : 'Pause the years');
  ui.historyPause.title = paused ? 'Play' : 'Pause';
  ui.historyPause.querySelector('.icon-pause').toggleAttribute('hidden', paused);
  ui.historyPause.querySelector('.icon-play').toggleAttribute('hidden', !paused);
  scheduleHistory();
}

// "Did you know?": the facts about this week's charts (home.json, scraper/lib/facts.mjs) first,
// then the pool (data/facts.json, scraper/lib/trivia.mjs, loaded after) in a fresh order per
// visit. Facts this browser has not shown before come first; ↻ shows the next one.
let facts = null;
let factIndex = 0;
let factPool = null; // the pool's fetch, once
const SEEN_KEY = 'spotylist-facts-seen';
let seenFacts = null;
/** A short id for a fact (FNV-1a of its text), to remember it as seen in little space. */
function factId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}
function isSeen(fact) {
  if (!seenFacts) {
    try { seenFacts = new Set(JSON.parse(prefs.get(SEEN_KEY)) ?? []); } catch { seenFacts = new Set(); }
  }
  return seenFacts.has(factId(fact.text));
}
function markSeen(fact) {
  if (isSeen(fact)) return;
  seenFacts.add(factId(fact.text));
  prefs.set(SEEN_KEY, JSON.stringify([...seenFacts].slice(-2000)));
}
function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const unseenFirst = (list) => [...list.filter((f) => !isSeen(f)), ...list.filter(isSeen)];
function loadFactPool() {
  factPool ??= fetch('data/facts.json')
    .then((res) => (res.ok ? res.json() : { facts: [] }))
    .then((data) => {
      const known = new Set(facts.map((f) => f.text));
      facts.push(...unseenFirst(shuffled((data.facts ?? []).filter((f) => !known.has(f.text)))));
    })
    .catch(() => {}); // offline and never loaded: this week's facts only
  return factPool;
}
async function startFacts() {
  facts = unseenFirst(homeData?.facts ?? []);
  const pool = loadFactPool();
  // Seen all of this week's already: start with one from the pool.
  if (!facts.length || isSeen(facts[0])) {
    await pool;
    facts = unseenFirst(facts);
  }
  renderFact();
  pool.then(() => (ui.factNext.hidden = facts.length < 2));
}

// "Show me" on a fact about certain songs: the list it opens scrolls to them and marks them.
// Set only by that click, used once, so other ways to the same week start at the top.
let spotlight = null; // { hash, positions }

/** After a list is drawn: scroll to and mark the songs of the fact just followed. */
function applySpotlight() {
  const wanted = spotlight;
  spotlight = null;
  if (!wanted || decodeURIComponent(location.hash) !== decodeURIComponent(wanted.hash)) return false;
  const rows = [...ui.tracks.querySelectorAll('li')].filter((li) => wanted.positions.includes(Number(li.dataset.pos)));
  if (!rows.length) return false;
  for (const li of rows) li.classList.add('spot');
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  rows[0].scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  return true;
}

function renderFact() {
  ui.fact.hidden = !facts?.length;
  if (!facts?.length) return;
  const fact = facts[factIndex % facts.length];
  markSeen(fact);
  ui.factLink.onclick = () => (spotlight = fact.positions?.length ? { hash: fact.href, positions: fact.positions } : null);
  ui.factText.textContent = fact.text;
  ui.factLink.hidden = !fact.href;
  if (fact.href) ui.factLink.href = fact.href;
  ui.factNext.hidden = facts.length < 2;
}

function renderHome() {
  if (facts) renderFact();
  else startFacts();
  const cards = [];
  for (const { chart: id, period, entries } of homeData?.thisWeek ?? []) {
    const chart = catalogue.find((c) => c.id === id);
    if (chart) cards.push(card(chart, period, entries));
  }
  ui.homeWeek.replaceChildren(...cards);
  renderHistory();
  scheduleHistory();
}

async function showHome() {
  current = { chart: null, period: null, links: [], ids: [], total: 0 };
  ui.chart.value = '';
  ui.yearField.hidden = true;
  ui.periodField.hidden = true;
  ui.stepper.hidden = true;
  ui.head.hidden = true;
  ui.tabs.hidden = true;
  ui.career.hidden = true;
  ui.copyHint.hidden = true;
  ui.head.after(ui.playlistHint);
  ui.playlistHint.hidden = true;
  ui.tracks.hidden = true;
  ui.status.textContent = '';
  ui.home.hidden = false;
  document.title = 'SpotyList · Chart archives, one click from Spotify';
  setArt(artKind(null), { force: true });
  if (!homeData) {
    try {
      const res = await fetch('data/home.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      homeData = await res.json();
    } catch (err) {
      ui.status.textContent = `Could not load this week's charts (${err.message}).`;
      return;
    }
  }
  if (!ui.home.hidden) renderHome();
}

// --- Artist search and pages (scraper/lib/artists.mjs, written by build.mjs) ---
// data/artists.json: [[slug, name, songs, photo?]], most songs first, loaded when the search is used.
// data/artists/<shard>.json: { slug: { n: name, s: [[track row, { nl: [peak, weeks, peak week, first week] }]] } },
// shard the last character of the slug's FNV-1a hash in base 36 (as history.mjs songId, factId here).
const ARTIST_CHARTS = [['nl', 'nl-top40', 'Dutch Top 40'], ['uk', 'uk-singles', 'UK Top 100'], ['us', 'us-hot100', 'US Hot 100']];
let artistList = null; // the fetch of the index, once
const artistShards = new Map();
let artistMatches = [];
let artistActive = -1;
/** For matching: no accents, case or punctuation; "AC/DC" -> "ac dc". */
const plainText = (text) => String(text).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function loadArtists() {
  artistList ??= fetch('data/artists.json')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(({ artists }) => artists.map(([slug, name, songs, photo]) => {
      const words = plainText(name);
      return { slug, name, songs, photo, words, joined: words.replaceAll(' ', '') };
    }))
    .catch((err) => {
      artistList = null; // try again next time
      throw err;
    });
  return artistList;
}

/** The best matches: the whole name, its start, a word's start, anywhere; more songs first. */
function findArtists(list, query, max = 8) {
  const q = plainText(query);
  const joined = q.replaceAll(' ', '');
  if (joined.length < 2) return [];
  const rank = (a) => {
    if (a.words === q || a.joined === joined) return 0;
    if (a.words.startsWith(q) || a.joined.startsWith(joined)) return 1;
    if (` ${a.words}`.includes(` ${q}`)) return 2;
    return a.joined.includes(joined) ? 3 : -1;
  };
  const hits = [];
  for (const a of list) {
    const r = rank(a);
    if (r >= 0) hits.push([r, a]);
  }
  return hits.sort((x, y) => x[0] - y[0] || y[1].songs - x[1].songs).slice(0, max).map(([, a]) => a);
}

function drawArtistResults(message) {
  const open = !!message || plainText(ui.artistQ.value).replaceAll(' ', '').length >= 2;
  ui.artistResults.hidden = !open;
  ui.artistQ.setAttribute('aria-expanded', String(open));
  ui.artistQ.setAttribute('aria-activedescendant', artistActive >= 0 ? `artist-option-${artistActive}` : '');
  if (!open) return;
  const none = (text) => Object.assign(document.createElement('li'), { className: 'none', textContent: text });
  if (message || !artistMatches.length) {
    ui.artistResults.replaceChildren(none(message ?? 'No artist found'));
    return;
  }
  ui.artistResults.replaceChildren(...artistMatches.map((a, i) => {
    const li = document.createElement('li');
    li.id = `artist-option-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === artistActive));
    const count = Object.assign(document.createElement('span'), { className: 'count', textContent: `${a.songs} song${a.songs === 1 ? '' : 's'}` });
    const photo = a.photo ? Object.assign(document.createElement('img'), { className: 'avatar', src: `https://i.scdn.co/image/${a.photo}`, alt: '', loading: 'lazy' }) : Object.assign(document.createElement('span'), { className: 'avatar' });
    const name = Object.assign(document.createElement('span'), { className: 'name' });
    name.append(photo, a.name);
    li.append(name, count);
    // pointerdown: before the field loses focus and closes the list.
    li.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      openArtist(a);
    });
    return li;
  }));
}

async function onArtistInput() {
  const query = ui.artistQ.value;
  let list;
  try {
    list = await loadArtists();
  } catch (err) {
    drawArtistResults(`Could not load the artists (${err.message}).`);
    return;
  }
  if (query !== ui.artistQ.value) return; // typed on meanwhile
  artistMatches = findArtists(list, query);
  artistActive = artistMatches.length ? 0 : -1;
  drawArtistResults();
}

function openArtist(artist) {
  ui.artistQ.value = '';
  artistMatches = [];
  artistActive = -1;
  drawArtistResults();
  ui.artistQ.blur();
  location.hash = `#artist/${artist.slug}`;
}

function onArtistKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!artistMatches.length) return;
    e.preventDefault();
    artistActive = (artistActive + (e.key === 'ArrowDown' ? 1 : -1) + artistMatches.length) % artistMatches.length;
    drawArtistResults();
    ui.artistResults.children[artistActive]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && artistMatches[artistActive]) {
    e.preventDefault();
    openArtist(artistMatches[artistActive]);
  } else if (e.key === 'Escape') {
    ui.artistQ.value = '';
    artistMatches = [];
    drawArtistResults();
  }
}

function loadArtistShard(slug) {
  const shard = factId(slug).at(-1);
  if (!artistShards.has(shard)) {
    artistShards.set(shard, fetch(`data/artists/${shard}.json`).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }).catch((err) => {
      artistShards.delete(shard);
      throw err;
    }));
  }
  return artistShards.get(shard);
}

/** A peak chip under a song on an artist's page: flag and position, a link to that chart week. */
function peakChip(code, [peak, weeks, peakWeek]) {
  const [, chartId, name] = ARTIST_CHARTS.find(([c]) => c === code);
  const chart = catalogue.find((c) => c.id === chartId);
  const href = `#${chartId}/${peakWeek}`;
  const a = Object.assign(document.createElement('a'), { className: 'peak', href });
  a.title = `Peak #${peak} in the ${name}, ${weeks} week${weeks === 1 ? '' : 's'} in the chart. Open ${chart ? periodLabel(chart, peakWeek) : peakWeek}`;
  a.innerHTML = FLAGS[code][1];
  a.append(`#${peak}`);
  a.addEventListener('click', () => (spotlight = { hash: href, positions: [peak] }));
  return a;
}

/**
 * An artist's page: who they are in the charts at a glance, their biggest hits (highest position
 * first, then most weeks) and all their songs by the year they first charted. `code`: only the
 * songs of one chart (nl, uk, us), or all. A song plays from its row; its peak chips open the chart
 * week of each peak, the song marked there. Copy and the + take all its songs.
 */
async function showArtist(slug, code) {
  ui.home.hidden = true;
  scheduleHistory(); // stops turning the years
  ui.tracks.hidden = false;
  setArt(artKind(null));
  ui.chart.value = '';
  ui.yearField.hidden = true;
  ui.periodField.hidden = true;
  ui.stepper.hidden = true;
  ui.copyHint.hidden = true;
  ui.head.after(ui.playlistHint);
  ui.playlistHint.hidden = true;
  ui.status.textContent = 'Loading…';
  const pending = { chart: null, period: null, links: [], ids: [], total: 0 };
  current = pending;
  let artist;
  let data;
  try {
    artist = (await loadArtists()).find((a) => a.slug === slug);
    data = artist && (await loadArtistShard(slug))[slug];
  } catch (err) {
    if (current !== pending) return;
    ui.status.textContent = `Could not load this artist (${err.message}).`;
    return;
  }
  if (current !== pending) return; // a newer page was opened meanwhile
  if (!data) {
    ui.head.hidden = true;
    ui.career.hidden = true;
    ui.tracks.replaceChildren();
    ui.status.textContent = 'This artist is not in the charts here.';
    return;
  }
  const codes = ARTIST_CHARTS.map(([c]) => c).filter((c) => data.s.some(([, stats]) => stats[c]));
  const only = codes.includes(code) ? code : null;
  const shown = only ? [only] : codes;
  // Per song, in the charts shown: its best peak, weeks in all, and the week it first charted.
  const songs = data.s.filter(([, stats]) => shown.some((c) => stats[c])).map(([row, stats]) => {
    const here = shown.filter((c) => stats[c]);
    return {
      row, stats, here,
      peak: Math.min(...here.map((c) => stats[c][0])),
      weeks: here.reduce((n, c) => n + stats[c][1], 0),
      first: here.map((c) => stats[c][3]).sort()[0],
    };
  });
  songs.sort((a, b) => a.first.localeCompare(b.first));
  const credit = (row) => row[5] ?? row[0];

  // A song: its Spotify row (rank, cover, title, who else is on it), under it the year (in the
  // biggest hits) and its peak chips, outside the row's link so each opens its chart week.
  const row = (song, rank, year) => {
    const li = trackItem(rank ?? '', song.row, null);
    li.classList.add('artist-song');
    if (rank == null) li.classList.add('no-pos');
    const artistLine = li.querySelector('.artist');
    artistLine.textContent = others(song);
    artistLine.hidden = !artistLine.textContent;
    const peaks = Object.assign(document.createElement('span'), { className: 'peaks' });
    if (year) peaks.append(Object.assign(document.createElement('span'), { className: 'year', textContent: year }));
    peaks.append(...ARTIST_CHARTS.map(([c]) => c).filter((c) => song.stats[c]).map((c) => peakChip(c, song.stats[c])));
    li.querySelector('a.track').after(peaks);
    return li;
  };
  // A credit with more than the artist ("Calvin Harris & Dua Lipa") says who else is on it.
  const others = (song) => (plainText(credit(song.row)) === artist.words ? '' : credit(song.row));

  // A section heading with its own + (logged in): "Biggest hits" saves those, "All songs" all.
  const sectionHead = (label, variant) => {
    const li = Object.assign(document.createElement('li'), { className: 'year-head section-head' });
    const button = ui.playlist.cloneNode(true);
    button.removeAttribute('id');
    button.hidden = false;
    button.classList.add('save-section');
    button.dataset.variant = variant;
    button.addEventListener('click', () => saveArtistPlaylist(variant, li));
    li.append(Object.assign(document.createElement('span'), { textContent: label }), button);
    return li;
  };
  const items = [];
  const top = [...songs].sort((a, b) => a.peak - b.peak || b.weeks - a.weeks || a.first.localeCompare(b.first)).slice(0, 10);
  const withTop = songs.length > 12;
  if (withTop) {
    items.push(sectionHead('Biggest hits', 'top'));
    top.forEach((song, i) => items.push(row(song, i + 1, song.first.slice(0, 4))));
  }
  items.push(sectionHead('All songs', 'all'));
  const byYear = Map.groupBy(songs, (song) => song.first.slice(0, 4));
  for (const [year, list] of byYear) {
    items.push(Object.assign(document.createElement('li'), { className: 'year-head', id: `artist-year-${year}`, textContent: year }));
    for (const song of list) items.push(row(song, null));
  }
  ui.tracks.style.setProperty('--pos-digits', withTop ? String(top.length).length : 1);
  ui.tracks.replaceChildren(...items);
  // The chips start where the title does: measured, as the rank column follows the font.
  for (const li of [ui.tracks.querySelector('li.artist-song:not(.no-pos)'), ui.tracks.querySelector('li.artist-song.no-pos')]) {
    if (!li) continue;
    const x = li.querySelector('.names').getBoundingClientRect().left - li.getBoundingClientRect().left;
    ui.tracks.style.setProperty(li.classList.contains('no-pos') ? '--peaks-plain' : '--peaks-ranked', `${Math.round(x)}px`);
  }

  // Hits per year: the shape of the career; a tap goes to that year in the list.
  const counts = [...byYear].map(([year, list]) => [Number(year), list.length]);
  drawCareer(counts);

  // Spotify's photo of the artist (round), else the cover of their biggest hit (square) until
  // match.mjs has found one.
  const cover = data.i ?? top.find((song) => song.row[3])?.row[3];
  ui.photo.hidden = !cover;
  ui.head.classList.toggle('with-photo', !!cover);
  if (cover) {
    ui.photo.src = `https://i.scdn.co/image/${cover}`;
    ui.photo.classList.toggle('is-cover', !data.i);
    ui.photo.title = data.i ? `${artist.name} (photo: Spotify)` : `${artist.name}: cover of “${top.find((song) => song.row[3]).row[4] ?? ''}”`;
  }

  // Two playlists: the biggest hits (by highest position), and every song in the order they
  // charted. Copy takes every song.
  const where = only ? ` · ${shortName({ id: ARTIST_CHARTS.find(([c]) => c === only)[1] })}` : '';
  const inCharts = only ? ` in the ${ARTIST_CHARTS.find(([c]) => c === only)[2]}` : ' in the Dutch, UK and US charts';
  const variant = (list, name, about, period) => {
    const ids = list.map((song) => song.row[2]).filter(Boolean);
    return { ids, links: ids.map((id) => `https://open.spotify.com/track/${id}`), total: list.length, period, name, about };
  };
  const variants = {
    all: variant(songs, `${artist.name} · Chart hits${where}`, `Every chart hit of ${artist.name}${inCharts}, in the order they charted.`, only ?? 'all'),
    top: variant(top, `${artist.name} · Biggest hits${where}`, `The ${top.length} biggest chart hits of ${artist.name}${inCharts}, highest position first.`, `${only ?? 'all'}-top`),
  };
  const chart = { id: `artist-${slug}`, kind: 'artist', title: artist.name, label: artist.name, variants };
  current = { chart, ...useVariant(chart, 'all') };
  ui.title.textContent = artist.name;
  const years = [...byYear.keys()];
  const ones = songs.filter((song) => song.peak === 1).length;
  ui.stats.textContent = [years[0] === years.at(-1) ? years[0] : `${years[0]}–${years.at(-1)}`,
    `${songs.length} song${songs.length === 1 ? '' : 's'} in the charts`, ones ? `${ones} × #1` : null].filter(Boolean).join(' · ');
  ui.sourceWrap.hidden = true;
  ui.about.textContent = 'Tap a song to play it; tap a flag to see that chart week.';
  ui.about.hidden = false;
  const filter = (c, label, count) => {
    const a = Object.assign(document.createElement('a'), { href: `#artist/${slug}${c ? `/${c}` : ''}` });
    if ((c ?? null) === only) a.setAttribute('aria-current', 'page');
    if (c) a.innerHTML = FLAGS[c][1];
    a.append(label, Object.assign(document.createElement('span'), { className: 'count', textContent: count }));
    a.title = c ? `Only the songs in the ${ARTIST_CHARTS.find(([x]) => x === c)[2]}` : 'All songs';
    return a;
  };
  ui.tabs.replaceChildren(filter(null, 'All', data.s.length), ...(codes.length > 1 ? codes.map((c) => filter(c, '', data.s.filter(([, stats]) => stats[c]).length)) : []));
  ui.tabs.hidden = codes.length < 2;
  ui.copy.disabled = current.links.length === 0;
  ui.copy.textContent = `Copy ${current.links.length} Spotify link${current.links.length === 1 ? '' : 's'}`;
  updateActions();
  ui.head.hidden = false;
  ui.status.textContent = '';
  document.title = `${artist.name} · SpotyList`;
}

/** The artist page's list `name` ('all' or 'top') as `current`'s songs, for Copy and the +. */
function useVariant(chart, name) {
  const { ids, links, total, period, name: playlistName, about } = chart.variants[name];
  chart.playlistName = playlistName;
  chart.about = about;
  return { period, ids, links, total };
}

/** A section's + on the artist page: save that list, with the messages under its heading. */
async function saveArtistPlaylist(name, head) {
  const { chart } = current;
  if (chart?.kind !== 'artist') return;
  Object.assign(current, useVariant(chart, name));
  let hint = head.nextElementSibling;
  if (!hint?.classList.contains('save-hint')) {
    hint = Object.assign(document.createElement('li'), { className: 'save-hint' });
    head.after(hint);
  }
  hint.append(ui.playlistHint);
  const button = head.querySelector('button');
  button.disabled = true;
  try {
    await saveAsPlaylist();
  } finally {
    button.disabled = current.ids.length === 0;
    if (current.chart === chart) Object.assign(current, useVariant(chart, 'all')); // Copy: every song
    updateActions();
  }
}

/** The career strip: songs per year as bars, each year a tap target to its place in the list. */
function drawCareer(counts) {
  const SVG = 'http://www.w3.org/2000/svg';
  const first = counts[0][0];
  const last = counts.at(-1)[0];
  const span = last - first + 1;
  const per = new Map(counts);
  const max = Math.max(...counts.map(([, n]) => n));
  const W = Math.max(span * 10, 200);
  const H = 44;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'career-bars');
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Songs per year, ${first} to ${last}; most in ${best[0]} (${best[1]})`);
  const step = W / span;
  for (let y = first; y <= last; y++) {
    const n = per.get(y) ?? 0;
    const x = (y - first) * step;
    const h = n ? Math.max(3, (n / max) * (H - 2)) : 0;
    const g = document.createElementNS(SVG, 'g');
    if (n) {
      const bar = document.createElementNS(SVG, 'rect');
      Object.entries({ x: x + step * 0.15, y: H - h, width: step * 0.7, height: h, rx: Math.min(2, step * 0.2) }).forEach(([k, v]) => bar.setAttribute(k, v));
      g.append(bar);
      const hit = document.createElementNS(SVG, 'rect');
      Object.entries({ x, y: 0, width: step, height: H, class: 'hit' }).forEach(([k, v]) => hit.setAttribute(k, v));
      const tip = document.createElementNS(SVG, 'title');
      tip.textContent = `${y}: ${n} song${n === 1 ? '' : 's'}`;
      hit.append(tip);
      hit.addEventListener('click', () => document.getElementById(`artist-year-${y}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
      g.append(hit);
    }
    svg.append(g);
  }
  const labels = Object.assign(document.createElement('p'), { className: 'career-labels' });
  labels.append(Object.assign(document.createElement('span'), { textContent: first }),
    Object.assign(document.createElement('span'), { textContent: `most in ${best[0]}: ${best[1]}` }),
    Object.assign(document.createElement('span'), { textContent: last }));
  ui.career.replaceChildren(svg, labels);
  ui.career.hidden = span < 3;
}

/** Show what the address asks for: a chart, or home. */
function route() {
  const artist = decodeURIComponent(location.hash).match(/^#artist\/([^/]+)(?:\/(\w+))?/);
  if (artist) return showArtist(artist[1], artist[2]);
  const { chartId, period } = fromHash();
  if (catalogue.some((c) => c.id === chartId)) return show(chartId, period, { updateHash: !period });
  const members = groupMembers(chartId); // e.g. #nl-decenniumlijst: its most recent chart
  if (members.length) return show(members.at(-1).id, null);
  return showHome();
}

async function copyLinks() {
  const text = current.links.join('\n');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable (e.g. insecure context): fall back to a selected textarea.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  ui.copyHint.hidden = false;
}

/** Logged in: the + (save as playlist) instead of copying links, on every device. */
function updateActions() {
  const loggedIn = Boolean(loggedInAs());
  // Pasting a list of track links into a playlist only works in the desktop app.
  ui.copy.hidden = isMobile || loggedIn;
  // An artist page has a + per section instead (Biggest hits, All songs).
  const artist = current.chart?.kind === 'artist';
  ui.playlist.hidden = !loggedIn || artist;
  for (const button of ui.tracks.querySelectorAll('.save-section')) {
    const { period, ids } = current.chart.variants[button.dataset.variant];
    const done = loggedIn && savedPlaylists()[`${loggedInAs()}|${current.chart.id}/${period}`];
    button.hidden = !loggedIn;
    button.disabled = ids.length === 0;
    for (const icon of ['add', 'update', 'saved']) button.querySelector(`.icon-${icon}`).toggleAttribute('hidden', icon !== (done ? 'saved' : 'add'));
    const label = done ? 'Saved as a playlist in Spotify (click for the link)' : `Save as a playlist in Spotify: “${current.chart.variants[button.dataset.variant].name}”`;
    button.title = label;
    button.setAttribute('aria-label', label);
  }
  if (loggedIn) ui.copyHint.hidden = true;
  // + to save; a check when saved before (in this browser, by this account); for this week's
  // list, ↻ when the "This week" playlist still holds an older week.
  let state = 'add';
  if (loggedIn && isThisWeek()) {
    const rolling = thisWeekPlaylist();
    if (rolling) state = rolling.week === current.period ? 'saved' : 'update';
  } else if (loggedIn && savedPlaylist()) {
    state = 'saved';
  }
  // (SVG elements have no .hidden property: set the attribute.)
  for (const icon of ['add', 'update', 'saved']) ui.playlist.querySelector(`.icon-${icon}`).toggleAttribute('hidden', icon !== state);
  const label = {
    add: isThisWeek() ? 'Save as a “This week” playlist in Spotify' : 'Save as a playlist in Spotify',
    update: 'Update your “This week” playlist in Spotify to this week',
    saved: 'Saved as a playlist in Spotify (click for the link)',
  }[state];
  ui.playlist.title = label;
  ui.playlist.setAttribute('aria-label', label);
}

// The latest week of a weekly chart goes into one "This week" playlist per chart, which a
// later + updates (its songs replaced) instead of making a new playlist; older weeks are
// saved as playlists of their own. Only on a click: nothing updates by itself.
const isThisWeek = () => current.chart?.kind === 'weekly' && current.period === allPeriods(current.chart).at(-1);

// Playlist names in Spotify: a short chart name first, then the week, so the part that tells
// playlists apart is not cut off in Spotify's lists (about 35 characters on a phone). The
// full chart name and source are in the description. Only the playlist names; not the site.
const SHORT_NAMES = {
  'beatport-trance-main-floor': 'BP Trance Main Floor',
  'beatport-trance-raw-deep-hypnotic': 'BP Trance Raw/Deep',
  'beatport-techno-peak-time-driving': 'BP Techno Peak Time',
  'beatport-techno-raw-deep-hypnotic': 'BP Techno Raw/Deep',
  'beatport-melodic-house-techno': 'BP Melodic H&T',
  'beatport-mainstage': 'BP Mainstage',
  'beatport-deep-house': 'BP Deep House',
  'nl-top40': 'NL Top 40',
  'us-hot100': 'US Hot 100',
  'uk-singles': 'UK Top 100',
};
function shortName(chart) {
  const decade = chart.id.match(/^nl-decenniumlijst-(\d\d)-s$/);
  if (decade) return `NL ${decade[1]}s Decade list`;
  return SHORT_NAMES[chart.id] ?? chart.title ?? chart.label;
}
/** E.g. "US Hot 100 · Week 38, 2026", "NL Top 40 · Year 1985", "NL 80s Decade list". */
function playlistName(chart, period) {
  if (chart.kind === 'artist') return chart.playlistName; // "Madonna · Top 10"
  if (chart.kind === 'yearly') return `${shortName(chart)} · Year ${period}`;
  const when = periodLabel(chart, period);
  return when ? `${shortName(chart)} · ${when}` : shortName(chart);
}
const thisWeekName = (chart) => `${shortName(chart)} · This week`;
// Names of the first version, still recognised when looking for a saved playlist.
const oldThisWeekName = (chart) => `${chart.title ?? chart.label} — This week`;
const thisWeekKey = () => `${loggedInAs()}|${current.chart?.id}/this-week`;
const thisWeekPlaylist = () => savedPlaylists()[thisWeekKey()] ?? null;

// Lists saved as a playlist, remembered in this browser so a second click does not make a
// copy: { "<account>|<chart>/<period>": { name, url, uri, date } }. Not known to other devices.
const SAVED_KEY = 'spotylist-saved';
const savedKey = () => `${loggedInAs()}|${current.chart?.id}/${current.period}`;
function savedPlaylists() {
  try { return JSON.parse(prefs.get(SAVED_KEY)) ?? {}; } catch { return {}; }
}
const savedPlaylist = () => savedPlaylists()[savedKey()] ?? null;
function rememberPlaylist(key, playlist) {
  const all = savedPlaylists();
  if (playlist === undefined) delete all[key];
  else all[key] = playlist;
  prefs.set(SAVED_KEY, JSON.stringify(all));
}

/** The words "Spotify Playlist", linking to the playlist in Spotify (app or web player, like songs). */
function playlistLink(playlist) {
  const link = document.createElement('a');
  link.href = openMode === 'app' && playlist.uri ? playlist.uri : playlist.url;
  if (openMode === 'web') link.target = 'spotylist-player';
  link.title = 'Open in Spotify';
  link.textContent = 'Spotify Playlist';
  return link;
}

const tracks = (n) => `${n} track${n === 1 ? '' : 's'}`;



/**
 * The playlist's description credits the chart's publisher with a link to the original list:
 * SpotyList only matched its songs to Spotify. Spotify allows 300 characters; a URL that does
 * not fit is left out, the publisher's name stays.
 */
function playlistDescription(name, tag) {
  // Lists without a source page (collections, artists): an empty href reads as this page.
  const url = ui.sourceWrap.hidden ? '' : ui.source.href;
  let publisher = '';
  try { publisher = new URL(url).hostname.replace(/^www\./, ''); } catch { /* no source link */ }
  const room = 300 - tag.length - 1; // the tag always fits, at the end
  const songs = `Songs matched to Spotify by SpotyList (spotylist.nl): ${current.ids.length} of ${current.total}.`;
  const withUrl = `Chart: ${name}, as published by ${publisher} (${url}). ${songs}`;
  let text;
  const about = current.chart?.about;
  if (!publisher && about) text = `${name}: ${about} Made by SpotyList (spotylist.nl) from the weekly charts. ${songs}`.slice(0, room);
  else if (publisher && withUrl.length <= room) text = withUrl;
  else text = (publisher ? `Chart: ${name}, as published by ${publisher}. ${songs}` : songs).slice(0, room);
  return `${text} ${tag}`;
}

/**
 * A short technical reference to the chart: 4 characters of a hash (FNV-1a) of its id, e.g.
 * "htwy" for us-hot100. Never change this: saved playlists are found by it. (Unique for the
 * current charts; a new chart that happens to clash could only match the other chart's
 * playlist for the same period.)
 */
function chartRef(chartId) {
  let hash = 0x811c9dc5;
  for (const ch of chartId) hash = Math.imul(hash ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return hash.toString(36).padStart(7, '0').slice(-4);
}

/**
 * Markers in the playlist's description, so the list's playlist can be found again in the
 * account (on another device, or after clearing this browser), also when it was renamed.
 * The first, short one, e.g. "[spotylist:htwy/1992-40]", is written; the long form of the
 * first version ("[spotylist:us-hot100/1992-40]") is still recognised.
 */
const playlistTags = (chart, period) => [`[spotylist:${chartRef(chart.id)}/${period}]`, `[spotylist:${chart.id}/${period}]`];

/**
 * A link-style button; by default it saves the list as a playlist of its own without looking
 * for a copy (also for this week's list, whose + otherwise uses the "This week" playlist).
 */
function saveAnywayButton(text = 'Save anyway', action = () => saveAsPlaylist({ again: true, separate: true })) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link-button';
  button.textContent = text;
  button.addEventListener('click', action);
  return button;
}

/** "Save as new" (a copy icon and two words, short enough for a phone): a playlist of its own. */
function saveAsNewButton(action) {
  const button = saveAnywayButton('Save as new', action);
  button.title = 'Save this list as a new playlist of its own';
  button.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>');
  return button;
}

/** The list's playlist exists already: a link to it, and the option to make a new copy. */
function showAlreadySaved(playlist) {
  ui.playlistHint.replaceChildren(playlistLink(playlist), ' already saved · ', saveAsNewButton());
  ui.playlistHint.hidden = false;
}

/**
 * A playlist remembered in this browser may have been deleted in Spotify since. Checked on a
 * click (never while browsing): gone → forgotten here, with a message and a "Save again"
 * button; true when it is still there (or cannot be checked).
 */
async function stillSaved(key, record, again) {
  const id = record.id ?? record.uri?.split(':').pop();
  if (!id) return true;
  ui.playlistHint.textContent = 'Checking your Spotify playlists…';
  let exists;
  try {
    exists = await playlistExists(id);
  } catch (err) {
    if (['login', 'forbidden', 'busy'].includes(err.code)) throw err;
    return true; // could not check: show what is remembered
  }
  if (exists !== false) return true;
  rememberPlaylist(key, undefined);
  updateActions();
  ui.playlistHint.replaceChildren(`Your earlier playlist “${record.name}” is no longer in your Spotify. `, saveAnywayButton('Save again', again));
  return false;
}

/** The "This week" playlist: find (or make) it, and put this week's songs in it. */
async function saveThisWeek({ skipCheck = false } = {}) {
  const { chart, period } = current;
  const key = thisWeekKey();
  const weekTitle = ui.title.textContent; // e.g. "US Billboard Hot 100 — Week 39, 2026"
  const name = thisWeekName(chart);
  const tags = [`[spotylist:${chartRef(chart.id)}/this-week]`];
  const description = playlistDescription(weekTitle, tags[0]);
  let playlist = thisWeekPlaylist();
  ui.playlistHint.hidden = false;
  ui.playlist.disabled = true;
  try {
    if (playlist?.week === period) {
      if (!(await stillSaved(key, playlist, () => saveThisWeek()))) return;
      if (current.chart !== chart || current.period !== period) return;
      ui.playlistHint.replaceChildren(playlistLink(playlist), ' is up to date.');
      return;
    }
    let checkNote = '';
    if (!playlist && !skipCheck && !canFindPlaylists()) {
      checkNote = ' · Log out and in once (☰) to also find playlists saved elsewhere.';
    } else if (!playlist && !skipCheck) {
      ui.playlistHint.textContent = 'Checking your Spotify playlists…';
      let result;
      try {
        result = await findPlaylist(tags, [name, oldThisWeekName(chart)]);
      } catch (err) {
        if (['login', 'forbidden', 'busy'].includes(err.code)) throw err;
        if (current.chart !== chart || current.period !== period) return;
        const anyway = saveAnywayButton('Save anyway', () => saveThisWeek({ skipCheck: true }));
        ui.playlistHint.replaceChildren(`Could not check your Spotify playlists for your “This week” playlist (${err.message.replace(/\.$/, '')}). `, anyway);
        return;
      }
      playlist = result.playlist;
    }
    let text;
    if (playlist?.id) {
      ui.playlistHint.textContent = 'Updating the playlist…';
      try {
        await replacePlaylist(playlist.id, name, description, current.ids);
        playlist = { ...playlist, name };
      } catch (err) {
        if (['login', 'forbidden', 'busy'].includes(err.code)) throw err;
        // E.g. deleted in Spotify: forget it, so the next + looks again or makes a new one.
        rememberPlaylist(key, undefined);
        if (current.chart !== chart || current.period !== period) return;
        updateActions();
        ui.playlistHint.textContent = `Could not update “${playlist.name}” (${err.message.replace(/\.$/, '')}). Press + to look for it again or make a new one.`;
        return;
      }
      text = ` updated with ${tracks(current.ids.length)}.`;
    } else {
      ui.playlistHint.textContent = 'Saving the playlist…';
      playlist = await createPlaylist(name, description, current.ids);
      text = ` saved with ${tracks(playlist.added)}.`;
    }
    const record = { id: playlist.id, name: playlist.name, url: playlist.url, uri: playlist.uri, week: period, date: new Date().toISOString().slice(0, 10) };
    rememberPlaylist(key, record);
    if (current.chart !== chart || current.period !== period) return;
    updateActions();
    ui.playlistHint.replaceChildren(playlistLink(record), text, checkNote);
  } catch (err) {
    ui.playlistHint.textContent = err instanceof SpotifyError ? err.message : `Could not save the playlist (${err.message}).`;
    if (err.code === 'login' || err.code === 'forbidden') {
      logout();
      renderAccount();
    }
  } finally {
    ui.playlist.disabled = current.ids.length === 0;
  }
}

async function saveAsPlaylist({ again = false, separate = false } = {}) {
  // This week's list goes into the "This week" playlist, unless saved as a playlist of its own.
  if (isThisWeek() && !separate) {
    saveThisWeek();
    return;
  }
  const { chart, period } = current;
  const title = ui.title.textContent; // the full name, for the description (and older playlists)
  const name = playlistName(chart, period);
  const key = savedKey();
  const before = savedPlaylist();
  ui.playlistHint.hidden = false;
  const tags = playlistTags(chart, period);
  ui.playlist.disabled = true;
  try {
    if (before && !again) {
      if (await stillSaved(key, before, () => saveAsPlaylist({ again: true, separate })) && current.chart === chart && current.period === period) {
        showAlreadySaved(before);
      }
      return;
    }
    // Not saved in this browser: maybe on another device, or before the browser was cleared.
    // Look in the account's playlists before making a new one. Nothing is saved silently when
    // that check cannot run: the message says why, and "Save anyway" skips it.
    let checkNote = '';
    if (!again && !canFindPlaylists()) {
      checkNote = ' · Log out and in once (☰) to also find playlists saved elsewhere.';
    } else if (!again) {
      ui.playlistHint.textContent = 'Checking your Spotify playlists…';
      let result;
      try {
        result = await findPlaylist(tags, [name, title]);
      } catch (err) {
        if (['login', 'forbidden', 'busy'].includes(err.code)) throw err;
        if (current.chart !== chart || current.period !== period) return;
        ui.playlistHint.replaceChildren(`Could not check your Spotify playlists for an earlier copy (${err.message.replace(/\.$/, '')}). `, saveAnywayButton());
        return;
      }
      const found = result.playlist;
      if (found) {
        const playlist = { ...found, date: null };
        rememberPlaylist(key, playlist);
        if (current.chart !== chart || current.period !== period) return;
        updateActions();
        showAlreadySaved(playlist);
        return;
      }
    }
    ui.playlistHint.textContent = 'Saving the playlist…';
    const saved = await createPlaylist(name, playlistDescription(title, tags[0]), current.ids);
    const playlist = { name: saved.name, url: saved.url, uri: saved.uri, date: new Date().toISOString().slice(0, 10) };
    rememberPlaylist(key, playlist); // also when the visitor moved on to another list meanwhile
    if (current.chart !== chart || current.period !== period) return;
    updateActions();
    ui.playlistHint.replaceChildren(playlistLink(playlist), ` saved with ${tracks(saved.added)}.`, checkNote);
  } catch (err) {
    ui.playlistHint.textContent = err instanceof SpotifyError ? err.message : `Could not save the playlist (${err.message}).`;
    if (err.code === 'login' || err.code === 'forbidden') {
      logout();
      renderAccount();
    }
  } finally {
    ui.playlist.disabled = current.ids.length === 0;
  }
}











function step(delta) {
  if (current.chart.group) {
    const members = groupMembers(current.chart.group.id);
    const next = members[members.indexOf(current.chart) + delta];
    if (next) show(next.id, null);
    return;
  }
  const all = allPeriods(current.chart);
  const next = all[all.indexOf(current.period) + delta];
  if (next) show(current.chart.id, next);
}

function fromHash() {
  const [chartId, period] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { chartId, period };
}

async function init() {
  // The ☰ menu (menu.js) works on its own; this page redraws what its settings change.
  const redraw = () => {
    if (current.chart) show(current.chart.id, current.period, { updateHash: false });
    else if (homeData && !ui.home.hidden) renderHome();
  };
  document.addEventListener('spotylist:openmode', () => {
    openMode = getOpenMode();
    redraw(); // the links use the new mode (the data is cached)
  });
  document.addEventListener('spotylist:fix', () => {
    fixMode = isFixMode();
    redraw();
  });
  document.addEventListener('spotylist:account', () => {
    if (!loggedInAs()) ui.playlistHint.hidden = true;
    updateActions();
  });
  ui.playlist.addEventListener('click', () => saveAsPlaylist());

  // Before routing: a return from Spotify's login page restores the address it left from.
  await menuReady;

  try {
    const res = await fetch('data/charts.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    catalogue = body.charts;
    showVersion(body.builtAt, res.headers.get('last-modified'));
  } catch {
    catalogue = [];
  }
  if (!catalogue.length) {
    ui.status.textContent = 'No chart data has been published yet.';
    return;
  }
  fillChartSelect();

  ui.chart.addEventListener('change', () => {
    if (!ui.chart.value) return;
    // A group opens its most recent chart (the 00's for the decade lists), like a chart its latest week.
    const members = groupMembers(ui.chart.value);
    show(members.length ? members.at(-1).id : ui.chart.value, null);
  });
  ui.historyNext.addEventListener('click', () => nextHistoryYear());
  ui.artistQ.addEventListener('input', onArtistInput);
  ui.artistQ.addEventListener('keydown', onArtistKey);
  ui.artistQ.addEventListener('focus', () => {
    loadArtists().catch(() => {}); // fetch the index while typing starts
    if (ui.artistQ.value) onArtistInput();
  });
  ui.artistQ.addEventListener('blur', () => {
    ui.artistResults.hidden = true;
    ui.artistQ.setAttribute('aria-expanded', 'false');
  });
  ui.factNext.addEventListener('click', () => {
    factIndex++;
    renderFact();
  });
  ui.historyPause.addEventListener('click', () => pauseHistory(!historyPaused));
  ui.homeHistory.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && holdHistory(true));
  ui.homeHistory.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && holdHistory(false));
  ui.homeHistory.addEventListener('focusin', () => holdHistory(true));
  ui.homeHistory.addEventListener('focusout', (e) => !ui.homeHistory.contains(e.relatedTarget) && holdHistory(false));
  document.addEventListener('visibilitychange', scheduleHistory);
  // Only while its title is on screen: a year with more or fewer cards changes the height, which
  // must not move "This week" while someone is reading it further down.
  new IntersectionObserver(([entry]) => {
    historyOutOfView = !entry.isIntersecting;
    scheduleHistory();
  }).observe(ui.historyTitle);
  ui.year.addEventListener('change', () => {
    // Mid-year: week 26, or the nearest week the year has (a year scraped in part, or this year).
    const periods = current.chart.files[ui.year.value];
    const distance = (p) => Math.abs(Number(p.slice(5)) - MID_YEAR_WEEK);
    show(current.chart.id, periods.reduce((best, p) => (distance(p) < distance(best) ? p : best)));
  });
  ui.period.addEventListener('change', () => {
    if (current.chart.group) show(ui.period.value, null); // the Decade menu picks a chart
    else show(current.chart.id, ui.period.value);
  });
  ui.prev.addEventListener('click', () => step(-1));
  ui.next.addEventListener('click', () => step(1));
  ui.copy.addEventListener('click', copyLinks);
  updateActions();
  // A card or the logo only changes the #hash, so the browser keeps (or on Back restores) the
  // scroll position of the page left behind; a new view starts at the top. Again once it is
  // drawn: a list from the cache appears at once and some browsers scroll after the event.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', async () => {
    window.scrollTo(0, 0);
    try {
      await route();
    } finally {
      if (!applySpotlight()) window.scrollTo(0, 0);
    }
  });
  addEventListener('visibilitychange', () => document.hidden && saveResume());
  addEventListener('pagehide', saveResume);
  if (installed && isIOS) document.addEventListener('click', openInSafari);
  resume();
}

// The installed app (home screen) restarts at its start address when iOS has dropped it in the
// background, losing the chart, week and scroll position. So the page in view is remembered on
// leaving, and a start within RESUME_WITHIN_MS returns to it. In a browser tab the address keeps
// its #chart/week, and only the scroll position comes back.
const RESUME_KEY = 'spotylist-resume';
const RESUME_WITHIN_MS = 3 * 3600_000;
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// Outside links (chart sources, GitHub) from the installed app open in iOS's in-app browser
// sheet, not in Safari itself. iOS 17+ opens x-safari-https:// addresses in Safari. Should
// that not happen (older iOS), the page is still shown and the link opens as before. Spotify
// links are left alone: they belong in the Spotify app.
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const SAFARI_FALLBACK_MS = 1500;

function openInSafari(event) {
  const link = event.target.closest?.('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  const url = new URL(link.href, location.href);
  if (!/^https?:$/.test(url.protocol) || url.origin === location.origin || /(^|\.)spotify\.com$/.test(url.hostname)) return;
  event.preventDefault();
  let left = false;
  const onHide = () => { left = left || document.hidden; };
  document.addEventListener('visibilitychange', onHide);
  location.href = `x-safari-${url.href}`;
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    // A plain navigation: in the installed app an outside address opens in the in-app sheet.
    if (!left && !document.hidden) location.assign(url.href);
  }, SAFARI_FALLBACK_MS);
}

function saveResume() {
  prefs.set(RESUME_KEY, JSON.stringify({ hash: location.hash || '#home', y: Math.round(scrollY), at: Date.now() }));
}

async function resume() {
  let saved = null;
  try {
    saved = JSON.parse(prefs.get(RESUME_KEY) ?? 'null');
  } catch { /* start fresh */ }
  const recent = saved && Date.now() - saved.at < RESUME_WITHIN_MS;
  if (recent && installed && !location.hash) history.replaceState(null, '', saved.hash);
  await route();
  if (recent && saved.y && location.hash === saved.hash) {
    // Twice: once drawn, and after the covers below have taken their space.
    scrollTo(0, saved.y);
    requestAnimationFrame(() => scrollTo(0, saved.y));
  }
}

init();

// Installed on the home screen, the app keeps working offline with the pages seen before.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
