/**
 * Footer.test.tsx — Phase A5 step 1 sanity tests.
 *
 * Asserts via SSR markup (no DOM, no testing-library) — matches the
 * existing repo pattern (see auto-save-indicator.test.tsx).
 *
 * Drift between this file and `lib/ministry-contact.ts` is THE BUG these
 * tests catch — if a future PR changes the phone in one place but not
 * the other, this test fails loud.
 *
 * design-reproducibility/01-build-identity — the footer used to default
 * `buildDate`/`version` from `NEXT_PUBLIC_BUILD_DATE`/`NEXT_PUBLIC_APP_VERSION`,
 * which nothing in the repo ever set (grep confirms zero writers), so every
 * production render fell to the dict's `buildDateFallback` — the word
 * "current"/"ปัจจุบัน" — a placeholder dressed as a fact. An operator moving
 * servers had no way to tell a stale image from a fresh one by looking at the
 * page. The two tests below (interactive, via createRoot+act since this repo
 * ships no @testing-library/react — see dashboard-fetch-error.test.tsx) prove
 * the replacement: an honest "unknown build" label when the stamp is not yet
 * known, replaced by the real commit+date once `GET /api/webapp-version`
 * (build-info.ts) resolves.
 */

import { describe, expect, it, jest, afterEach } from '@jest/globals';
import type { ReactElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Footer } from '../Footer';
import { MINISTRY_CONTACT } from '@/lib/ministry-contact';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Footer (Phase A5 §4.2)', () => {
  it('renders the canonical ministry phone (verified from dtam.moph.go.th)', () => {
    expect(MINISTRY_CONTACT.phone).toBe('0-2591-7007');
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain(MINISTRY_CONTACT.phone);
  });

  it('renders the ministry email and address from the canonical module', () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain(MINISTRY_CONTACT.email);
    expect(html).toContain(MINISTRY_CONTACT.address);
  });

  it('uses tel:+66 and mailto: href schemes for click-to-call/email', () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="tel:+6625917007"');
    expect(html).toContain(`href="mailto:${MINISTRY_CONTACT.email}"`);
  });

  it('emits a <footer> landmark with role=contentinfo and aria-label', () => {
    const html = renderToStaticMarkup(<Footer />);
    // Some React versions strip the redundant role on <footer>; both forms acceptable.
    expect(html).toMatch(/<footer[^>]*aria-label=/);
    expect(html).toContain('<footer');
  });

  it('includes the required quick-link nav (a11y / privacy / terms / sitemap)', () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="/accessibility"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/sitemap.xml"');
  });

  it('renders the build-date label even when the env override is empty', () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('ปรับปรุงล่าสุด');
  });

  it('honours an explicit buildDate prop override', () => {
    const html = renderToStaticMarkup(<Footer buildDate="2026-04-28" />);
    expect(html).toContain('2026-04-28');
  });

  describe('build identity (design-reproducibility/01-build-identity)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    const originalFetch = global.fetch;

    afterEach(() => {
      if (root) {
        act(() => {
          root?.unmount();
        });
        root = null;
      }
      if (container) {
        container.remove();
        container = null;
      }
      global.fetch = originalFetch;
    });

    function mount(element: ReactElement) {
      container = document.createElement('div');
      document.body.appendChild(container);
      act(() => {
        root = createRoot(container!);
        root!.render(element);
      });
    }

    it('never shows the old "current"/"ปัจจุบัน" placeholder — an unfetched build shows an explicit unknown-build label instead', () => {
      global.fetch = jest.fn().mockReturnValue(new Promise(() => undefined)) as unknown as typeof fetch;
      mount(<Footer />);
      expect(container!.textContent).not.toContain('ปัจจุบัน');
      expect(container!.textContent).toContain('ไม่ทราบรุ่นบิลด์');
    });

    it('fetches the real build stamp from /api/webapp-version and replaces the unknown-build label once it resolves', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          revision: '93aeb959f0e4c2b8a7d6e5f4c3b2a190',
          builtAt: '2026-08-14T07:46:09Z',
        }),
      }) as unknown as typeof fetch;

      mount(<Footer />);
      await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
      await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/webapp-version');
      // Short SHA (7 chars) — full revision must not leak into the footer.
      expect(container!.textContent).toContain('93aeb95');
      expect(container!.textContent).not.toContain('93aeb959f0e4c2b8a7d6e5f4c3b2a190');
      expect(container!.textContent).toContain('2026-08-14T07:46:09Z');
      expect(container!.textContent).not.toContain('ไม่ทราบรุ่นบิลด์');
    });

    it('falls back to the honest unknown label, not the placeholder, when the fetch itself fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network outage')) as unknown as typeof fetch;

      mount(<Footer />);
      await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
      await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });

      expect(container!.textContent).not.toContain('ปัจจุบัน');
      expect(container!.textContent).toContain('ไม่ทราบรุ่นบิลด์');
    });

    it('an explicit buildDate prop is never overwritten by the fetched value', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ revision: 'deadbeef00000000', builtAt: '2099-01-01T00:00:00Z' }),
      }) as unknown as typeof fetch;

      mount(<Footer buildDate="2026-04-28" />);
      await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });

      expect(container!.textContent).toContain('2026-04-28');
      expect(container!.textContent).not.toContain('2099-01-01');
    });
  });
});
