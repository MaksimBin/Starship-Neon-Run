const CACHE_NAME = 'starship-neon-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.json',
  './player.png',
  './enemy.png',
  './bg_tile.png',
  './bg_music.mp3',
  './favicon-192x192.png',
  './favicon-512×512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});