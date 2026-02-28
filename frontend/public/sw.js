// Minimal service worker — satisfies Chrome PWA installability requirement.
// Does not cache anything (real-time game with WebSocket connections).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
