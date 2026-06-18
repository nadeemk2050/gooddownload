// Service Worker for TubeSprint PWA
/* global importScripts */
self.__WB_MANIFEST;

const CACHE_NAME = 'tubesprint-v2';

const PRECACHE_URLS = [];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete old caches so stale HTML with wrong CSP doesn't persist
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Network-first strategy: always fetch fresh, fall back to cache only if offline
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
