/**
 * Service Worker for The Arcade of Life
 * Strategy: Cache-first for static assets, network-first for markdown docs.
 */

    const CACHE_NAME = 'arcade-of-life-v7';
// Resolve the scope path so cache keys are relative to wherever the SW
// is registered (root or subdirectory).
const SCOPE_PATH = new URL(self.registration ? self.registration.scope : './', self.location).pathname;
const STATIC_ASSETS = [
     './',
     './index.html',
    './style.css',
    './src/main.js',
    './src/config.js',
    './src/grid.js',
    './src/simulation.js',
    './src/renderer.js',
    './src/hud.js',
    './src/input.js',
    './src/gameState.js',
    './src/settings.js',
    './src/guide.js',
    './src/drawTools.js',
    './src/story.js',
    //'./src/logger.js',
    './src/audio.js',
    './src/abilities.js',
    './src/entities/cities.js',
    './src/entities/missiles.js',
    './src/entities/defenses.js',
    './src/marked.min.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

const NETWORK_FIRST = [
     'README.md',
     'console_guide.md',
];

// ── Install: pre-cache all static assets ──────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Add assets individually so one 404 doesn't abort the whole install.
            return Promise.allSettled(
                STATIC_ASSETS.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn(`[SW] Failed to cache ${url}:`, err);
                    })
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// ── Activate: purge old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => k !== CACHE_NAME)
                    .map((k) => {
                        console.log(`[SW] Deleting old cache: ${k}`);
                        return caches.delete(k);
                    })
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: route requests ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle same-origin GET requests.
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    const isNetworkFirst = NETWORK_FIRST.some((p) => url.pathname.endsWith(p));

    if (isNetworkFirst) {
        event.respondWith(networkFirst(request));
    } else {
        event.respondWith(cacheFirst(request));
    }
});

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Offline — asset not cached.', { status: 503 });
    }
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Offline — content unavailable.', { status: 503 });
    }
}

// ── Background sync: save high score when back online ─────────────────────
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});