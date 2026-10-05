/**
 * Shared PDF asset helpers — single source for the DTAM logo data URL and for
 * the locally-embedded Sarabun @font-face block.
 *
 * Phase 2 dedup: application-template-service, invoice-template-service, and
 * certificate-template-service each carried a byte-identical getLogoDataUrl()
 * (read templates/shared/gacpthai-logo.png → base64 data: URI, memoised). They
 * now all delegate here so the logo path / encoding lives in exactly one place.
 *
 * Fonts are vendored, not fetched (2026-07-25): every PDF template used to open with
 *   @import url('https://fonts.googleapis.com/css2?family=Sarabun…')
 * which made each government PDF render (certificate, tax invoice, receipt,
 * revenue receipt…) perform a server-side round trip to a US font CDN — no
 * document content left, but the DTAM production IP plus a real-time
 * issuance-volume signal did. Sarabun is now vendored under
 * apps/backend/assets/fonts/sarabun and embedded as base64 `data:` URIs, so
 * the renderer's sub-resource allowlist can be narrowed to `data:` +
 * `about:blank` (see pdf-generator.service.js).
 *
 * @module services/pdf/pdf-assets
 */

const path = require('path');
const fs = require('fs');

const SHARED_DIR = path.join(__dirname, 'templates', 'shared');
const LOGO_PATH = path.join(SHARED_DIR, 'gacpthai-logo.png');
// Commercial documents (ใบเสนอราคา/ใบวางบิล/ใบเสร็จ) are issued in the company's
// name, so they carry the COMPANY logo, not the ministry emblem (operator
// 2026-09-06). The real asset — บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด — landed
// 2026-09-11, replacing the ministry-logo copy 18b94183 committed as a
// non-breaking placeholder. company-logo-is-not-the-ministry-seal.test.js now
// fails if that placeholder ever comes back, because nothing else can see it:
// a copied seal reads as a valid PNG to every other check in the tree.
const COMPANY_LOGO_PATH = path.join(SHARED_DIR, 'company-logo.png');

// Vendored Sarabun (Cadson Demak, SIL OFL-1.1) — the woff2 subsets copied from
// @fontsource/sarabun. See assets/fonts/sarabun/README.md.
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts', 'sarabun');
// ฟอนต์อาลักษณ์สำหรับเอกสารพิธีการ (ใบรับรอง) — Srisakdi, หนึ่งใน 13 ฟอนต์แห่งชาติ (SIPA)
// วางเคียง Sarabun: ใช้เฉพาะชื่อเรื่อง/ชื่อผู้รับบนใบประกาศ ไม่ใช่ตัวเนื้อความ
// (operator 2026-09-07: ใบประกาศด้วยฟอนต์เนื้อความ "เหมือนงานเด็กประถม")
const SRISAKDI_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts', 'srisakdi');
// Anuphan — ตัวแทนที่ฝังได้ (OFL) ของ Sukhumvit Set ตาม canvas ดีไซน์ที่อนุมัติ
// (โครง Wizard กทล.1 — font stack ประกาศ 'Sukhumvit Set' นำ ซึ่งเป็นฟอนต์ Apple
// ฝังแจกจ่ายไม่ได้ · Anuphan คือตระกูลเดียวกัน: ไทยไร้หัวเชิงมนุษยนิยม)
const ANUPHAN_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts', 'anuphan');

// The faces the templates actually ask for: weights 400–800 upright plus a
// 400 italic (credit-note / debit-note / receipt / invoice / tax-invoice all
// set `font-style: italic` on note lines; certificate.html asked for 1,400).
// Two subsets per face — `thai` carries the Thai script the documents are
// written in, `latin` the ASCII numerals, certificate numbers and Latin plant
// names. Anything heavier than 800 (a few `font-weight: 900` rules) is
// synthesised by the renderer from 800, exactly as it was with the CDN.
const SARABUN_FACES = [
    { weight: 400, style: 'normal' },
    { weight: 500, style: 'normal' },
    { weight: 600, style: 'normal' },
    { weight: 700, style: 'normal' },
    { weight: 800, style: 'normal' },
    { weight: 400, style: 'italic' },
];
const SARABUN_SUBSETS = ['thai', 'latin'];

let _logoDataUrl = null;
let _companyLogoDataUrl = null;
let _sarabunFontFaceCss = null;
let _srisakdiFontFaceCss = null;
let _anuphanFontFaceCss = null;

/**
 * The DTAM/GACP logo as a base64 `data:image/png` URI, memoised after first read.
 * Used as the <img src> in every PDF template (the renderer's SSRF allowlist
 * permits data: URIs, so this is the canonical way to embed the logo).
 *
 * @returns {string}
 */
function getLogoDataUrl() {
    if (_logoDataUrl) { return _logoDataUrl; }
    const png = fs.readFileSync(LOGO_PATH);
    _logoDataUrl = `data:image/png;base64,${png.toString('base64')}`;
    return _logoDataUrl;
}

/**
 * The COMPANY logo for commercial documents. Reads company-logo.png; if the
 * file is unreadable it falls back to the ministry logo so a document never
 * renders a broken image. That fallback is a last resort, not a supply route:
 * it prints another legal entity's seal on the company's own bill, which is why
 * the guard test asserts this function returns the company file rather than
 * merely returning *something*.
 * @returns {string}
 */
function getCompanyLogoDataUrl() {
    if (_companyLogoDataUrl) { return _companyLogoDataUrl; }
    let png;
    try {
        png = fs.readFileSync(COMPANY_LOGO_PATH);
    } catch (_e) {
        return getLogoDataUrl();
    }
    _companyLogoDataUrl = `data:image/png;base64,${png.toString('base64')}`;
    return _companyLogoDataUrl;
}

/**
 * The full Sarabun `@font-face` block, every face inlined as a base64
 * `data:font/woff2` URI, memoised after the first build (~180 KB of CSS, built
 * once per process). Injected into every rendered document by
 * pdf-generator.service.js, which is why no template needs a font URL any more.
 *
 * `font-display: block` (the CDN used `swap`) — a PDF render has exactly one
 * paint and no user waiting on progressive text, and the bytes are already in
 * memory, so there is no swap window to optimise for.
 *
 * A missing/corrupt file is not fatal: the face is skipped and the templates
 * fall back to their declared 'Noto Sans Thai', Tahoma stack, so a PDF still
 * renders (degraded typography) rather than the whole request throwing.
 *
 * @returns {string} CSS containing only @font-face rules.
 */
function getSarabunFontFaceCss() {
    if (_sarabunFontFaceCss !== null) { return _sarabunFontFaceCss; }
    const blocks = [];
    for (const { weight, style } of SARABUN_FACES) {
        for (const subset of SARABUN_SUBSETS) {
            const file = `sarabun-${subset}-${weight}-${style === 'italic' ? 'italic' : 'normal'}.woff2`;
            let base64;
            try {
                base64 = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
            } catch (err) {
                console.warn(`[PDF] vendored Sarabun face missing, falling back for this face: ${file} (${err.code || err.message})`);
                continue;
            }
            blocks.push(
                '@font-face{'
                + "font-family:'Sarabun';"
                + `font-style:${style};`
                + `font-weight:${weight};`
                + 'font-display:block;'
                + `src:url(data:font/woff2;base64,${base64}) format('woff2');`
                + '}',
            );
        }
    }
    _sarabunFontFaceCss = blocks.join('\n');
    return _sarabunFontFaceCss;
}

/**
 * @font-face ของ Srisakdi (น้ำหนัก 400/700, ชุด thai + latin-700) สำหรับส่วนพิธีการ
 * ของใบรับรอง — ชื่อเรื่องและชื่อผู้รับ · แยกจากบล็อก Sarabun เพื่อให้เอกสารอื่น
 * ไม่ต้องแบก base64 ที่ไม่ได้ใช้ · ไฟล์หาย = ข้ามเงียบ แล้ว template ตกไปที่ Sarabun
 * ตาม fallback stack — ใบยังออก แค่ typography ลดชั้น
 *
 * @returns {string} CSS ที่มีแต่ @font-face
 */
function getSrisakdiFontFaceCss() {
    if (_srisakdiFontFaceCss !== null) { return _srisakdiFontFaceCss; }
    const blocks = [];
    for (const file of ['srisakdi-thai-400-normal.woff2', 'srisakdi-thai-700-normal.woff2', 'srisakdi-latin-700-normal.woff2']) {
        let base64;
        try {
            base64 = fs.readFileSync(path.join(SRISAKDI_DIR, file)).toString('base64');
        } catch (err) {
            console.warn(`[PDF] vendored Srisakdi face missing, falling back for this face: ${file} (${err.code || err.message})`);
            continue;
        }
        const weight = file.includes('-700-') ? 700 : 400;
        blocks.push(
            '@font-face{'
            + "font-family:'Srisakdi';"
            + 'font-style:normal;'
            + `font-weight:${weight};`
            + 'font-display:block;'
            + `src:url(data:font/woff2;base64,${base64}) format('woff2');`
            + '}',
        );
    }
    _srisakdiFontFaceCss = blocks.join('\n');
    return _srisakdiFontFaceCss;
}

/**
 * @font-face ของ Anuphan (400/500/600/700, thai + latin) — ฟอนต์ประจำ design canvas
 * ที่อนุมัติ ใช้กับเอกสารที่ประกาศ 'Anuphan' เอง (ใบรับรอง) · โครงเดียวกับ Srisakdi
 * @returns {string}
 */
function getAnuphanFontFaceCss() {
    if (_anuphanFontFaceCss !== null) { return _anuphanFontFaceCss; }
    const blocks = [];
    for (const weight of [400, 500, 600, 700]) {
        for (const subset of ['thai', 'latin']) {
            const file = `anuphan-${subset}-${weight}-normal.woff2`;
            let base64;
            try {
                base64 = fs.readFileSync(path.join(ANUPHAN_DIR, file)).toString('base64');
            } catch (err) {
                console.warn(`[PDF] vendored Anuphan face missing, falling back for this face: ${file} (${err.code || err.message})`);
                continue;
            }
            blocks.push(
                '@font-face{'
                + "font-family:'Anuphan';"
                + 'font-style:normal;'
                + `font-weight:${weight};`
                + 'font-display:block;'
                + `src:url(data:font/woff2;base64,${base64}) format('woff2');`
                + '}',
            );
        }
    }
    _anuphanFontFaceCss = blocks.join('\n');
    return _anuphanFontFaceCss;
}

module.exports = {
    getLogoDataUrl,
    getCompanyLogoDataUrl,
    getSarabunFontFaceCss,
    getSrisakdiFontFaceCss,
    getAnuphanFontFaceCss,
    SHARED_DIR,
    LOGO_PATH,
    FONT_DIR,
};
