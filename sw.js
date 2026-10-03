// Service worker for the installed app (home screen): network first, so every publish shows
// up at once, with the last copy of each page file and chart as a fallback when offline.
// "no-cache": always ask the server whether a file changed (a small 304 when it did not),
// instead of trusting the browser's HTTP cache, which GitHub Pages allows for 10 minutes.
// Only this site's own files; Spotify (API, covers, links) is never touched.
const CACHE = 'spotylist-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'art.js', 'spotify.js', 'logo.svg', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (err) {
      // Offline: the stored copy; for a page (e.g. after the Spotify login, with ?code=…) the app.
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      if (cached) return cached;
      if (request.mode === 'navigate') return (await cache.match('./')) ?? Response.error();
      throw err;
    }
  })());
});
