/**
 * BUG A — preview-document helper.
 *
 * The /uploads/* mount ships `Content-Disposition: attachment` (PDPA hardening
 * we MUST NOT weaken). A top-level `window.open('/uploads/...')` therefore
 * turns "เปิดไฟล์" into a download / blank tab. The fix fetches the file as a
 * BLOB (credentials + Bearer when a token exists), wraps it in an object URL,
 * and opens THAT — a blob: URL renders inline in a new tab and leaks no real
 * path, so the referrer/embed protections stay intact.
 *
 * These contracts pin the helper's behaviour:
 *   1. ok fetch  → creates an object URL from the blob + opens it (noopener).
 *   2. !ok fetch → throws (caller surfaces an error; never silently opens).
 *   3. a stored access token is attached as a Bearer header.
 *   4. no token → no Authorization header (still fetched with credentials).
 */

import { openDocumentPreview } from '../preview-document';

jest.mock('@/lib/services/auth-service-session', () => ({
  getStoredAccessToken: jest.fn(),
}));

import { getStoredAccessToken } from '@/lib/services/auth-service-session';

const mockGetToken = getStoredAccessToken as jest.Mock;

describe('openDocumentPreview (BUG A blob preview)', () => {
  const mockCreateObjectURL = jest.fn(() => 'blob:mock-object-url');
  const mockRevokeObjectURL = jest.fn();
  let mockOpen: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    mockCreateObjectURL.mockReturnValue('blob:mock-object-url');
    // jsdom has no URL.createObjectURL / window.open by default.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = mockCreateObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = mockRevokeObjectURL;
    mockOpen = jest.fn(() => ({}));
    (window as unknown as { open: unknown }).open = mockOpen;
  });

  it('ok → fetches the url as a blob and opens an object URL (noopener,noreferrer)', async () => {
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetToken.mockReturnValue(null);

    await openDocumentPreview('/uploads/application-drafts/x.pdf');

    // fetched with credentials so the auth cookie rides along
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('/uploads/application-drafts/x.pdf');
    expect((calledInit as RequestInit).credentials).toBe('include');

    // opened the BLOB url, not the raw /uploads path
    expect(mockCreateObjectURL).toHaveBeenCalledWith(blob);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith('blob:mock-object-url', '_blank', 'noopener,noreferrer');
    // raw /uploads path was NEVER handed to window.open
    expect(mockOpen).not.toHaveBeenCalledWith(
      expect.stringContaining('/uploads/'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('!ok → throws and never opens a tab', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 403, blob: () => Promise.resolve(new Blob()) });
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetToken.mockReturnValue(null);

    await expect(openDocumentPreview('/uploads/x.pdf')).rejects.toThrow();
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
  });

  it('attaches a Bearer header when a stored access token exists', async () => {
    const blob = new Blob(['x'], { type: 'application/pdf' });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetToken.mockReturnValue('tok-123');

    await openDocumentPreview('/uploads/x.pdf');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-123');
  });

  it('no token → no Authorization header', async () => {
    const blob = new Blob(['x'], { type: 'application/pdf' });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetToken.mockReturnValue(null);

    await openDocumentPreview('/uploads/x.pdf');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = (init.headers || {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
