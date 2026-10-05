/**
 * BUG B (FE) — the health /documents/[id] viewer must NOT fabricate a document.
 *
 * Before: on a 404 the client-view fell back to hardcoded mock metadata
 * ("เอกสารประกอบคำขอ.pdf", app_12345, url "/api/documents/"+id) and iframed a
 * 404 URL. Now: real route → mapDocumentResponse; on error → real error state;
 * render via a blob object URL (BUG A helper class), never <iframe src=fileUrl>.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { mapDocumentResponse } from '../document-view';

describe('mapDocumentResponse (no fabricated document)', () => {
  it('maps a real API payload to the display shape', () => {
    const v = mapDocumentResponse({
      id: 'doc-1',
      fileName: 'sop.pdf',
      fileUrl: '/uploads/application-drafts/sop.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      applicationId: 'app-1',
      uploadedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(v).toMatchObject({
      id: 'doc-1',
      name: 'sop.pdf',
      fileUrl: '/uploads/application-drafts/sop.pdf',
      mimeType: 'application/pdf',
      applicationId: 'app-1',
    });
  });

  it('returns null (→ error state) when there is no fileUrl — never fabricates', () => {
    expect(mapDocumentResponse(null)).toBeNull();
    expect(mapDocumentResponse(undefined)).toBeNull();
    expect(mapDocumentResponse({ id: 'x', fileName: 'x.pdf', fileUrl: null })).toBeNull();
  });

  it('infers mime from the url extension when missing', () => {
    expect(mapDocumentResponse({ id: 'x', fileName: 'x.pdf', fileUrl: '/uploads/x.pdf' })?.mimeType).toBe('application/pdf');
    expect(mapDocumentResponse({ id: 'y', fileName: 'y.jpg', fileUrl: '/uploads/y.jpg' })?.mimeType).toBe('image/*');
  });
});

describe('client-view source-pin (BUG B fix)', () => {
  const src = readFileSync(join(__dirname, '..', 'client-view.tsx'), 'utf8');

  it('does NOT contain the hardcoded mock metadata fallback', () => {
    expect(src).not.toContain('app_12345');
    expect(src).not.toContain('เอกสารประกอบคำขอ.pdf');
  });

  it('uses mapDocumentResponse (real mapping, not a fabricated object)', () => {
    expect(src).toMatch(/mapDocumentResponse/);
  });

  it('renders via a blob object URL, not a raw <iframe src=document.url>/api url', () => {
    // no iframe/img pointed straight at the /api/documents path or the raw fileUrl
    expect(src).not.toMatch(/src=\{["'`]?\/api\/documents/);
    expect(src).toMatch(/createObjectURL|getBlob/);
  });
});
