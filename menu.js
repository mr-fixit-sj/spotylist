// The ☰ menu, the same on every page (charts, stories, data status): pages to go to, the
// Spotify account, how songs open, the theme, the owner's tools and the version. A page only
// needs <div class="menu" id="menu-root" data-page="charts|stories|status"></div> in its header
// and to import this module. The charts page (app.js) follows changes through events on
// document: "spotylist:openmode", "spotylist:fix" and "spotylist:account".
import { initSpotify, login, logout, finishLogin, loggedInAs, accountImage, completeProfile, canFindPlaylists, readPlaylist, playlistIdFrom } from './spotify.js';

// Per-browser preferences. Storage can be unavailable (private mode, blocked site data).
export const prefs = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* not saved */ }
  },
};
// Settings that no longer exist: the start page is always the home page.
prefs.set('spotylist-start', null);
prefs.set('spotylist-last', null);

// On phones https links already open the Spotify app (and fall back to the web player), so
// phones and tablets always use them and get no choice. On desktops only spotify: URIs reach
// the app: the default there, with the web player as an option.
export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPadOS
let openMode = isMobile ? 'web' : (prefs.get('spotylist-open') === 'web' ? 'web' : 'app');
export const getOpenMode = () => openMode;

// Fix mode, for the owner: Fix buttons next to songs, the playlist import and the data status.
// Switched on with ?fix in the page URL, off with ?fix=0; remembered per browser.
const REPO = 'mr-fixit-sj/git-repos-spotylist';
const fixParam = new URLSearchParams(location.search).get('fix');
if (fixParam !== null) {
  prefs.set('spotylist-fix', fixParam === '0' ? null : '1');
  history.replaceState(null, '', location.pathname + location.hash);
}
let fixMode = prefs.get('spotylist-fix') === '1';
export const isFixMode = () => fixMode;

const THEMES = ['system', 'light', 'dark'];
const page = document.getElementById('menu-root')?.dataset.page ?? 'charts';

const ICONS = {
  charts: '<path d="M5 6h14M5 12h14M5 18h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  stories: '<path d="M4 5.5c2.5-1 5.5-1 8 .5 2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6v13" stroke="currentColor" stroke-width="1.8"/>',
};
const navRow = (id, href, title, sub) => `
          <a class="nav-row" href="${href}" ${page === id ? 'aria-current="page"' : ''}>
            <svg class="nav-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${ICONS[id]}</svg>
            <span><strong>${title}</strong><small>${sub}</small></span>
          </a>`;

document.getElementById('menu-root').innerHTML = `
      <button id="menu" type="button" class="menu-button" aria-label="Menu" aria-expanded="false" aria-controls="options">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <div id="options" class="options" role="dialog" aria-label="Menu" hidden>
        <nav class="menu-nav" aria-label="Pages">${navRow('charts', page === 'charts' ? '#home' : './', 'Charts', 'Weekly charts and collections')}${navRow('stories', 'stories.html', 'Chart stories', 'Christmas, baby names, comebacks')}
        </nav>
        <div class="option" id="account-option" hidden>
          <span class="option-label">Spotify account</span>
          <div class="account">
            <img id="account-avatar" class="account-avatar" alt="" width="28" height="28" referrerpolicy="no-referrer" hidden>
            <svg id="account-icon" class="account-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <span id="account-name" class="account-name">Not logged in</span>
            <button type="button" id="account-button">Log in</button>
          </div>
          <p class="option-note" id="account-note" role="status" hidden></p>
        </div>
        <div class="option" id="open-option" ${isMobile ? 'hidden' : ''}>
          <span class="option-label" id="open-label">Open songs in</span>
          <div class="segmented" role="group" aria-labelledby="open-label">
            <button type="button" data-open="app">App</button>
            <button type="button" data-open="web">Web player</button>
          </div>
        </div>
        <div class="option">
          <span class="option-label" id="theme-label">Theme</span>
          <div class="segmented" role="group" aria-labelledby="theme-label">
            <button type="button" data-theme-choice="system">Auto</button>
            <button type="button" data-theme-choice="light">Light</button>
            <button type="button" data-theme-choice="dark">Dark</button>
          </div>
        </div>
        <label class="option option-check" id="fix-option" hidden>
          <input type="checkbox" id="fix-toggle"> Show Fix buttons (corrects Spotify links)
        </label>
        <form class="option" id="import-option" hidden>
          <label class="option-label" for="import-link">Import a playlist (links chart songs to its tracks)</label>
          <div class="import-row">
            <input id="import-link" type="text" inputmode="url" placeholder="Link to your own copy of a playlist" autocomplete="off">
            <button type="submit" id="import-read">Read</button>
          </div>
          <p class="option-note" id="import-note" role="status" hidden></p>
        </form>
        <p class="option-version" id="version-line" hidden>
          Version <span id="version"></span> · <button type="button" class="link-button" id="reload">Reload</button><span id="status-link" hidden> · <a class="link-button" href="status.html">Data status</a></span>
        </p>
      </div>`;

const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), options: $('options'),
  accountOption: $('account-option'), accountName: $('account-name'), accountAvatar: $('account-avatar'), accountIcon: $('account-icon'), accountButton: $('account-button'), accountNote: $('account-note'),
  fixOption: $('fix-option'), fixToggle: $('fix-toggle'), statusLink: $('status-link'),
  importOption: $('import-option'), importLink: $('import-link'), importRead: $('import-read'), importNote: $('import-note'),
  versionLine: $('version-line'), version: $('version'), reload: $('reload'),
};
const announce = (name) => document.dispatchEvent(new CustomEvent(`spotylist:${name}`));

export function setMenuOpen(open) {
  ui.options.hidden = !open;
  ui.menu.setAttribute('aria-expanded', String(open));
  if (open) ui.options.querySelector('[aria-current="page"], [aria-pressed="true"], button, input')?.focus();
}
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
// Going to a page (or back home on the charts page) closes the menu.
for (const a of ui.options.querySelectorAll('.nav-row')) a.addEventListener('click', () => setMenuOpen(false));

function applyOpenMode(mode, save) {
  openMode = mode;
  if (save) prefs.set('spotylist-open', mode);
  for (const b of ui.options.querySelectorAll('[data-open]')) b.setAttribute('aria-pressed', String(b.dataset.open === mode));
  if (save) announce('openmode');
}
applyOpenMode(openMode, false);
for (const b of ui.options.querySelectorAll('[data-open]')) b.addEventListener('click', () => applyOpenMode(b.dataset.open, true));

function applyTheme(next) {
  prefs.set('spotylist-theme', next === 'dark' ? null : next);
  if (next === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  const dark = next === 'dark' || (next === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = $('theme-color');
  if (meta) meta.content = dark ? '#0e0c15' : '#f7f5fc';
  for (const b of ui.options.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === next));
}
const theme = prefs.get('spotylist-theme') ?? 'dark'; // dark unless chosen otherwise
applyTheme(THEMES.includes(theme) ? theme : 'dark');
for (const b of ui.options.querySelectorAll('[data-theme-choice]')) b.addEventListener('click', () => applyTheme(b.dataset.themeChoice));

// Owner tools: only shown once fix mode was switched on with ?fix, so visitors never see them.
function applyFixMode() {
  ui.fixOption.hidden = !fixMode;
  ui.fixToggle.checked = fixMode;
  ui.statusLink.hidden = !fixMode;
  ui.importOption.hidden = !fixMode || ui.accountOption.hidden;
}
applyFixMode();
ui.fixToggle.addEventListener('change', () => {
  fixMode = ui.fixToggle.checked;
  prefs.set('spotylist-fix', fixMode ? '1' : null);
  applyFixMode();
  announce('fix');
});

/** The account row; also tells the page ("spotylist:account"), which may show the + for playlists. */
export function renderAccount(note = '') {
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
  // The playlist import is for the owner, in fix mode; logged out it says to log in first.
  applyFixMode();
  ui.importLink.disabled = ui.importRead.disabled = !name;
  ui.importLink.placeholder = name ? 'Link to your own copy of a playlist' : 'Log in to Spotify first (above)';
  announce('account');
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
    if (err.code === 'login') renderAccount();
  } finally {
    ui.importRead.disabled = !loggedInAs();
  }
}

/** The account row, shown only when the site was built with a client ID; finishes a login. */
async function initAccount() {
  if (!(await initSpotify())) return;
  ui.accountOption.hidden = false;
  ui.accountButton.addEventListener('click', () => {
    if (!loggedInAs()) {
      login();
      return;
    }
    logout();
    renderAccount('Logged out.');
  });
  ui.importOption.addEventListener('submit', importPlaylist);
  ui.accountAvatar.addEventListener('error', () => {
    ui.accountAvatar.hidden = true;
    ui.accountIcon.removeAttribute('hidden');
  });
  let note = '';
  try {
    const name = await finishLogin(); // navigates away when the login started on another page
    if (name) note = page === 'charts' ? 'You can now save a list with the + next to its title.' : 'Logged in.';
  } catch (err) {
    note = err.message;
  }
  renderAccount(note);
  if (note) setMenuOpen(true); // back from Spotify's login page: show how it went
  // In the background, so the page does not wait for it.
  completeProfile().then((loaded) => loaded && renderAccount(ui.accountNote.textContent));
}

// The published version (when the site was built), with a Reload: an app on the home screen
// runs full screen, without the browser's address bar and reload button. Coming back to it
// after a while, it checks (one HEAD request, at most every 15 minutes) whether a newer
// version was published since, and then reloads itself.
let publishedAt = null; // the Last-Modified of data/charts.json this page was loaded with
let lastVersionCheck = Date.now();
const VERSION_CHECK_MS = 15 * 60_000;

/** Shows the version: the build time, and Last-Modified of data/charts.json for update checks. */
export function showVersion(builtAt, lastModified) {
  publishedAt = lastModified;
  const date = new Date(builtAt ?? lastModified);
  if (Number.isNaN(date.getTime())) return;
  ui.version.textContent = date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  ui.versionLine.hidden = false;
}

async function reloadLatest() {
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* reload anyway */ }
  location.reload();
}
ui.reload.addEventListener('click', reloadLatest);

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !publishedAt || Date.now() - lastVersionCheck < VERSION_CHECK_MS) return;
  lastVersionCheck = Date.now();
  try {
    const res = await fetch('data/charts.json', { method: 'HEAD', cache: 'no-cache' });
    const modified = res.headers.get('last-modified');
    if (res.ok && modified && modified !== publishedAt) reloadLatest();
  } catch { /* offline: keep what is shown */ }
});

// Pages other than the charts read the version themselves; the charts page passes it on.
if (page !== 'charts') {
  fetch('data/charts.json', { method: 'HEAD', cache: 'no-cache' })
    .then((res) => res.ok && showVersion(null, res.headers.get('last-modified')))
    .catch(() => {});
}

/** Resolves once the account is known (and a return from Spotify's login page handled). */
export const menuReady = initAccount();
