// sw.js — ponytail: minimal service worker, just enough for 'add to home screen'
// installability. Network-first everywhere; only the static shell is precached
// on install so an offline reload has *something* to show instead of failing.
// PeerJS/WebRTC signaling and /api/* calls are never intercepted — P2P
// networking and the account/lobby backend must always hit the network live.
// New deploy? bump CACHE_V1 so clients drop the stale shell.
const CACHE_V1 = 'warrball-shell-v1';

const SHELL_URLS = [
    './',
    'index.html',
    'manifest.webmanifest',
    'css/style.css',
    'css/ui-tokens.css',
    'css/ui-shell.css',
    'css/polish.css',
    'css/auth.css',
    'vendor/three/three.module.js',
    'vendor/peerjs/peerjs.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_V1)
            .then((cache) => cache.addAll(SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_V1).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    // Bypass: cross-origin (PeerJS cloud broker, WebRTC/ICE), REST API, and any
    // same-origin peerjs path — never let the cache sit between the client and P2P.
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;
    if (url.pathname.includes('/peerjs')) return;

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_V1).then((cache) => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request).then((cached) => cached || caches.match('index.html')))
    );
});
