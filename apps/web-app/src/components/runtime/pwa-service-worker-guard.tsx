'use client';

import { useEffect } from 'react';

const isPwaEnabled = process.env.NEXT_PUBLIC_PWA_ENABLED === 'true';

function shouldDeleteCache(cacheName: string): boolean {
  const normalized = cacheName.toLowerCase();
  return normalized.includes('serwist') || normalized.includes('workbox') || normalized.includes('next-pwa');
}

export function PwaServiceWorkerGuard() {
  useEffect(() => {
    if (isPwaEnabled) {
      return;
    }
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const unregisterServiceWorkers = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      } catch {
        // Ignore runtime cleanup errors: this guard is best-effort.
      }

      try {
        if (!('caches' in window)) {
          return;
        }
        const cacheKeys = await caches.keys();
        const staleKeys = cacheKeys.filter(shouldDeleteCache);
        await Promise.all(staleKeys.map((cacheKey) => caches.delete(cacheKey)));
      } catch {
        // Ignore cache cleanup failures to avoid blocking app rendering.
      }
    };

    void unregisterServiceWorkers();
  }, []);

  return null;
}
