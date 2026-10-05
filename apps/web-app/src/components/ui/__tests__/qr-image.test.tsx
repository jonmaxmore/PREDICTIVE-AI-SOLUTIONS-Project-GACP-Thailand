/**
 * qr-image.test.tsx — fix-round 1 (review 6712f985), S2 hardening.
 *
 * `fallbackSrc` is only trusted as an `<img src>` when it is a genuine
 * `data:image/...` URI — a bare remote URL or garbage string must be
 * IGNORED (falls through to the empty/loading placeholder) rather than
 * handed to `<img src>` unchecked.
 *
 * `qrcode` is mocked here (unlike qr-image.decode.test.ts) specifically to
 * force the generation-failure branch so the fallback logic is reachable —
 * this file is about the fallback guard, not proving real QR generation.
 */
import * as React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('qrcode', () => {
    const fn = () => Promise.reject(new Error('generation failed (forced for this test)'));
    return {
        __esModule: true,
        default: { toDataURL: fn },
        toDataURL: fn,
    };
});

import { QrImage } from '../qr-image';

async function mount(el: React.ReactElement): Promise<{ container: HTMLDivElement; root: Root }> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: Root;
    await act(async () => {
        root = createRoot(container);
        root.render(el);
    });
    await act(async () => {
        await Promise.resolve();
    });
    return { container, root };
}

describe('QrImage — S2: fallbackSrc must be a data:image/ URI', () => {
    it('renders the fallback when it IS a real data:image/ URI', async () => {
        const { container, root } = await mount(
            <QrImage
                value="https://gacpth.com/verify/GACP-TH-2569-85B448"
                alt="alt text"
                fallbackSrc="data:image/png;base64,AAAA"
            />,
        );
        const img = container.querySelector('[data-testid="qr-image-fallback"]');
        expect(img).not.toBeNull();
        expect(img!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
        act(() => root.unmount());
        container.remove();
    });

    it('ignores a non-data-URI fallback (e.g. a bare remote URL) — falls to the empty placeholder, not <img src>', async () => {
        const { container, root } = await mount(
            <QrImage
                value="https://gacpth.com/verify/GACP-TH-2569-85B448"
                alt="alt text"
                fallbackSrc="https://not-a-data-uri.example/x.png"
            />,
        );
        expect(container.querySelector('[data-testid="qr-image-fallback"]')).toBeNull();
        expect(container.querySelector('[data-testid="qr-image-loading"]')).not.toBeNull();
        act(() => root.unmount());
        container.remove();
    });
});
