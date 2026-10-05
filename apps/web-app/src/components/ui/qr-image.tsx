'use client';

/**
 * QrImage — the ONE real, scannable QR renderer for the app.
 *
 * W3 (real-qr-codes, 2026-08-22): several surfaces showed a decorative
 * lucide `<QrCode>` icon (or a literal "[QR Code]" placeholder) where a
 * user would reasonably expect an actual scannable code — a public verify
 * page, a "here is your certificate's QR" dialog. That is a fake QR: it
 * looks like something a phone can scan but is not. This component is the
 * single client-side rendering path so no page has to fork a second one.
 *
 * Approach lifted from the cert-detail page (Iter 23,
 * `app/health/certificates/[id]/client-view.tsx`): render client-side from
 * `value` via the `qrcode` package so the code always reflects the CURRENT
 * verify URL. A backend-supplied QR blob is never trusted as the primary
 * source — it can go stale (e.g. after the verify-base env var changes) —
 * so `fallbackSrc` is only used if client-side generation itself errors.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

import { qrRenderOptions } from '@/lib/qr/qr-render-options';
// Re-exported for existing importers; the definition lives in a server-safe
// module so server components can call it during SSR pre-render.
export { qrRenderOptions };

const LOADING_BASE_CLASSES =
    'flex items-center justify-center rounded-lg bg-muted text-center text-xs text-muted-foreground';

export interface QrImageProps {
    /** The exact string the code encodes — a full, absolute URL. */
    value: string;
    /** Alt text — always describe what scanning the code verifies. */
    alt: string;
    /**
     * Square size in pixels. Default 176 — comfortably above the ~160px
     * floor for a phone camera to focus and decode reliably at arm's length.
     */
    size?: number;
    className?: string;
    /**
     * Backend-supplied data URL, used ONLY if client-side generation fails.
     * Must be a `data:image/...` URI (S2 hardening, review 6712f985) — any
     * other value (a bare remote URL, garbage string, ...) is ignored rather
     * than handed to an `<img src>` unchecked.
     */
    fallbackSrc?: string | null;
    /**
     * A data URL already generated server-side for THIS `value` (e.g. the
     * verify page calling `QRCode.toDataURL` during SSR with the same
     * `qrRenderOptions`). When set, the real code is what SSR/first paint
     * shows immediately — no blank box while the client effect catches up,
     * and no-JS/crawler requests still see a real, scannable code.
     */
    initialDataUrl?: string | null;
}

export function QrImage({
    value,
    alt,
    size = 176,
    className,
    fallbackSrc = null,
    initialDataUrl = null,
}: QrImageProps) {
    const [dataUrl, setDataUrl] = useState<string | null>(initialDataUrl);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        // Already have a real code for this exact value (server pre-render) —
        // nothing to (re)generate client-side.
        if (initialDataUrl) return;
        setDataUrl(null);
        setFailed(false);
        if (!value) return;
        let cancelled = false;
        void QRCode.toDataURL(value, qrRenderOptions(size))
            .then((url) => {
                if (!cancelled) setDataUrl(url);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [value, size, initialDataUrl]);

    if (dataUrl) {
        return (
            // eslint-disable-next-line @next/next/no-img-element -- data URL, not a static asset
            <img
                src={dataUrl}
                alt={alt}
                width={size}
                height={size}
                className={className}
                data-testid="qr-image"
            />
        );
    }

    if (failed && fallbackSrc && fallbackSrc.startsWith('data:image/')) {
        return (
            // eslint-disable-next-line @next/next/no-img-element -- backend-supplied blob, last resort only
            <img
                src={fallbackSrc}
                alt={alt}
                width={size}
                height={size}
                className={className}
                data-testid="qr-image-fallback"
            />
        );
    }

    // Loading (or no value yet) — a neutral placeholder, never a decorative
    // icon that could be mistaken for a real, scannable code.
    return (
        <div
            className={[LOADING_BASE_CLASSES, className].filter(Boolean).join(' ')}
            style={{ width: size, height: size }}
            role="img"
            aria-label={alt}
            data-testid="qr-image-loading"
        />
    );
}

export default QrImage;
