/**
 * The exact `qrcode` render options the platform uses for scannable codes.
 *
 * Lives in a plain module (NO 'use client') so it can be imported by BOTH
 * the client component <QrImage> and server components that pre-render a
 * data URL for SSR/no-JS/crawlers. Exporting it from the client module broke
 * the public verify page in a production build ("Attempted to call
 * qrRenderOptions() from the server but qrRenderOptions is on the client") —
 * found on preview.gacpth.com 2026-08-22, invisible under `next dev`.
 *
 * margin:2 keeps a real quiet zone around the modules (required for reliable
 * camera decode); errorCorrectionLevel:'H' means a partially obscured print
 * still scans. Anything that must reproduce byte-identical output (the
 * decode-proof test) imports this rather than retyping the options.
 */
export function qrRenderOptions(size: number) {
    return { margin: 2, width: size, errorCorrectionLevel: 'H' as const };
}
