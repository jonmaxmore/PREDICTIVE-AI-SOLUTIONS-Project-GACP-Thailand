/**
 * preview-document — BUG A fix.
 *
 * The /uploads/* mount ships `Content-Disposition: attachment` (deliberate PDPA
 * hardening: neutralises a document.referrer leak + cross-origin embed vector —
 * see apps/backend/middleware/uploads-security-headers.js). A top-level
 * `window.open('/uploads/...')` therefore turns a "preview" into a download /
 * blank tab.
 *
 * Instead we fetch the file as a BLOB (with credentials + Bearer when present),
 * wrap it in an object URL, and open THAT. A blob: URL renders inline in a new
 * tab AND leaks no real path, so the referrer/embed protections the security
 * team added stay intact — we do NOT touch the middleware.
 */

import { getStoredAccessToken } from '@/lib/services/auth-service-session';

/** Give the opened tab time to load the blob before the URL is revoked. */
const REVOKE_DELAY_MS = 60_000;

/**
 * Fetch a document by url and open it inline via a blob: object URL.
 *
 * @throws when the fetch fails (network) or returns a non-ok status, so the
 *   caller can surface a real error state instead of silently opening a
 *   broken/blank tab.
 */
export interface PreviewedDocument {
  /** blob: URL — safe to put in <img src> or <iframe src>; leaks no real path. */
  objectUrl: string;
  /** What the server said it is, so the viewer can pick <img> or <iframe>. */
  mime: string;
  /** Free the object URL. The viewer calls this when it closes. */
  revoke: () => void;
}

/**
 * Fetch a document as a blob and hand back an object URL for an IN-PAGE viewer.
 *
 * This is the shape T9's viewer modal needs and the one every new caller should use.
 * A subresource load (`<img src>`, `<iframe src>`) is exempt from the attachment
 * header — that is the note in uploads-security-headers.js — so the file renders
 * inside the page and the reader never receives a copy on their disk unless they ask.
 *
 * @throws when the fetch fails or returns a non-ok status, so the caller can show a
 *   real error instead of an empty viewer.
 */
export async function fetchDocumentForViewer(url: string): Promise<PreviewedDocument> {
  const headers: Record<string, string> = {};
  const token = getStoredAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { credentials: 'include', headers });
  if (!res.ok) {
    throw new Error(`Preview failed (${res.status})`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  return {
    objectUrl,
    mime: blob.type || res.headers.get('content-type') || '',
    revoke: () => URL.revokeObjectURL(objectUrl),
  };
}

/**
 * LEGACY: open the document in a new tab.
 *
 * Two call sites still reach for this and T15 removes them. New code uses
 * `fetchDocumentForViewer` with the viewer modal: a new tab is a worse answer for a
 * national-ID scan than a panel the reader closes, and it cannot show a filename or a
 * deliberate download button beside it.
 */
export async function openDocumentPreview(url: string): Promise<void> {
  const { objectUrl, revoke: revokeNow } = await fetchDocumentForViewer(url);
  void revokeNow;
  window.open(objectUrl, '_blank', 'noopener,noreferrer');

  // Revoke on a timer AND on unload so we don't leak the object URL, but not so
  // eagerly that the just-opened tab can't finish loading it.
  const revoke = () => URL.revokeObjectURL(objectUrl);
  setTimeout(revoke, REVOKE_DELAY_MS);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('unload', revoke, { once: true });
  }
}

export default openDocumentPreview;
