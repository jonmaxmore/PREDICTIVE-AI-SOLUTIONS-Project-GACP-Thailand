/**
 * checkout-page-flag-guard.test.tsx — P0-4 route-level flag guard for
 * /health/payments/checkout.
 *
 * Before this pin the route was reachable by typing the URL (or by the
 * browser back button) even with NEXT_PUBLIC_CHECKOUT_UI_ENABLED off:
 * page.tsx exported metadata and rendered <ClientView /> unconditionally,
 * while isCheckoutUiEnabled() only gated the ENTRY LINK on
 * ../../client-view.tsx. Online payment is not open yet — the real flow is
 * bank transfer + slip upload — so a page titled "ชำระเงินออนไลน์" must not
 * be openable at all while the flag is off.
 *
 * What is pinned here:
 *   1. flag off (unset)          → no checkout markup; the route 404s.
 *   2. flag on ('true')          → the page still renders exactly as
 *                                  before (negative control: the guard
 *                                  must not break the enabled path).
 *   3. non-exact values          → 'TRUE' / ' true' / '1' / 'false' / ''
 *                                  all count as OFF, matching the
 *                                  fail-closed contract documented at
 *                                  src/lib/config/checkout-mode.ts:38-44.
 *
 * Strategy notes:
 *   - The flag is read through the real isCheckoutUiEnabled() (no module
 *     mock) so this test fails if anyone ever forks the env read into a
 *     second place (Law 3.6). Tests drive process.env directly because
 *     that function reads it at call time.
 *   - The REAL next/navigation is used, so the guard is proven against the
 *     framework's actual notFound() rather than against a stub. It has to
 *     be restored explicitly: jest.setup.tsx:14-27 replaces the whole
 *     module globally with a router/pathname/searchParams triple that has
 *     no notFound and no redirect, so without the requireActual spread
 *     below the guard would blow up with "notFound is not a function".
 *     The expected digest is derived from the framework at runtime
 *     (nextNotFoundDigest()) instead of being copied into this file as a
 *     literal, so a Next upgrade cannot make this test pass for the wrong
 *     reason.
 *   - ClientView is mocked to a marker string: this test is about
 *     reachability, and the real client view needs the whole
 *     useSearchParams/checkout-service fan-out that
 *     ./checkout-states.test.tsx already covers.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { notFound } from 'next/navigation';

// `mock` prefix so the jest.mock hoist keeps the reference legal; the
// arrow body below only reads it at render time, long after init.
const MOCK_CHECKOUT_VIEW_MARKER = 'CHECKOUT_CLIENT_VIEW_MARKER';

// Undo the global next/navigation stub from jest.setup.tsx:14-27 for this
// file only — the guard under test needs the real notFound().
jest.mock('next/navigation', () => {
  const actual = jest.requireActual('next/navigation') as Record<string, unknown>;
  return { ...actual };
});

jest.mock('../client-view', () => ({
  __esModule: true,
  default: () => MOCK_CHECKOUT_VIEW_MARKER,
}));

import Page from '../page';

const FLAG = 'NEXT_PUBLIC_CHECKOUT_UI_ENABLED';

/**
 * Ask Next itself what a notFound() rejection looks like, so the assertion
 * below compares against the framework's own value rather than a literal
 * pasted into this file.
 */
function nextNotFoundDigest(): string {
  try {
    notFound();
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest !== 'string' || digest.length === 0) {
      throw new Error('next/navigation notFound() threw without a string digest');
    }
    return digest;
  }
  throw new Error('next/navigation notFound() did not throw');
}

/** Render the route the way Next would, returning the HTML it produced. */
function renderRoute(): string {
  return renderToStaticMarkup(React.createElement(Page));
}

/** Render and classify: either markup came back, or the route 404'd. */
function renderOutcome(): { kind: 'rendered'; html: string } | { kind: 'not-found' } {
  try {
    return { kind: 'rendered', html: renderRoute() };
  } catch (err) {
    if ((err as { digest?: unknown }).digest === nextNotFoundDigest()) {
      return { kind: 'not-found' };
    }
    throw err;
  }
}

describe('/health/payments/checkout route guard (P0-4)', () => {
  const originalFlag = process.env[FLAG];

  beforeEach(() => {
    delete process.env[FLAG];
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env[FLAG];
    } else {
      process.env[FLAG] = originalFlag;
    }
  });

  it('flag unset (fail-closed default): the route 404s and renders no checkout markup', () => {
    const outcome = renderOutcome();

    expect(outcome.kind).toBe('not-found');
  });

  it('flag on: the page renders unchanged — main wrapper plus the client view', () => {
    process.env[FLAG] = 'true';

    const outcome = renderOutcome();

    expect(outcome.kind).toBe('rendered');
    const html = outcome.kind === 'rendered' ? outcome.html : '';
    expect(html).toContain(MOCK_CHECKOUT_VIEW_MARKER);
    expect(html).toContain('<main');
  });

  it.each(['TRUE', 'True', ' true', 'true ', '1', 'yes', 'false', ''])(
    'flag set to %p is not the exact string true: the route 404s',
    (value) => {
      process.env[FLAG] = value;

      const outcome = renderOutcome();

      expect(outcome.kind).toBe('not-found');
    },
  );

  it('flag on then off within one process: the guard re-reads the flag every request', () => {
    process.env[FLAG] = 'true';
    expect(renderOutcome().kind).toBe('rendered');

    process.env[FLAG] = 'false';
    expect(renderOutcome().kind).toBe('not-found');
  });
});
