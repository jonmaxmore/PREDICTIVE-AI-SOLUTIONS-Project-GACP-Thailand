/**
 * document-view — pure view-model for the health /documents/[id] viewer (BUG B).
 *
 * The route's client-view.tsx used to fall back to HARDCODED mock metadata when
 * GET /documents/:id 404'd (a false-green landmine). The real route now exists
 * (owner-scoped); this module maps its response to the display shape and pins
 * the "no fabricated document" contract.
 */

/** Raw shape returned by GET /api/documents/:id → data. */
export interface DocumentApiData {
  id: string;
  fileName: string | null;
  fileUrl: string | null;
  documentType?: string | null;
  mimeType?: string | null;
  size?: number | null;
  applicationId?: string | null;
  applicationNumber?: string | null;
  uploadedAt?: string | null;
}

/** Normalised shape the viewer renders. */
export interface DocumentView {
  id: string;
  name: string;
  fileUrl: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  applicationId: string;
}

/**
 * Map the API payload to the viewer's display shape. Returns null when the
 * payload can't yield a usable document (no fileUrl) — the caller then shows a
 * real error state, NEVER a fabricated document.
 */
export function mapDocumentResponse(data: DocumentApiData | null | undefined): DocumentView | null {
  if (!data || !data.fileUrl) { return null; }
  return {
    id: data.id,
    name: data.fileName || 'เอกสาร',
    fileUrl: data.fileUrl,
    mimeType: data.mimeType || inferMimeFromUrl(data.fileUrl),
    size: typeof data.size === 'number' ? data.size : 0,
    uploadedAt: data.uploadedAt || '',
    applicationId: data.applicationId || '',
  };
}

function inferMimeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith('.pdf')) { return 'application/pdf'; }
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) { return 'image/*'; }
  return 'application/octet-stream';
}
