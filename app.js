// SpotyList front end: static chart data (built by scraper/build.mjs) linked to Spotify.
// Track links and cover images come precomputed in the data. The only API calls are for the
// optional Spotify login, to save a list as a playlist (spotify.js).
// Pages: #home (this week's charts and a random year back), #<chart>/<period> (a list); the
// bare address opens the start page chosen in the options (home by default).
import { artKind, artSvg } from './art.js';
import { initSpotify, login, logout, finishLogin, loggedInAs, accountImage, completeProfile, findPlaylist, playlistExists, canFindPlaylists, createPlaylist, replacePlaylist, readPlaylist, playlistIdFrom, SpotifyError } from './spotify.js';

const COUNTRIES = { NL: 'Netherlands', GB: 'United Kingdom', US: 'United States', Beatport: 'Beatport Top 100' };
const $ = (id) => document.getElementById(id);

const ui = {
  chart: $('chart'), year: $('year'), period: $('period'),
  yearField: $('year-field'), periodField: $('period-field'), periodLabel: $('period-label'),
  prev: $('prev'), next: $('next'),
  head: $('list-head'), title: $('list-title'), stats: $('list-stats'), source: $('list-source'),
  copy: $('copy'), copyHint: $('copy-hint'), status: $('status'), tracks: $('tracks'),
  playlist: $('playlist'), playlistHint: $('playlist-hint'),
  accountOption: $('account-option'), accountName: $('account-name'), accountAvatar: $('account-avatar'), accountIcon: $('account-icon'), accountButton: $('account-button'), accountNote: $('account-note'),
  home: $('home'), homeWeek: $('home-week'), homeHistory: $('home-history'),
  historyTitle: $('history-title'), historySub: $('history-sub'), historyNext: $('history-next'), historyPause: $('history-pause'),
  backdrop: $('backdrop'), stepper: $('prev').parentElement,
  versionLine: $('version-line'), version: $('version'), reload: $('reload'), statusLink: $('status-link'),
  importOption: $('import-option'), importLink: $('import-link'), importRead: $('import-read'), importNote: $('import-note'),
  menu: $('menu'), options: $('options'), openOption: $('open-option'), fixOption: $('fix-option'), fixToggle: $('fix-toggle'),
};

// Per-browser preferences. Storage can be unavailable (private mode, blocked site data).
const prefs = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* not saved */ }
  },
};

// On phones https links already open the Spotify app (and fall back to the web player), so
// phones and tablets always use them and get no choice. On desktops only spotify: URIs reach
// the app: the default there, with the web player as an option.
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPadOS
let openMode = isMobile ? 'web' : (prefs.get('spotylist-open') ?? 'app');

// Fix mode, for the owner: a link next to each song opens a prefilled issue in the (private)
// data repository to correct its Spotify link; the "Issue commands" workflow applies it.
// Switched on with ?fix in the page URL, off with ?fix=0; remembered per browser.
/** The week opened when a year is picked in the Year menu. */
const MID_YEAR_WEEK = 26;
const REPO = 'mr-fixit-sj/git-repos-spotylist';
const fixParam = new URLSearchParams(location.search).get('fix');
if (fixParam !== null) {
  prefs.set('spotylist-fix', fixParam === '0' ? null : '1');
  history.replaceState(null, '', location.pathname + location.hash);
}
let fixMode = prefs.get('spotylist-fix') === '1';

// Start page for the bare address: home (default) or the chart viewed last.
let startPage = prefs.get('spotylist-start') === 'last' ? 'last' : 'home';

const THEMES = ['system', 'light', 'dark'];
let theme = prefs.get('spotylist-theme') ?? 'dark'; // dark unless chosen otherwise

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
  if (chart.kind === 'yearly') return period;
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
  ui.periodLabel.textContent = chart.kind === 'yearly' ? 'Year' : 'Week';

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

function trackItem(pos, track) {
  const [artist, title, spotifyId, imageId, spName, spArtists, pending] = track;
  const li = document.createElement('li');
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
  names.append(t, ar);

  const go = document.createElement('span');
  go.className = 'go';
  const arrow = openMode === 'web' ? ' ↗' : '';
  go.textContent = spotifyId ? `Open in Spotify${arrow}` : `Search Spotify${arrow}`;

  a.append(posEl, cover, names, go);
  li.append(a);
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
  prefs.set('spotylist-last', chart.id);
  setArt(artKind(chart.id));
  const periods = allPeriods(chart);
  if (!periods.includes(period)) period = periods.at(-1);
  current = { chart, period, links: [], ids: [], total: 0 };

  ui.chart.value = chart.group?.id ?? chart.id;
  fillPeriodSelects(chart, period);
  if (updateHash) history.replaceState(null, '', `#${chart.id}/${period}`);

  ui.status.textContent = 'Loading…';
  ui.copyHint.hidden = true;
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
  const rows = entries.map(([pos, idx]) => trackItem(pos, data.tracks[idx]));
  current.ids = entries.map(([, idx]) => data.tracks[idx][2]).filter(Boolean);
  current.links = current.ids.map((id) => `https://open.spotify.com/track/${id}`);
  current.total = entries.length;

  ui.tracks.replaceChildren(...rows);
  ui.title.textContent = [chart.title ?? chart.label, periodLabel(chart, period)].filter(Boolean).join(' — ');
  const pending = entries.filter(([, idx]) => data.tracks[idx][6]).length;
  ui.stats.textContent = `${current.links.length} of ${entries.length} on Spotify`
    + (pending ? ` · ${pending} not looked up yet` : '');
  ui.source.href = url;
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
  list.append(...(entries ?? []).map(([pos, track]) => trackItem(pos, track)));
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

function renderHome() {
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
  ui.copyHint.hidden = true;
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

/** Show what the address asks for: a chart, home, or (bare address) the start page. */
function route({ initial = false } = {}) {
  const { chartId, period } = fromHash();
  if (catalogue.some((c) => c.id === chartId)) return show(chartId, period, { updateHash: !period });
  const members = groupMembers(chartId); // e.g. #nl-decenniumlijst: its most recent chart
  if (members.length) return show(members.at(-1).id, null);
  const last = prefs.get('spotylist-last');
  if (initial && !location.hash && startPage === 'last' && catalogue.some((c) => c.id === last)) return show(last, null);
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
  ui.playlist.hidden = !loggedIn;
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

function renderAccount(note = '') {
  const name = loggedInAs();
  // A login from before SpotyList asked to read playlists: finding lists saved elsewhere needs it.
  if (name && !note && !canFindPlaylists()) note = 'Log out and in again once, so SpotyList can also recognise lists you saved on other devices.';
  ui.accountName.textContent = name ? `Logged in as ${name}` : 'Not logged in';
  ui.accountButton.textContent = name ? 'Log out' : 'Log in';
  ui.accountNote.textContent = note;
  ui.accountNote.hidden = !note;
  // Logged in: the account's own Spotify profile picture instead of the plain icon, if it has one.
  const image = accountImage();
  if (image && ui.accountAvatar.getAttribute('src') !== image) ui.accountAvatar.src = image;
  ui.accountAvatar.hidden = !image;
  ui.accountIcon.toggleAttribute('hidden', Boolean(image));
  // The playlist import is for the owner: fix mode and logged in.
  ui.importOption.hidden = !(fixMode && name);
  updateActions();
}

// Playlist import (owner): read a playlist of the logged-in account (a copy of e.g. a Top 2000
// playlist) and offer its tracks as a file for data/imports/ in the data repository; the
// "Import playlist matches" workflow links chart songs to them without Spotify searches.
async function importPlaylist(event) {
  event.preventDefault();
  const id = playlistIdFrom(ui.importLink.value);
  const note = (...parts) => { ui.importNote.replaceChildren(...parts); ui.importNote.hidden = false; };
  if (!id) {
    note('Paste the link of a playlist (Spotify: ··· → Share → Copy link to playlist).');
    return;
  }
  ui.importRead.disabled = true;
  try {
    const { name, tracks } = await readPlaylist(id, (read, total) => note(`Reading ${read}${total ? ` of ${total}` : ''} tracks…`));
    if (!tracks.length) {
      note('This playlist has no tracks.');
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const slug = (name ?? id).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || id;
    const file = new Blob([JSON.stringify({ source: { id, name }, exported: date, tracks })], { type: 'application/json' });
    const download = document.createElement('a');
    download.href = URL.createObjectURL(file);
    download.download = `${slug}-${date}.json`;
    download.textContent = `Download ${download.download}`;
    const upload = document.createElement('a');
    upload.href = `https://github.com/${REPO}/upload/master/data/imports`;
    upload.target = '_blank';
    upload.rel = 'noopener';
    upload.textContent = 'upload it to data/imports';
    note(`${tracks.length} tracks read from “${name ?? id}”. `, download, ', then ', upload, ' in the data repository.');
  } catch (err) {
    const own = ['denied', 'http'].includes(err.code) ? ' Spotify only lets SpotyList read playlists you own: copy it into a playlist of your own first.' : '';
    note(`${err.message}${own}`);
  } finally {
    ui.importRead.disabled = false;
  }
}

/**
 * The playlist's description credits the chart's publisher with a link to the original list:
 * SpotyList only matched its songs to Spotify. Spotify allows 300 characters; a URL that does
 * not fit is left out, the publisher's name stays.
 */
function playlistDescription(name, tag) {
  const url = ui.source.href;
  let publisher = '';
  try { publisher = new URL(url).hostname.replace(/^www\./, ''); } catch { /* no source link */ }
  const room = 300 - tag.length - 1; // the tag always fits, at the end
  const songs = `Songs matched to Spotify by SpotyList (spotylist.nl): ${current.ids.length} of ${current.total}.`;
  const withUrl = `Chart: ${name}, as published by ${publisher} (${url}). ${songs}`;
  let text;
  if (publisher && withUrl.length <= room) text = withUrl;
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

/** The account row in the options; shown only when the site was built with a client ID. */
async function initAccount() {
  if (!(await initSpotify())) return;
  ui.accountOption.hidden = false;
  ui.accountButton.addEventListener('click', () => {
    if (!loggedInAs()) {
      login();
      return;
    }
    logout();
    ui.playlistHint.hidden = true;
    renderAccount('Logged out.');
  });
  ui.playlist.addEventListener('click', () => saveAsPlaylist());
  ui.importOption.addEventListener('submit', importPlaylist);
  ui.accountAvatar.addEventListener('error', () => {
    ui.accountAvatar.hidden = true;
    ui.accountIcon.removeAttribute('hidden');
  });
  let note = '';
  try {
    const name = await finishLogin();
    if (name) note = 'You can now save a list with the + next to its title.';
  } catch (err) {
    note = err.message;
  }
  renderAccount(note);
  if (note) setMenuOpen(true); // back from Spotify's login page: show how it went
  // In the background, so the page does not wait for it.
  completeProfile().then((loaded) => loaded && renderAccount(ui.accountNote.textContent));
}

function applyOpenMode(mode, { save = false } = {}) {
  openMode = mode;
  if (save) prefs.set('spotylist-open', mode);
  for (const b of document.querySelectorAll('[data-open]')) b.setAttribute('aria-pressed', String(b.dataset.open === mode));
  // Re-render the current list so its links use the new mode (the data is cached).
  if (current.chart) show(current.chart.id, current.period, { updateHash: false });
  else if (homeData && !ui.home.hidden) renderHome();
}

function applyStartPage(page, { save = false } = {}) {
  startPage = page;
  if (save) prefs.set('spotylist-start', page === 'home' ? null : page);
  for (const b of document.querySelectorAll('[data-start]')) b.setAttribute('aria-pressed', String(b.dataset.start === page));
}

function applyTheme(next) {
  theme = next;
  prefs.set('spotylist-theme', next === 'dark' ? null : next);
  if (next === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  const dark = next === 'dark' || (next === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.getElementById('theme-color').content = dark ? '#0e0c15' : '#f7f5fc';
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === next));
}

function setMenuOpen(open) {
  ui.options.hidden = !open;
  ui.menu.setAttribute('aria-expanded', String(open));
  if (open) ui.options.querySelector('[aria-pressed="true"], button, input')?.focus();
}

function initMenu() {
  ui.menu.addEventListener('click', () => setMenuOpen(ui.options.hidden));
  document.addEventListener('click', (e) => {
    if (!ui.options.hidden && !ui.options.contains(e.target) && !ui.menu.contains(e.target)) setMenuOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.options.hidden) {
      setMenuOpen(false);
      ui.menu.focus();
    }
  });
  // Only shown once fix mode was switched on with ?fix, so visitors never see it.
  ui.fixOption.hidden = !fixMode;
  ui.statusLink.hidden = !fixMode;
  ui.fixToggle.checked = fixMode;
  ui.fixToggle.addEventListener('change', () => {
    fixMode = ui.fixToggle.checked;
    prefs.set('spotylist-fix', fixMode ? '1' : null);
    ui.importOption.hidden = !(fixMode && loggedInAs());
    ui.statusLink.hidden = !fixMode;
    if (current.chart) show(current.chart.id, current.period, { updateHash: false });
    else if (homeData && !ui.home.hidden) renderHome();
  });
}

// The published version (when the site was built), shown in the options with a Reload: an app
// on the home screen runs full screen, without the browser's address bar and reload button.
// Coming back to it after a while, it checks (one HEAD request, at most every 15 minutes)
// whether a newer version was published since, and then reloads itself.
let publishedAt = null; // the Last-Modified of data/charts.json this page was loaded with
let lastVersionCheck = Date.now();
const VERSION_CHECK_MS = 15 * 60_000;

function showVersion(builtAt, lastModified) {
  publishedAt = lastModified;
  const date = new Date(builtAt);
  if (Number.isNaN(date.getTime())) return;
  ui.version.textContent = date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  ui.versionLine.hidden = false;
}

async function reloadLatest() {
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* reload anyway */ }
  location.reload();
}

async function checkForNewVersion() {
  if (document.visibilityState !== 'visible' || !publishedAt || Date.now() - lastVersionCheck < VERSION_CHECK_MS) return;
  lastVersionCheck = Date.now();
  try {
    const res = await fetch('data/charts.json', { method: 'HEAD', cache: 'no-cache' });
    const modified = res.headers.get('last-modified');
    if (res.ok && modified && modified !== publishedAt) reloadLatest();
  } catch { /* offline: keep what is shown */ }
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
  // The options work even when no chart data could be loaded.
  initMenu();
  ui.reload.addEventListener('click', reloadLatest);
  document.addEventListener('visibilitychange', checkForNewVersion);
  applyTheme(THEMES.includes(theme) ? theme : 'dark');
  for (const b of document.querySelectorAll('[data-theme-choice]')) {
    b.addEventListener('click', () => applyTheme(b.dataset.themeChoice));
  }
  applyStartPage(startPage);
  for (const b of document.querySelectorAll('[data-start]')) {
    b.addEventListener('click', () => applyStartPage(b.dataset.start, { save: true }));
  }
  ui.openOption.hidden = isMobile;
  applyOpenMode(openMode === 'web' ? 'web' : 'app');
  for (const b of document.querySelectorAll('[data-open]')) {
    b.addEventListener('click', () => applyOpenMode(b.dataset.open, { save: true }));
  }

  // Before routing: a return from Spotify's login page restores the address it left from.
  await initAccount();

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
      window.scrollTo(0, 0);
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
  await route({ initial: true });
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
