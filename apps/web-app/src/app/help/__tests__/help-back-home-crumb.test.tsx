/**
 * /help crumb — B-NAV item 2, W10.
 *
 * /help is reachable from every role and had no way back at all. The
 * crumb must point at the CALLER's own role home, not a hardcoded one —
 * derived from the session the same way DashboardLayout's slim-bar logo
 * derives its own href.
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGetUser = jest.fn();
jest.mock('@/lib/services/auth-service', () => ({
  AuthService: { getUser: (...args: unknown[]) => mockGetUser(...args) },
}));

import { HelpBackHomeCrumb } from '../help-back-home-crumb';

describe('HelpBackHomeCrumb', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
  });

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
  });

  function mount() {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container!);
      root!.render(<HelpBackHomeCrumb />);
    });
  }

  function homeLink(): HTMLAnchorElement | undefined {
    return Array.from(container!.querySelectorAll('a')).find((a) =>
      (a.textContent ?? '').includes('หน้าหลัก'),
    ) as HTMLAnchorElement | undefined;
  }

  it('a farmer session gets /health/home', () => {
    mockGetUser.mockReturnValue({ role: 'health' });
    mount();
    act(() => {}); // flush effect
    expect(homeLink()?.getAttribute('href')).toBe('/health/home');
    expect(container!.textContent).toContain('ช่วยเหลือ');
  });

  it('an auditor (officer) session gets /provider/home, not /health/home', () => {
    mockGetUser.mockReturnValue({ role: 'field_inspector' });
    mount();
    act(() => {});
    expect(homeLink()?.getAttribute('href')).toBe('/provider/home');
  });

  it('an admin session gets /provider/home too (any non-health role -> provider portal)', () => {
    mockGetUser.mockReturnValue({ role: 'system_admin_dtam' });
    mount();
    act(() => {});
    expect(homeLink()?.getAttribute('href')).toBe('/provider/home');
  });

  it('no session (anonymous visitor) falls back to the public landing "/", not a broken portal link', () => {
    mockGetUser.mockReturnValue(null);
    mount();
    act(() => {});
    expect(homeLink()?.getAttribute('href')).toBe('/');
  });
});
