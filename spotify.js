// Spotify login (for the owner and a few friends) to save a chart as a playlist.
// Authorization code flow with PKCE: made for browser apps, so no server and no client secret;
// the client ID in data/config.json is public by design. The tokens stay in this browser.
// Spotify only lets accounts listed in the app's Developer Dashboard (User Management, at most
// 5) use the app: others can log in, but every API call then answers 403 ("…may not be
// registered"). A 403 can also mean a missing permission (scope), so the message decides.

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
// Create playlists, and read them to find a list's playlist saved before (findPlaylist).
const SCOPES = 'playlist-modify-private playlist-read-private';
const AUTH_KEY = 'spotylist-auth'; // localStorage: { access, refresh, expires, scope, id, name, image }
// localStorage during the login: { verifier, state, hash }. Not sessionStorage: an app on the
// iOS home screen may lose that on the way to Spotify's login page and back.
const PENDING_KEY = 'spotylist-login';

/** A message for the visitor; `code` tells callers what happened. */
export class SpotifyError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const store = {
  get(storage, key) {
    try { return JSON.parse(storage.getItem(key)); } catch { return null; }
  },
  set(storage, key, value) {
    try { value == null ? storage.removeItem(key) : storage.setItem(key, JSON.stringify(value)); } catch { /* not saved */ }
  },
};

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (bytes) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));
// Must match a Redirect URI in the dashboard exactly, e.g. https://spotylist.nl/
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

let clientId = null;
let auth = store.get(localStorage, AUTH_KEY);

/** Loads the client ID; false when the site was built without one (login not offered). */
export async function initSpotify() {
  try {
    const res = await fetch('data/config.json');
    clientId = res.ok ? (await res.json()).spotifyClientId ?? null : null;
  } catch {
    clientId = null;
  }
  return Boolean(clientId);
}

/** The logged-in name, or null; also null on a site built without a client ID. */
export const loggedInAs = () => (clientId && auth ? auth.name ?? 'Spotify user' : null);

/** The logged-in account's profile picture URL, or null (none, or not loaded yet). */
export const accountImage = () => (loggedInAs() ? auth.image ?? null : null);

/**
 * Whether this login may read the account's playlists (scope playlist-read-private). Logins
 * from before that permission was asked for may not; logging in again grants it.
 */
export const canFindPlaylists = () => Boolean(loggedInAs()) && (auth.scope ?? '').split(' ').includes('playlist-read-private');

// The smallest profile picture that is still sharp at 28 CSS pixels on a 2x screen.
const pickImage = (images = []) => {
  const sized = [...images].filter((i) => i?.url).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sized.find((i) => (i.width ?? 0) >= 56) ?? sized.at(-1))?.url ?? null;
};

async function loadProfile() {
  const me = await api('/me');
  auth = { ...auth, id: me.id, name: me.display_name || me.id, image: pickImage(me.images) };
  store.set(localStorage, AUTH_KEY, auth);
}

/**
 * A login from before profile pictures were shown has none stored: fetch the profile once.
 * Returns true when it was loaded; failures are ignored (the plain icon stays).
 */
export async function completeProfile() {
  if (!loggedInAs() || 'image' in auth) return false;
  try {
    await loadProfile();
    return true;
  } catch {
    return false;
  }
}

export function logout() {
  auth = null;
  store.set(localStorage, AUTH_KEY, null);
}

/** Goes to Spotify's login page; it comes back to this page with ?code=… (see finishLogin). */
export async function login() {
  const verifier = randomString(48);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  store.set(localStorage, PENDING_KEY, { verifier, state, hash: location.hash });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  location.assign(`${ACCOUNTS}/authorize?${params}`);
}

async function tokenRequest(fields) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...fields }),
  });
  if (!res.ok) throw new SpotifyError(`Spotify login failed (HTTP ${res.status}).`, 'token');
  const body = await res.json();
  auth = {
    ...auth,
    access: body.access_token,
    refresh: body.refresh_token ?? auth?.refresh,
    expires: Date.now() + (body.expires_in - 60) * 1000,
    scope: body.scope ?? auth?.scope ?? '',
  };
  store.set(localStorage, AUTH_KEY, auth);
}

/**
 * On the way back from Spotify's login page: exchanges the code for tokens and restores the
 * page the visitor was on. Returns null when this page load is not a login return.
 * Throws a SpotifyError with a message for the visitor when the login did not work.
 */
export async function finishLogin() {
  const query = new URLSearchParams(location.search);
  if (!query.has('code') && !query.has('error')) return null;
  const pending = store.get(localStorage, PENDING_KEY);
  store.set(localStorage, PENDING_KEY, null);
  history.replaceState(null, '', location.pathname + (pending?.hash ?? ''));
  if (query.get('error')) throw new SpotifyError(query.get('error') === 'access_denied' ? 'Spotify login cancelled.' : `Spotify login failed (${query.get('error')}).`, 'cancelled');
  if (!pending || pending.state !== query.get('state')) throw new SpotifyError('Spotify login expired; please try again.', 'state');
  await tokenRequest({ grant_type: 'authorization_code', code: query.get('code'), redirect_uri: redirectUri(), code_verifier: pending.verifier });
  try {
    await loadProfile();
  } catch (err) {
    logout();
    throw err;
  }
  return auth.name;
}

async function api(path, { method = 'GET', body } = {}, retried = false) {
  if (!auth) throw new SpotifyError('Log in to Spotify first (☰ menu).', 'login');
  if (Date.now() > auth.expires) await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh }).catch(() => logout());
  if (!auth) throw new SpotifyError('Your Spotify login expired; please log in again (☰ menu).', 'login');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${auth.access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) {
    auth.expires = 0; // token revoked or expired early: refresh once
    return api(path, { method, body }, true);
  }
  if (res.status === 403) {
    const message = (await res.json().catch(() => null))?.error?.message ?? '';
    if (path === '/me' || /regist|dashboard/i.test(message)) {
      throw new SpotifyError('This Spotify account is not on SpotyList\'s access list. Ask the site owner to add it.', 'forbidden');
    }
    throw new SpotifyError(`Spotify refused this request (${message || 'HTTP 403'}).`, 'denied');
  }
  if (res.status === 429) throw new SpotifyError('Spotify is busy (request limit reached). Please try again later.', 'busy');
  if (!res.ok) throw new SpotifyError(`Spotify answered HTTP ${res.status}.`, 'http');
  return res.status === 204 ? null : res.json();
}

// Spotify returns descriptions HTML-escaped (e.g. "/" as "&#x2F;").
const unescapeHtml = (text) => new DOMParser().parseFromString(text ?? '', 'text/html').documentElement.textContent;
const MAX_PLAYLIST_PAGES = 20; // 1000 playlists: enough, and a bound on the requests

/**
 * Whether a playlist (by id) is still in the account's playlists: one deleted in Spotify is
 * not. null when that cannot be checked (a login without the read permission). One request
 * per 50 playlists, newest first.
 */
export async function playlistExists(id) {
  if (!canFindPlaylists()) return null;
  for (let page = 0; page < MAX_PLAYLIST_PAGES; page++) {
    const body = await api(`/me/playlists?limit=50&offset=${page * 50}`);
    if ((body.items ?? []).some((p) => p?.id === id)) return true;
    if (!body.next) return false;
  }
  return false;
}

/**
 * Looks in the account's own playlists for the list's playlist: one whose description
 * contains one of `tags` (see playlistTags in app.js), or, as a fallback (a description
 * edited in Spotify, or not returned), one named exactly like one of `names`. Returns { playlist, checked }:
 * the playlist ({ name, url, uri }) or null, and how many playlists were looked at. One
 * request per 50 playlists; Spotify lists the newest first.
 */
export async function findPlaylist(tags, names) {
  let checked = 0;
  for (let page = 0; page < MAX_PLAYLIST_PAGES; page++) {
    const body = await api(`/me/playlists?limit=50&offset=${page * 50}`);
    const own = (body.items ?? []).filter((p) => p && (!auth.id || p.owner?.id === auth.id));
    checked += (body.items ?? []).length;
    const hit = own.find((p) => tags.some((tag) => unescapeHtml(p.description).includes(tag)))
      ?? own.find((p) => names.includes(unescapeHtml(p.name)));
    if (hit) return { playlist: { id: hit.id, name: hit.name, url: hit.external_urls?.spotify, uri: hit.uri }, checked };
    if (!body.next) break;
  }
  return { playlist: null, checked };
}

/** The Spotify link or URI of a playlist → its id, or null. */
export function playlistIdFrom(text) {
  const m = String(text ?? '').trim().match(/(?:playlist[/:])([A-Za-z0-9]{22})\b/) ?? String(text ?? '').trim().match(/^([A-Za-z0-9]{22})$/);
  return m ? m[1] : null;
}

/**
 * All tracks of a playlist the account owns or collaborates on (Spotify only allows those),
 * for a playlist import: { name, tracks: [[id, name, "Artist, Artist", imageId], ...] }.
 * One request per 50 tracks; `onProgress(read, total)` after each.
 */
export async function readPlaylist(id, onProgress = () => {}) {
  const info = await api(`/playlists/${id}?fields=name,items(total)`).catch(() => null);
  const tracks = [];
  let total = info?.items?.total ?? null;
  for (let offset = 0; ; offset += 50) {
    const body = await api(`/playlists/${id}/items?limit=50&offset=${offset}`);
    total = body.total ?? total;
    for (const entry of body.items ?? []) {
      const t = entry?.item ?? entry?.track; // "track" before the February 2026 API changes
      if (!t?.id || (t.type && t.type !== 'track')) continue; // podcasts, local files
      const image = t.album?.images?.find((i) => i.width && i.width <= 320) ?? t.album?.images?.at(-1);
      tracks.push([t.id, t.name, (t.artists ?? []).map((a) => a.name).join(', '), image?.url?.split('/image/')[1] ?? null]);
    }
    onProgress(Math.min(offset + 50, total ?? offset + 50), total);
    if (!body.next || !(body.items ?? []).length) break;
  }
  return { name: info?.name ?? null, tracks };
}

/** Creates a private playlist in the logged-in account; returns { id, name, url, uri, added }. */
export async function createPlaylist(name, description, trackIds) {
  const playlist = await api('/me/playlists', { method: 'POST', body: { name, description, public: false } });
  const uris = trackIds.map((id) => `spotify:track:${id}`);
  for (let i = 0; i < uris.length; i += 100) {
    await api(`/playlists/${playlist.id}/items`, { method: 'POST', body: { uris: uris.slice(i, i + 100) } });
  }
  return { id: playlist.id, name: playlist.name, url: playlist.external_urls?.spotify, uri: playlist.uri, added: uris.length };
}

/**
 * Replaces all songs of an existing playlist (the "This week" playlist), and its name and
 * description. Those are a nicety: when Spotify refuses that change, the songs are still updated.
 */
export async function replacePlaylist(id, name, description, trackIds) {
  const uris = trackIds.map((trackId) => `spotify:track:${trackId}`);
  await api(`/playlists/${id}/items`, { method: 'PUT', body: { uris: uris.slice(0, 100) } });
  for (let i = 100; i < uris.length; i += 100) {
    await api(`/playlists/${id}/items`, { method: 'POST', body: { uris: uris.slice(i, i + 100) } });
  }
  await api(`/playlists/${id}`, { method: 'PUT', body: { name, description } }).catch(() => {});
  return uris.length;
}
