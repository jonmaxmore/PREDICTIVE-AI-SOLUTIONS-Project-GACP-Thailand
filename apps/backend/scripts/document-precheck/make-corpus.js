#!/usr/bin/env node
'use strict';

/**
 * Task 9 (document pre-check): renders the synthetic accuracy corpus — Thai
 * documents for the 7 in-scope slots, in the variants the accuracy report
 * (`accuracy-report.js`) scores against the human-set truth in
 * `__tests__/fixtures/document-precheck/labels.json`.
 *
 * Every name, number and address below is invented. The 13-digit ids are
 * obviously-patterned test numbers (1234567890…, 3111122222…, 0999911111…)
 * that only need to pass the Mod-11 checksum — `assertValidId` refuses to
 * render one that does not, so an "id mismatch" can never degrade into an
 * "id with a bad checksum" (which the rule ignores rather than flags).
 *
 * Renderers (no new dependency — pdf-lib is not installed; same tools as
 * `__tests__/unit/document-precheck/extract.test.js`):
 *  - `text-pdf`  : pdfkit + the bundled Sarabun font, a real text layer.
 *  - `scan-pdf`  : the page rendered to PNG (Sarabun, rasterised by pdf.js), then
 *                  embedded as the only object of a PDF page — a scanned PDF.
 *  - `scan-png`  : the same PNG, optionally blurred or rotated, uploaded as
 *                  an image (what a phone photo/scan upload looks like).
 *
 * Deterministic: no randomness anywhere, so re-running reproduces the same
 * documents (pdfkit's CreationDate is pinned too). The corpus is committed
 * (well under 5 MB); this file is how it was made and how to remake it:
 *
 *     node scripts/document-precheck/make-corpus.js            # from apps/backend
 *
 * @see apps/backend/scripts/document-precheck/accuracy-report.js
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { isThaiIdChecksumValid } = require('@gacp/validation/thai-id-checksum');

const BACKEND_DIR = path.join(__dirname, '..', '..');
const FONT_PATH = path.join(BACKEND_DIR, '..', 'mobile-app', 'assets', 'fonts', 'Sarabun-Regular.ttf');
const DEFAULT_OUT_DIR = path.join(BACKEND_DIR, '__tests__', 'fixtures', 'document-precheck', 'corpus');

/** Pinned so a regenerated text-layer PDF is byte-identical to the committed one. */
const FIXED_PDF_DATE = new Date('2026-09-27T00:00:00Z');

const PAGE_WIDTH_PX = 1240;
const LINE_HEIGHT_PX = 60;
const FONT_SIZE_PX = 34;
const MARGIN_PX = 60;
/** pdf.js raster scale: page points x 2 = pixels (a 150-dpi-ish scan). */
const RASTER_SCALE = 2;

/**
 * Blur levels (sharp gaussian sigma, on a ~34 px text height), chosen by
 * looking at the rendered pages, not by what OCR makes of them:
 *  - LEGIBLE: soft but every word readable by a person -> truth PASS.
 *  - HEAVY: numbers still readable, Thai words not reliably -> truth UNREADABLE.
 *  - ILLEGIBLE: nothing readable -> truth UNREADABLE.
 */
const LEGIBLE_BLUR_SIGMA = 3.5;
const HEAVY_BLUR_SIGMA = 5;
const ILLEGIBLE_BLUR_SIGMA = 9;
const ROTATION_DEGREES = 3;

function assertValidId(id) {
    if (!isThaiIdChecksumValid(id)) {
        throw new Error(`make-corpus: ${id} is not checksum-valid — every corpus id must be`);
    }
    return id;
}

/** 1-4-5-2-1, the printed grouping on Thai ID cards / juristic registration numbers. */
function groupId(id) {
    assertValidId(id);
    return `${id[0]} ${id.slice(1, 5)} ${id.slice(5, 10)} ${id.slice(10, 12)} ${id[12]}`;
}

// ---------------------------------------------------------------------------
// Document templates — one per document type. Each takes the data printed on
// the page and returns its lines. Content is invented but shaped like the real
// document (title, number, holder, place, date).
// ---------------------------------------------------------------------------

const TEMPLATES = {
    land_deed: (d) => [
        'โฉนดที่ดิน',
        'เลขที่ 24518   เล่ม 246   หน้า 18',
        'ตำบลแม่แรม   อำเภอแม่ริม   จังหวัดเชียงใหม่',
        `ผู้ถือกรรมสิทธิ์   ${d.holder}`,
        'เนื้อที่ 5 ไร่ 2 งาน 30 ตารางวา',
        'ออกให้ ณ วันที่ 10 มกราคม พ.ศ. 2560',
        'ลงชื่อ ................................ เจ้าพนักงานที่ดิน',
    ],
    land_lease: (d) => [
        'สัญญาเช่าที่ดิน',
        'ทำที่ อำเภอสันทราย จังหวัดเชียงใหม่',
        'วันที่ 1 มิถุนายน พ.ศ. 2568',
        'ระหว่าง นางบุญศรี ทองมา ผู้ให้เช่า',
        `กับ ${d.holder} ผู้เช่า`,
        'ผู้ให้เช่าตกลงให้เช่าที่ดินโฉนดเลขที่ 31207',
        'เนื้อที่ 3 ไร่ เพื่อใช้ปลูกพืชสมุนไพร มีกำหนด 3 ปี',
        'ลงชื่อ ................ ผู้ให้เช่า   ลงชื่อ ................ ผู้เช่า',
    ],
    land_consent: (d) => [
        'หนังสือยินยอมให้ใช้ที่ดิน',
        'เขียนที่ อำเภอแม่แตง จังหวัดเชียงใหม่',
        'ข้าพเจ้า นางบุญมี ทองดี เจ้าของที่ดิน',
        'ตามโฉนดที่ดินเลขที่ 4567 ตำบลสบเปิง',
        `ยินยอมให้ ${d.holder}`,
        'ใช้ที่ดินดังกล่าวเพื่อปลูกพืชสมุนไพร',
        'ลงชื่อ ................................ ผู้ให้ความยินยอม',
    ],
    company_reg: (d) => [
        'หนังสือรับรองการจดทะเบียนนิติบุคคล',
        'สำนักงานทะเบียนหุ้นส่วนบริษัท กรมพัฒนาธุรกิจการค้า',
        `ขอรับรองว่า ${d.entity}`,
        `ทะเบียนนิติบุคคลเลขที่ ${groupId(d.juristicId)}`,
        'ได้จดทะเบียนเป็นนิติบุคคลเมื่อวันที่ 3 มีนาคม พ.ศ. 2562',
        `กรรมการผู้มีอำนาจลงชื่อ ${d.director}`,
        ...(d.issueDate ? [`ออกให้ ณ วันที่ ${d.issueDate}`] : []),
        'นายทะเบียน ลงชื่อ ................................',
    ],
    id_card: (d) => [
        'บัตรประจำตัวประชาชน   Thai National ID Card',
        `เลขประจำตัวประชาชน   ${groupId(d.citizenId)}`,
        `ชื่อตัวและชื่อสกุล   ${d.holder}`,
        'เกิดวันที่ 12 มี.ค. 2528',
        'ที่อยู่ 88 หมู่ 4 ตำบลริมเหนือ อำเภอแม่ริม จังหวัดเชียงใหม่',
        'วันออกบัตร 5 ม.ค. 2566   วันบัตรหมดอายุ 11 มี.ค. 2575',
    ],
    house_reg: (d) => [
        'ทะเบียนบ้าน (ท.ร.14)',
        'เลขรหัสประจำบ้าน 5001-234567-8',
        'บ้านเลขที่ 88 หมู่ 4 ตำบลริมเหนือ อำเภอแม่ริม',
        'จังหวัดเชียงใหม่',
        'รายการเกี่ยวกับบุคคลในบ้าน',
        `ชื่อ ${d.holder}   สถานภาพ เจ้าบ้าน`,
        `เลขประจำตัวประชาชน ${groupId(d.citizenId)}`,
        'สัญชาติ ไทย',
    ],
    previous_cert: (d) => [
        'ใบรับรองแหล่งผลิตพืชสมุนไพร (GACP)',
        'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
        'เลขที่ใบรับรอง GACP-TH-2566-000123',
        `ออกให้แก่ ${d.entity}`,
        'สถานที่ผลิต 12 หมู่ 3 ตำบลแม่แรม อำเภอแม่ริม',
        'ชนิดพืช กัญชา',
        'วันที่ออก 20 ตุลาคม พ.ศ. 2566',
    ],
};

// ---------------------------------------------------------------------------
// What each slot's applicant has on file comes from labels.json `references`
// (the one copy — labels.json is the truth the report scores against). A
// correct document prints that data; a person's name is printed with a title
// glued on, the way Thai documents print it (the on-file name has none).
// Only what the platform never holds (a full citizen id, dates) is added here.
// ---------------------------------------------------------------------------

const LABELS_PATH = path.join(BACKEND_DIR, '__tests__', 'fixtures', 'document-precheck', 'labels.json');
const REFS = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf8')).references;

/** The full citizen id printed on a card; must end in the on-file last 4. */
function citizenIdEndingIn(id, last4) {
    assertValidId(id);
    if (!id.endsWith(last4)) {throw new Error(`make-corpus: ${id} does not end in the on-file last 4 (${last4})`);}
    return id;
}

const PERSONAS = {
    land_deed: { holder: `นางสาว${REFS.land_deed.applicantName}` },
    land_lease: { holder: `นาย${REFS.land_lease.applicantName}`, citizenId: '1555544444335' },
    land_consent: { holder: `นาย${REFS.land_consent.applicantName}` },
    company_reg: {
        entity: REFS.company_reg.entityName,
        juristicId: REFS.company_reg.juristicId,
        director: `นาย${REFS.company_reg.directorName}`,
        directorCitizenId: '1999988888775',
        issueDate: '15 สิงหาคม พ.ศ. 2569',
    },
    id_card: {
        holder: `นาง${REFS.id_card.applicantName}`,
        citizenId: citizenIdEndingIn('1234567890121', REFS.id_card.citizenIdLast4),
    },
    house_reg: { holder: `นาย${REFS.house_reg.applicantName}`, citizenId: '3111122222339' },
    previous_cert: { entity: REFS.previous_cert.entityName },
};

/**
 * A near name: a different person/company whose name is close to the
 * applicant's — the case NAME_SIMILARITY_MIN exists to separate from an OCR
 * slip. Deliberately spread across edit distances (1 edit on a long name up to
 * several) so the threshold sweep has something to resolve.
 */
const NAME_MISMATCH = {
    land_deed: { holder: 'นางสาวมาลี ศรีสุข' },
    land_lease: { holder: 'นายประเสริฐ วงศ์ใหม่' },
    land_consent: { holder: 'นายบุญมาก แก้วประสิทธิ์' },
    company_reg: { entity: 'บริษัท สมุนไพรทดลอง จำกัด' },
    id_card: { holder: 'นางกาญจนา รุ่งโรจน์' },
    house_reg: { holder: 'นายธนากร พิทักษ์ไทย' },
    previous_cert: { entity: 'บริษัท สวนสมุนไพรทดลอง จำกัด' },
};

/** A different, checksum-valid id — only for the types that print one. */
const ID_MISMATCH = {
    company_reg: { juristicId: '0999911111875' },
    id_card: { citizenId: '1234567890988' },
    house_reg: { citizenId: '3111122222771' },
};

/** Which other type's document is uploaded into this slot for the wrong-type variant, and with what data. */
const WRONG_TYPE = {
    land_deed: { template: 'land_consent', data: () => ({ holder: PERSONAS.land_deed.holder }) },
    land_lease: {
        template: 'id_card',
        data: () => ({ holder: PERSONAS.land_lease.holder, citizenId: PERSONAS.land_lease.citizenId }),
    },
    land_consent: { template: 'land_deed', data: () => ({ holder: PERSONAS.land_consent.holder }) },
    company_reg: {
        template: 'id_card',
        data: () => ({ holder: PERSONAS.company_reg.director, citizenId: PERSONAS.company_reg.directorCitizenId }),
    },
    id_card: { template: 'house_reg', data: () => ({ ...PERSONAS.id_card }) },
    house_reg: { template: 'id_card', data: () => ({ ...PERSONAS.house_reg }) },
    previous_cert: {
        template: 'company_reg',
        data: () => ({ ...PERSONAS.company_reg, entity: PERSONAS.previous_cert.entity }),
    },
};

/**
 * The variant list, per slot. `render` picks the renderer; `data` returns what
 * the page prints. Order here is the order of the files in labels.json.
 */
function variantsFor(slot) {
    const persona = PERSONAS[slot];
    const own = (data) => TEMPLATES[slot](data);
    const variants = [
        { name: 'correct-text', render: 'text-pdf', lines: own(persona) },
        { name: 'correct-scan', render: 'scan-pdf', lines: own(persona) },
        { name: 'scan-blur', render: 'scan-png', blur: LEGIBLE_BLUR_SIGMA, lines: own(persona) },
        { name: 'scan-rotate3', render: 'scan-png', rotate: ROTATION_DEGREES, lines: own(persona) },
        { name: 'scan-heavy-blur', render: 'scan-png', blur: HEAVY_BLUR_SIGMA, lines: own(persona) },
        { name: 'illegible', render: 'scan-png', blur: ILLEGIBLE_BLUR_SIGMA, lines: own(persona) },
        { name: 'wrong-type', render: 'text-pdf', lines: TEMPLATES[WRONG_TYPE[slot].template](WRONG_TYPE[slot].data()) },
        { name: 'name-mismatch', render: 'text-pdf', lines: own({ ...persona, ...NAME_MISMATCH[slot] }) },
    ];
    if (ID_MISMATCH[slot]) {
        variants.push({ name: 'id-mismatch', render: 'text-pdf', lines: own({ ...persona, ...ID_MISMATCH[slot] }) });
    }
    if (slot === 'company_reg') {
        variants.push({ name: 'expired', render: 'text-pdf', lines: own({ ...persona, issueDate: '10 มกราคม พ.ศ. 2569' }) });
        variants.push({ name: 'no-date', render: 'text-pdf', lines: own({ ...persona, issueDate: null }) });
    }
    return variants;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * The page as a PNG — what a scanner/phone produces before any degradation.
 *
 * Rendered by laying the page out as a pdfkit PDF with the bundled Sarabun
 * font and rasterising that with pdf-parse (pdf.js), so the glyphs are real
 * Sarabun. (An SVG `@font-face` data URL is silently ignored by sharp's SVG
 * renderer, which falls back to a system font — seen on the first draft of
 * this corpus.) pdf-parse is required here, in a plain node process — never
 * inside jest (see services/document-precheck/pdf-extract-worker.js) — and
 * lazily, so requiring this module for `DEFAULT_OUT_DIR` costs nothing.
 */
async function renderPagePng(lines, { blur, rotate } = {}) {
    const { PDFParse } = require('pdf-parse');
    const heightPt = (MARGIN_PX * 2 + LINE_HEIGHT_PX * lines.length) / RASTER_SCALE;
    const pdf = await pdfToBuffer(
        (doc) =>
            doc
                .font(FONT_PATH)
                .fontSize(FONT_SIZE_PX / RASTER_SCALE)
                .text(lines.join('\n'), { lineGap: (LINE_HEIGHT_PX - FONT_SIZE_PX * 1.3) / RASTER_SCALE }),
        { size: [PAGE_WIDTH_PX / RASTER_SCALE, heightPt], margin: MARGIN_PX / RASTER_SCALE },
    );
    const parser = new PDFParse({ data: pdf });
    let raster;
    try {
        const shot = await parser.getScreenshot({ scale: RASTER_SCALE });
        raster = Buffer.from(shot.pages[0].data);
    } finally {
        await parser.destroy();
    }
    let img = sharp(raster).flatten({ background: '#ffffff' });
    if (rotate) {img = sharp(await img.png().toBuffer()).rotate(rotate, { background: '#ffffff' });}
    if (blur) {img = sharp(await img.png().toBuffer()).blur(blur);}
    return img.greyscale().png({ compressionLevel: 9 }).toBuffer();
}

function pdfToBuffer(draw, docOpts) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ ...docOpts, info: { CreationDate: FIXED_PDF_DATE, ModDate: FIXED_PDF_DATE } });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        draw(doc);
        doc.end();
    });
}

function writePdf(filePath, draw, docOpts) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ ...docOpts, info: { CreationDate: FIXED_PDF_DATE, ModDate: FIXED_PDF_DATE } });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        draw(doc);
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

async function renderVariant(filePath, variant) {
    if (variant.render === 'text-pdf') {
        await writePdf(
            filePath,
            (doc) => doc.font(FONT_PATH).fontSize(16).text(variant.lines.join('\n'), { lineGap: 6, features: TEXT_LAYER_FEATURES }),
            { margin: 50 },
        );
        return assertTextLayerFaithful(filePath, variant.lines);
    }
    const png = await renderPagePng(variant.lines, variant);
    if (variant.render === 'scan-png') {
        return fs.promises.writeFile(filePath, png);
    }
    const { width, height } = await sharp(png).metadata();
    return writePdf(filePath, (doc) => doc.image(png, 0, 0, { width, height }), { size: [width, height], margin: 0 });
}

/**
 * pdfkit's default OpenType shaping runs `ccmp`, which splits สระอำ into
 * NIKHAHIT + SARA AA glyphs and reuses the SARA AA glyph for a plain "า". The
 * PDF's ToUnicode map can hold one string per glyph, so whichever came first
 * wins: every later "า" either vanished or read back as "ำา" (first draft of
 * this corpus: "นายบุญมา" extracted as "นยบุญม"). A text-layer variant is
 * meant to be a faithful text layer, so `ccmp` is off for it, and every one
 * is read back and compared before the corpus is accepted.
 */
const TEXT_LAYER_FEATURES = { ccmp: false };

async function assertTextLayerFaithful(filePath, lines) {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: await fs.promises.readFile(filePath) });
    try {
        const { text } = await parser.getText();
        const squash = (s) => s.replace(/\s+/g, '');
        if (squash(text.replace(/--\s*\d+ of \d+\s*--/g, '')) !== squash(lines.join(''))) {
            throw new Error(`make-corpus: ${path.basename(filePath)}'s text layer does not read back as the printed text:\n${text}`);
        }
    } finally {
        await parser.destroy();
    }
}

function extensionFor(render) {
    return render === 'scan-png' ? 'png' : 'pdf';
}

/**
 * Renders every variant of every slot into `outDir`.
 *
 * @param {string} [outDir]
 * @returns {Promise<Array<{file: string, slotId: string, variant: string, mime: string}>>}
 */
async function makeCorpus(outDir = DEFAULT_OUT_DIR) {
    fs.mkdirSync(outDir, { recursive: true });
    const written = [];
    for (const slotId of Object.keys(TEMPLATES)) {
        for (const variant of variantsFor(slotId)) {
            const ext = extensionFor(variant.render);
            const file = `${slotId}--${variant.name}.${ext}`;
            await renderVariant(path.join(outDir, file), variant);
            written.push({ file, slotId, variant: variant.name, mime: ext === 'png' ? 'image/png' : 'application/pdf' });
        }
    }
    return written;
}

// TEMPLATES / renderPagePng / writePdf are exported for the Task 10 resource
// measurement (evidence/document-precheck-task-10/INDEX.md), which builds a
// multi-page scanned PDF from the same page renderer as the corpus.
module.exports = { makeCorpus, DEFAULT_OUT_DIR, TEMPLATES, renderPagePng, writePdf };

if (require.main === module) {
    const outDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT_DIR;
    makeCorpus(outDir)
        .then((files) => {
            const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(outDir, f.file)).size, 0);
            console.log(`make-corpus: ${files.length} files, ${bytes} bytes -> ${outDir}`);
        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
