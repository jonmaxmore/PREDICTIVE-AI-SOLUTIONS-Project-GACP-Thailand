/*
 * Transitional SW cleanup file.
 * Purpose: if old service workers were registered before TLS/domain hardening,
 * this file forces unregister + cache cleanup to prevent persistent SW errors.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      const cleanupTargets = keys.filter((key) => {
        const name = key.toLowerCase();
        return name.includes('serwist') || name.includes('workbox') || name.includes('next-pwa');
      });
      await Promise.all(cleanupTargets.map((key) => caches.delete(key)));
    } catch {
      // ignore cache cleanup error
    }

    await self.registration.unregister();

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
