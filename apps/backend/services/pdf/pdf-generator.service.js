const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const { getSarabunFontFaceCss, getSrisakdiFontFaceCss, getAnuphanFontFaceCss } = require('./pdf-assets');

// ── HTML entity escaping (XSS prevention) ─────────────────────────────────
const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  if (value === null || value === undefined) { return ''; }
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

// ── PDF sub-resource allowlist (SSRF guard, SEC-001) ──────────────────────
// page.setContent() renders HTML that interpolates attacker-influenced data
// (applicant plot names, GPS coordinates, farm addresses flow into the
// templates). Without a guard, an injected
//   <img src="http://169.254.169.254/latest/meta-data/">  or
//   <iframe src="file:///etc/passwd">
// would be fetched *server-side* by Chromium during rendering — SSRF against
// the cloud metadata endpoint / internal services, or local-file disclosure.
// We allow ONLY the resources legitimate templates actually need:
//   • data:  URIs       — the embedded DTAM logo, the embedded Sarabun faces
//                         (see pdf-assets.getSarabunFontFaceCss) and inline assets
//   • about:blank       — the base document setContent() renders into
// Every other URL — http(s) to ANY host, file:, ftp:, internal IPs — is
// aborted at the network layer, regardless of how it got into the markup.
//
// Fonts are vendored, not fetched (2026-07-25): a remote-font-host exception used to sit here
// (fonts.googleapis.com / fonts.gstatic.com) because all 14 templates @import-ed
// Sarabun from a US CDN on every render. Sarabun is now vendored locally under
// assets/fonts/sarabun and injected as data: URIs, so the allowlist collapses to
// data: + about:blank — no protocol/hostname check is reachable any more, and
// the renderer has no legitimate reason to open a socket at all.
function isPdfResourceAllowed(url) {
  if (typeof url !== 'string' || url.length === 0) { return false; }
  if (url === 'about:blank') { return true; }
  if (url.startsWith('data:')) { return true; }
  return false;
}

// ── Cold-start failure classification (F-PDF-COLD-START-TIMEOUT) ──────────
// evidence/phase0/FINDINGS.md:177-178: the first PDF render after a backend
// restart pays Puppeteer's browser-launch cost inline and can trip
// puppeteer's own 30s launch timeout (walk C15: attempt 1 = 503, attempts
// 2-4 succeeded once the browser was already warm). isColdStartError()
// tells the download route (certificates.js) which `getCertificatePdf`
// failures are worth ONE retry — the browser just needed to finish
// launching — versus genuine render/data errors (a missing certificate row,
// a template TypeError) that would fail identically on a second attempt and
// should surface immediately instead of doubling the caller's wait.
//
// Narrowed 2026-08-20 (review follow-up): a bare `message.includes('timeout')`
// matched too much — any unrelated "request timeout" bubbling up from a
// totally different subsystem (a DB pool, an outbound HTTP call) would have
// been (wrongly) retried, burning part of the route's total time budget on a
// failure retrying can never fix. Only match puppeteer's own real error
// shape, plus its launch-failure vocabulary specifically.
function isColdStartError(error) {
  if (!error) { return false; }
  // The real shape puppeteer throws for BOTH its own launch timeout and a
  // page navigation/setContent timeout: `new TimeoutError(...)` with
  // `name === 'TimeoutError'`. This is also the name the route's own
  // per-attempt deadline wrapper sets on its synthetic timeout
  // (certificates.js#withAttemptDeadline), so a request that got no
  // protocol-level signal in time still classifies here.
  if (error.name === 'TimeoutError') { return true; }
  const message = String(error.message || '');
  // e.g. "Failed to launch the browser process! spawn /usr/bin/chromium ENOENT"
  if (/failed to launch/i.test(message)) { return true; }
  // e.g. "Timed out after 30000 ms while trying to connect to the browser!"
  // — requires BOTH the "Timed out after Nms" phrasing AND explicit
  // browser/launch context, so an unrelated "Timed out after 1200 ms
  // waiting for the queue lock" style message does NOT match.
  if (/timed out after \d+\s*ms/i.test(message) && /\b(browser|launch)\b/i.test(message)) {
    return true;
  }
  return false;
}

// ── Local Sarabun injection ───────────────────────────────────────────────
// Every template declares `font-family: 'Sarabun', 'Noto Sans Thai', Tahoma`
// but none of them carries the face any more — the @import that used to fetch
// it from a foreign CDN was removed so no template depends on a remote host. Injecting the
// vendored @font-face block here, at the single choke point every PDF passes
// through, means:
//   • one copy of the CSS in the tree instead of 14 copies of ~180 KB of base64
//   • no template can silently regress to a remote font host
//   • services that build their HTML in JS (audit-report, car-report) and the
//     multi-page lot-label combiner are covered by the same code path.
// The block is inserted at the START of <head> so template rules (and their
// own @font-face, should one ever be added) still win on cascade order.
function injectSarabunFontFace(htmlContent) {
  let css = getSarabunFontFaceCss();
  // Srisakdi (อาลักษณ์) โหลดเฉพาะเมื่อเอกสารประกาศใช้เอง — ใบรับรองเท่านั้นวันนี้ —
  // เพื่อไม่ให้เอกสารการเงิน 14 ชนิดแบก base64 ~50KB ที่ไม่ได้ใช้
  if (/'Srisakdi'/.test(htmlContent)) {
    const srisakdi = getSrisakdiFontFaceCss();
    if (srisakdi) { css = `${srisakdi}\n${css}`; }
  }
  if (/'Anuphan'/.test(htmlContent)) {
    const anuphan = getAnuphanFontFaceCss();
    if (anuphan) { css = `${anuphan}\n${css}`; }
  }
  if (!css) { return htmlContent; }
  const styleTag = `<style data-gacp-font="sarabun-local">${css}</style>`;
  const headOpen = /<head\b[^>]*>/i.exec(htmlContent);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return htmlContent.slice(0, at) + styleTag + htmlContent.slice(at);
  }
  // Fragment / head-less HTML (no current caller, but generatePDF is public):
  // a leading <style> is still parsed into the implicit head by Chromium.
  return styleTag + htmlContent;
}

class PDFGeneratorService {
  constructor() {
    this.browser = null;
    this._templateCache = new Map();
    // F-PDF-COLD-START-TIMEOUT: in-flight launch lock. Without this, two
    // callers racing `initialize()` before the first `puppeteer.launch()`
    // resolves would both see `this.browser === null` and both launch a
    // browser — wasteful, and the loser's browser handle would leak. Every
    // caller that arrives while a launch is in flight (e.g. the boot-time
    // warm-up racing the first real download request) awaits the SAME
    // promise instead.
    this._launchPromise = null;
  }

  async initialize() {
    if (this.browser) { return this.browser; }
    if (!this._launchPromise) {
      // Honour PUPPETEER_EXECUTABLE_PATH when the env var is set (Docker
      // runner — system chromium at /usr/bin/chromium-browser). When unset
      // (local dev with puppeteer's bundled download), let puppeteer
      // resolve its own executable path.
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
      this._launchPromise = puppeteer.launch({
        headless: 'new',
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      }).then((browser) => {
        this.browser = browser;
        return browser;
      }).finally(() => {
        // Clear the lock whether launch succeeded or failed. On success
        // `this.browser` is already set (above) so the next caller takes
        // the fast `if (this.browser)` path; on failure the next caller
        // gets to retry the launch instead of being stuck forever.
        this._launchPromise = null;
      });
    }
    return this._launchPromise;
  }

  /**
   * F-PDF-COLD-START-TIMEOUT (evidence/phase0/FINDINGS.md:177-178): the
   * first certificate-PDF request after a backend restart pays the
   * Puppeteer browser-launch cost inline and can trip puppeteer's own 30s
   * launch timeout (walk C15: attempt 1 = 503, attempts 2-4 succeeded once
   * the browser was already warm). Call this once, fire-and-forget, right
   * after the server starts listening (see server.js's boot hook) so the
   * browser — and the setContent/font-injection/page.pdf() render path —
   * is already primed before the first real request arrives.
   *
   * Fail-soft by design: some deploy targets may have no usable Chromium
   * at all. warmUp() NEVER rejects — a failure here just means the first
   * real request pays the cold-start cost (the download route's bounded
   * retry absorbs one failed attempt; see certificates.js).
   *
   * Assumption (reviewer note, 2026-08-20): this only warms THIS process's
   * singleton `this.browser`. If `jobs/pdf-processor.js` is ever added,
   * `queue-service.js` offloads PDF generation to a separate Bull child
   * process that gets its OWN Puppeteer instance — this boot warm-up would
   * NOT cover it, and that worker would need its own equivalent warm-up.
   */
  async warmUp() {
    try {
      await this.initialize();
      // Exercise the actual render path once (not just the browser
      // process) so setContent + the injected Sarabun font-face + a real
      // page.pdf() call are all warm, not just the launch.
      await this.generatePDF('<!doctype html><html><body>warm-up</body></html>');
      console.log('[PDF] warm-up complete — browser + render path primed');
    } catch (err) {
      console.warn(
        '[PDF] warm-up failed (fail-soft — first real request will pay the cold-start cost):',
        err.message,
      );
    }
  }

  async generatePDF(htmlContent, options = {}) {
    const browser = await this.initialize();
    const page = await browser.newPage();

    try {
      // SEC-001: gate every sub-resource the renderer tries to fetch through
      // the allowlist. Injected <img>/<iframe>/<link> pointing at internal
      // hosts, metadata IPs or file:// are aborted before a connection opens,
      // so attacker-controlled template data cannot trigger server-side
      // requests. Legitimate templates only need data: URIs + the font CDN.
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (isPdfResourceAllowed(url)) {
          req.continue().catch(() => {});
          return;
        }
        console.warn('[PDF] blocked non-allowlisted resource during render:', url);
        req.abort().catch(() => {});
      });

      // `networkidle0` stays: it is what makes the render wait for the QR-code
      // and logo data: URIs to settle. With the font CDN gone there is no
      // remote round trip left to wait on, so this now resolves as soon as the
      // local resources are done — strictly faster than before, never slower.
      await page.setContent(injectSarabunFontFace(htmlContent), { waitUntil: 'networkidle0' });

      const pdfOptions = {
        format: 'A4',
        margin: {
          top: '25mm',
          right: '25mm',
          bottom: '25mm',
          left: '25mm',
        },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: options.headerTemplate || '<div></div>',
        footerTemplate:
          options.footerTemplate ||
          `
          <div style="font-size: 10px; text-align: center; width: 100%; padding: 5px;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>
        `,
        ...options,
      };

      // Puppeteer 21+ returns a Uint8Array from page.pdf(), not a Node
      // Buffer. Downstream callers do `res.send(buffer)` which Express
      // routes through `Buffer.isBuffer()` checks — for Uint8Array it
      // falls into the JSON-encoding branch, producing
      // `{"0":37,"1":80,"2":68,"3":70,...}` (the `%PDF` magic bytes
      // serialised as object keys, ~6× larger than the original PDF).
      // UAT 2026-05-03 caught this on /api/applications/:id/pdf — the
      // browser shows a JSON body with Content-Type: application/pdf,
      // unable to render. Wrap in Buffer.from() so every caller gets a
      // proper Node Buffer regardless of Puppeteer version.
      const pdfBuffer = await page.pdf(pdfOptions);
      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  async generateFromTemplate(templatePath, data, options = {}) {
    const templateContent = await fs.readFile(templatePath, 'utf-8');
    const htmlContent = this.replaceTemplateVariables(templateContent, data);
    return this.generatePDF(htmlContent, options);
  }

  /**
   * Replace {{KEY}} placeholders with values from data object.
   * Values are HTML-escaped by default to prevent XSS.
   * Keys ending with _HTML (e.g. {{ITEMS_ROWS_HTML}}) are inserted raw.
   * Keys containing _URL, _BG, _COLOR, _DISPLAY are NOT escaped (CSS/data values).
   */
  replaceTemplateVariables(template, data) {
    const RAW_SUFFIXES = ['_HTML', '_URL', '_ROWS', '_SECTION', '_LIST', '_BG', '_COLOR', '_DISPLAY'];
    const rendered = template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, keyPath) => {
      const value = keyPath.split('.').reduce((obj, key) => obj?.[key], data);
      if (value === undefined) { return match; }
      // Skip escaping for known-safe keys (HTML snippets, URLs, CSS values)
      const shouldEscapeValue = !RAW_SUFFIXES.some((suffix) => keyPath.endsWith(suffix));
      return shouldEscapeValue ? escapeHtml(value) : String(value);
    });
    // Render-time guard: warn (don't fail) if any {{PLACEHOLDER}} survived substitution.
    // This catches typos like {{Applicant_NAME}} vs {{APPLICANT_NAME}} (case-sensitive).
    const surviving = rendered.match(/\{\{\w+(?:\.\w+)*\}\}/g);
    if (surviving && surviving.length > 0) {
       
      console.warn('[PDF] surviving placeholders:', Array.from(new Set(surviving)));
    }
    return rendered;
  }

  /**
   * Read and cache a template file (templates never change at runtime).
   */
  readTemplateCached(templatePath) {
    if (this._templateCache.has(templatePath)) {
      return this._templateCache.get(templatePath);
    }
    const content = require('fs').readFileSync(templatePath, 'utf-8');
    this._templateCache.set(templatePath, content);
    return content;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

const instance = new PDFGeneratorService();

// Expose the pure helpers on the singleton so section builders can reuse the
// canonical escaper and tests can exercise the SSRF allowlist in isolation,
// without disturbing the existing instance API (generatePDF / replaceTemplateVariables / …).
instance.escapeHtml = escapeHtml;
instance.isPdfResourceAllowed = isPdfResourceAllowed;
instance.injectSarabunFontFace = injectSarabunFontFace;
instance.isColdStartError = isColdStartError;

// Graceful shutdown — close Puppeteer browser on process exit
process.on('SIGTERM', () => instance.close());
process.on('SIGINT', () => instance.close());

module.exports = instance;

