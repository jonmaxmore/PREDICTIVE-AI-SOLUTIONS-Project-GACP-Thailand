/**
 * BUG A source-pin: both uploader components must preview via the blob helper
 * `openDocumentPreview`, NOT a raw `window.open(url)` on the /uploads path (that
 * downloads because of Content-Disposition:attachment). This pins the fix so a
 * future edit can't silently regress back to window.open.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const COMPONENTS = [
  'document-uploader.tsx',
  'inline-document-upload.tsx',
];

describe('BUG A — uploaders preview via openDocumentPreview (not window.open)', () => {
  for (const file of COMPONENTS) {
    const src = readFileSync(join(__dirname, '..', file), 'utf8');

    it(`${file} imports and calls openDocumentPreview`, () => {
      expect(src).toMatch(/openDocumentPreview/);
      expect(src).toMatch(/from ['"]@\/lib\/services\/preview-document['"]/);
    });

    it(`${file} does NOT window.open the raw file url for preview`, () => {
      // No window.open of a persisted url / value (the pre-fix bug).
      expect(src).not.toMatch(/window\.open\(\s*persistedUrl/);
      expect(src).not.toMatch(/window\.open\(\s*value\b/);
    });
  }
});
