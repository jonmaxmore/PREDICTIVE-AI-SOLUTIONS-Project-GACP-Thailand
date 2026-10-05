'use client';

/**
 * OfflineIndicator — X3-FIX-B M-5
 *
 * A small fixed-position pill that signals when the browser has lost
 * network connectivity. It is mounted globally in the root layout so
 * it reads on every HEALTH + PROVIDER + ADMIN surface (no per-page
 * wiring). Auto-hides when `navigator.onLine === true`.
 *
 * Accessibility:
 *   - `role="status" aria-live="polite"` so screen readers announce
 *     state flips without interrupting the user.
 *   - Bilingual text ("ออฟไลน์ / Offline") so the announcement works
 *     for both Thai and English readers.
 *   - WifiOff icon is decorative — marked `aria-hidden="true"` so the
 *     visible label carries the accessible name.
 *
 * Behavior:
 *   - Reads `navigator.onLine` on mount (defaults to `true` during SSR
 *     to avoid a flash of the indicator on first hydration).
 *   - Subscribes to `online` + `offline` events on `window` and tears
 *     them down on unmount.
 *
 * Note: the M-5 audit finding called for an indicator anywhere on the
 * inspect surface (the photo-retry flow expects network failure). This
 * is a baseline visual signal — full offline-first design (service
 * worker + offline-first queue) is deferred to L-10.
 */

import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function OfflineIndicator() {
  // Default to online during SSR / pre-mount so we never render the
  // pill until the client confirms the browser is offline. The check
  // runs in a useEffect (below) so the SSR + hydration markup stays
  // consistent.
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Initial sync — `navigator.onLine` is only meaningful on the
    // client. If the API is unavailable (e.g. very old jsdom) we
    // assume online so the indicator stays hidden.
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      setIsOnline(navigator.onLine);
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
      className="fixed bottom-4 right-4 z-[9998] flex items-center gap-2 rounded-full border border-rose-300 bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-rose-900/30"
    >
      <WifiOff size={16} aria-hidden="true" />
      <span>ออฟไลน์ / Offline</span>
    </div>
  );
}

export default OfflineIndicator;
