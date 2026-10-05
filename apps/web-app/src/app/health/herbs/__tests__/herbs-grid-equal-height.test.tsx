/**
 * A1 (design-cleanup-2026-08-21) — /health/herbs grid cards must stretch
 * to equal height.
 *
 * Same defect class the operator caught on the farmer home tile grid
 * (fixed there by adding `h-full` to both the Card and its Link wrapper —
 * see components/navigation/nav-tile.tsx and its equal-height test). Here
 * the herb list renders a 2-column grid of `<Link><Card>...</Card></Link>`
 * rows; before this fix neither level carried `h-full`, so a short herb
 * card next to a tall one (long description / controlled-substance badge)
 * would not stretch to match its row.
 */
import * as React from 'react';
import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
  apiClient: { get: (url: string) => mockApiGet(url) },
  api: { get: (url: string) => mockApiGet(url) },
}));

import ClientView from '../client-view';

describe('[A1] /health/herbs — grid cards stretch to equal height', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

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
      root!.render(<ClientView />);
    });
  }

  it('Link wrapper carries h-full + no-underline, and the Card inside it carries h-full', async () => {
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: [
        { code: 'A', nameTH: 'ขมิ้นชัน', isControlled: false, scientificName: 'Curcuma longa', entryCount: 3 },
        { code: 'B', nameTH: 'กระชายดำ', isControlled: true, scientificName: 'Kaempferia parviflora', entryCount: 1 },
      ],
    });
    mount();
    await act(async () => {
      await Promise.resolve();
    });

    const link = container!.querySelector('a[href="/health/herbs/A"]');
    expect(link).not.toBeNull();
    expect(link!.className).toContain('h-full');
    expect(link!.className).toContain('no-underline');

    const card = container!.querySelector('a[href="/health/herbs/A"] > div');
    expect(card).not.toBeNull();
    expect(card!.className).toContain('h-full');
  });
});
