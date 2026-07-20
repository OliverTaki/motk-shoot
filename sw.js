/* MOTK Shoot — tiny offline cache */
const CACHE = 'motkshoot-v26';
const ASSETS = [
  './', 'index.html', 'monitor.html', 'css/app.css', 'css/monitor.css', 'manifest.json',
  'js/util.js', 'js/db.js', 'js/local-folder.js', 'js/camera.js', 'js/frames.js', 'js/viewport.js',
  'js/layers.js', 'js/audio.js', 'js/playback.js', 'js/timeline.js',
  'js/xsheet.js', 'js/export.js', 'js/editorial.js', 'js/ae-roundtrip.js', 'js/post-adapter.js', 'js/resolve-roundtrip.js', 'js/autograph-roundtrip.js', 'js/project.js', 'js/production.js', 'js/cinematography.js', 'js/faces.js', 'js/review.js', 'js/tether.js',
  'js/bridge.js', 'js/ecosystem.js', 'js/monitor.js', 'js/shortcuts.js', 'js/ui.js', 'js/main.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Phase 1.6 is a separate, optional 2 MB WebUSB/WASM lab. Never let opening
  // it enlarge or alter the production app's offline cache.
  if (new URL(e.request.url).pathname.includes('/experiments/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
