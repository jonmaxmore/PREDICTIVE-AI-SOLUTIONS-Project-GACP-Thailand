/**
 * GovLayout.test.tsx — Phase A5 step 1 sanity tests.
 *
 * SSR-markup based (matches repo pattern in auto-save-indicator.test.tsx).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { GovLayout } from '../GovLayout';

describe('GovLayout (Phase A5 §4.1)', () => {
  // GovLayout used to render its own <SkipToContent />. The root layout
  // (src/app/layout.tsx) already renders one for every route, and in the App
  // Router the root layout always wraps GovLayout — so the second link was
  // unconditional, putting two identical "ข้ามไปยังเนื้อหาหลัก" entries in the
  // tab order on every GovLayout page. Measured on /accessibility: 2 skip
  // anchors before, 1 after; / and /help stayed at 1 throughout.
  //
  // GovLayout still owns the skip link's TARGET; the link itself is the root
  // layout's job.
  it('does not render its own skip-link — the root layout owns it', () => {
    const html = renderToStaticMarkup(
      <GovLayout>
        <p>page body</p>
      </GovLayout>,
    );
    expect(html).not.toContain('ข้ามไปยังเนื้อหาหลัก');
  });

  it('exposes a <main> landmark with id="main-content" and aria-label', () => {
    const html = renderToStaticMarkup(
      <GovLayout>
        <p>page body</p>
      </GovLayout>,
    );
    expect(html).toMatch(/<main[^>]*id="main-content"/);
    expect(html).toMatch(/<main[^>]*aria-label="เนื้อหาหลัก"/);
  });

  it('renders children inside <main>', () => {
    const html = renderToStaticMarkup(
      <GovLayout>
        <p>hello body</p>
      </GovLayout>,
    );
    expect(html).toContain('hello body');
  });

  it('always renders the persistent footer landmark', () => {
    const html = renderToStaticMarkup(
      <GovLayout>
        <p>page body</p>
      </GovLayout>,
    );
    expect(html).toContain('<footer');
  });

  it('chrome="minimal" applies the marketing wrapper padding on <main>', () => {
    const fullHtml = renderToStaticMarkup(
      <GovLayout chrome="full">
        <p>full</p>
      </GovLayout>,
    );
    const minimalHtml = renderToStaticMarkup(
      <GovLayout chrome="minimal">
        <p>minimal</p>
      </GovLayout>,
    );
    expect(fullHtml).not.toMatch(/<main[^>]*max-w-4xl/);
    expect(minimalHtml).toMatch(/<main[^>]*max-w-4xl/);
  });

  it('passes through buildDate override into the footer', () => {
    const html = renderToStaticMarkup(
      <GovLayout buildDate="2026-04-28">
        <p>body</p>
      </GovLayout>,
    );
    expect(html).toContain('2026-04-28');
  });
});
