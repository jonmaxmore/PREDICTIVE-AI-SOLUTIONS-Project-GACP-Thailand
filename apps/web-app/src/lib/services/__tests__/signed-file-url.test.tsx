/**
 * W1-2 — signed download URLs on the client.
 *
 * The bug: a browser `<img src="/uploads/x.png">` cannot attach an
 * Authorization header, so a Bearer-only session (mobile app, an expired
 * `auth_token` cookie, a cross-site embed) got 401 for its OWN uploaded file.
 *
 * The rule this suite enforces: components render an uploaded file from a
 * SIGNED url obtained through ONE helper, and the resulting <img> request
 * carries no Authorization header at all.
 *
 * Rendering: createRoot + act per the repo idiom (no @testing-library
 * dependency in this workspace — see thai-id-checksum-feedback.test.tsx).
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

jest.mock('@/lib/api/api-client', () => ({
    apiClient: { post: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('@/lib/api/api-client') as {
    apiClient: { post: jest.Mock };
};

import { getSignedFileUrl, clearSignedFileUrlCache } from '../signed-file-url';
import { useSignedFileUrl } from '@/lib/hooks/use-signed-file-url';

const SIGNED = '/uploads/a.png?exp=9999999999&sub=abcd&sig=SIGNATURE';

function mintOk() {
    apiClient.post.mockResolvedValue({
        success: true,
        data: { url: SIGNED, expiresAt: new Date(Date.now() + 300_000).toISOString() },
    });
}

// React 18 concurrent act() needs this flag when rendering without
// @testing-library (which sets it for you).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
    apiClient.post.mockReset();
    clearSignedFileUrlCache();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
    container = null;
    root = null;
});

describe('getSignedFileUrl', () => {
    it('asks the backend to mint a URL for the requested object', async () => {
        mintOk();

        const url = await getSignedFileUrl('/uploads/a.png');

        expect(url).toBe(SIGNED);
        expect(apiClient.post).toHaveBeenCalledWith('/files/signed-url', { fileUrl: '/uploads/a.png' });
    });

    it('does not re-mint the same object twice while a mint is in flight', async () => {
        mintOk();

        const [a, b] = await Promise.all([
            getSignedFileUrl('/uploads/a.png'),
            getSignedFileUrl('/uploads/a.png'),
        ]);

        expect(a).toBe(SIGNED);
        expect(b).toBe(SIGNED);
        expect(apiClient.post).toHaveBeenCalledTimes(1);
    });

    it('throws with a Thai reason the caller can show when the mint is refused', async () => {
        apiClient.post.mockResolvedValue({ success: false, status: 404, code: 'NOT_FOUND' });

        await expect(getSignedFileUrl('/uploads/a.png')).rejects.toThrow(/ไม่พบไฟล์|ไม่มีสิทธิ์/);
    });

    it('passes a non-/uploads url straight through without a mint', async () => {
        const url = await getSignedFileUrl('https://cdn.example/x.png');
        expect(url).toBe('https://cdn.example/x.png');
        expect(apiClient.post).not.toHaveBeenCalled();
    });
});

function Avatar({ src }: { src: string }) {
    const { url, error } = useSignedFileUrl(src);
    if (error) {
        return <p role="alert">{error}</p>;
    }
    if (!url) {
        return <p>กำลังเปิดไฟล์</p>;
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="รูปโปรไฟล์" data-testid="uploaded-image" />;
}

async function renderAvatar(src: string) {
    await act(async () => {
        root!.render(<Avatar src={src} />);
    });
    // let the mint promise settle
    await act(async () => { await Promise.resolve(); });
}

describe('useSignedFileUrl — an uploaded image renders WITHOUT an Authorization header', () => {
    it('renders the <img> from the signed url the backend minted', async () => {
        mintOk();
        await renderAvatar('/uploads/a.png');

        const img = container!.querySelector('[data-testid="uploaded-image"]') as HTMLImageElement | null;
        expect(img).not.toBeNull();
        expect(img!.getAttribute('src')).toBe(SIGNED);
        // The whole point: nothing on the element can carry a bearer token, and
        // the signed url is what makes that survivable.
        expect(img!.outerHTML).not.toMatch(/authorization|bearer/i);
        expect(img!.getAttribute('src')).toContain('sig=');
    });

    it('shows a Thai failure state that names the cause and the next action', async () => {
        apiClient.post.mockResolvedValue({ success: false, status: 404, code: 'NOT_FOUND' });
        await renderAvatar('/uploads/a.png');

        const alert = container!.querySelector('[role="alert"]');
        expect(alert).not.toBeNull();
        const text = alert!.textContent || '';
        expect(text).toMatch(/ไม่พบไฟล์|ไม่มีสิทธิ์/);
        expect(text).not.toMatch(/ขออภัย/);
        expect(text).not.toContain('—');
    });

    it('renders nothing and mints nothing for an empty source', async () => {
        await renderAvatar('');
        expect(apiClient.post).not.toHaveBeenCalled();
    });
});
