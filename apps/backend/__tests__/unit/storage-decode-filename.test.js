/**
 * decodeMultipartFilename — fixes the mojibake document names (2026-06-25).
 *
 * multer/busboy decodes multipart `filename` params as latin1 by default, so an
 * uploaded Thai (UTF-8) filename arrives as mojibake (e.g. "เอกสาร.pdf" → garbled).
 * The /draft-documents handler stored that raw `file.originalname`, and the FE
 * shows it back → the applicant saw "à_Ðà_±à³Ðà_§.pdf" on the preview page.
 *
 * The helper re-interprets the latin1 bytes as UTF-8 — but only when it is safe:
 * a string that already contains real Unicode (char > U+00FF) is left untouched
 * (never double-decoded), and a decode that produces U+FFFD is rejected.
 */
const { decodeMultipartFilename } = require('../../services/storage-service');

// Simulate what busboy(latin1) produces for a UTF-8 filename.
const asBusboyLatin1 = (utf8Name) => Buffer.from(utf8Name, 'utf8').toString('latin1');

describe('decodeMultipartFilename', () => {
  it('recovers a Thai filename mangled by latin1 multipart decoding', () => {
    expect(decodeMultipartFilename(asBusboyLatin1('เอกสาร.pdf'))).toBe('เอกสาร.pdf');
    expect(decodeMultipartFilename(asBusboyLatin1('สำเนาบัตรประชาชน.pdf'))).toBe('สำเนาบัตรประชาชน.pdf');
  });

  it('leaves a pure-ASCII filename unchanged', () => {
    expect(decodeMultipartFilename('invoice-2026.pdf')).toBe('invoice-2026.pdf');
  });

  it('does NOT double-decode a name that already holds real Unicode', () => {
    // chars > U+00FF → already-correct Thai; must be returned verbatim.
    expect(decodeMultipartFilename('ตั๋ว.pdf')).toBe('ตั๋ว.pdf');
  });

  it('is null-safe and empty-safe', () => {
    expect(decodeMultipartFilename('')).toBe('');
    expect(decodeMultipartFilename(null)).toBe('');
    expect(decodeMultipartFilename(undefined)).toBe('');
  });
});
