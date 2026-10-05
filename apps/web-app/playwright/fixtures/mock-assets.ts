/**
 * Inline binary-ish assets for the API-mocked Playwright suite.
 *
 * The fixtures point slip and document previews at paths like
 * `/mock/slip-w1b-state.png` and `/api/payments/slip/<id>/file`. Neither is
 * served in mock mode — `public/mock/` does not exist (404) and the payments
 * API needs a backend (503) — so every preview surface rendered a broken
 * image: the applicant's Phase-1/Phase-2 slip, the reviewer's 9-document
 * iframe, and the accounting slip-review modal that exists specifically so a
 * clerk can read the amount and transfer time off the slip.
 *
 * Tests still passed, because they assert on DOM text and never asked whether
 * the image decoded. `expectImagesRendered()` below closes that: it checks
 * `naturalWidth`, which is 0 for a broken raster image.
 *
 * SVG rather than a base64 PNG blob: it is legible in a committed diff,
 * carries real text a human can read in a screenshot, and scales to any
 * preview box. Browsers render it in both `<img>` and `<iframe>`.
 */
import type { Page } from '@playwright/test';

/** A bank transfer slip a clerk could actually read an amount and time off. */
export function slipSvg(opts: {
  bank?: string;
  amount?: string;
  ref?: string;
  when?: string;
  payee?: string;
} = {}): string {
  const {
    bank = 'ธนาคารกรุงไทย · KRUNG THAI BANK',
    amount = '฿5,535.00',
    ref = 'TXN-2569-0727-004512',
    when = '27 ก.ค. 2569  09:41 น.',
    payee = 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
  } = opts;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="720" viewBox="0 0 520 720" role="img" aria-label="ตัวอย่างสลิปโอนเงิน">
  <rect width="520" height="720" fill="#f8fafc"/>
  <rect x="16" y="16" width="488" height="688" rx="14" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
  <rect x="16" y="16" width="488" height="86" rx="14" fill="#00b0f0"/>
  <rect x="16" y="80" width="488" height="22" fill="#00b0f0"/>
  <text x="40" y="58" font-family="sans-serif" font-size="19" font-weight="bold" fill="#ffffff">${bank}</text>
  <text x="40" y="84" font-family="sans-serif" font-size="13" fill="#e0f2fe">โอนเงินสำเร็จ · Transfer Successful</text>
  <circle cx="260" cy="168" r="34" fill="#dcfce7" stroke="#16a34a" stroke-width="3"/>
  <path d="M244 168 l12 12 l22 -24" fill="none" stroke="#16a34a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="260" y="238" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#475569">จำนวนเงิน</text>
  <text x="260" y="284" text-anchor="middle" font-family="sans-serif" font-size="40" font-weight="bold" fill="#0f172a">${amount}</text>
  <line x1="48" y1="320" x2="472" y2="320" stroke="#e2e8f0" stroke-width="2"/>
  <text x="48" y="356" font-family="sans-serif" font-size="13" fill="#64748b">วันที่/เวลา</text>
  <text x="472" y="356" text-anchor="end" font-family="sans-serif" font-size="14" fill="#0f172a">${when}</text>
  <text x="48" y="398" font-family="sans-serif" font-size="13" fill="#64748b">เลขที่รายการ</text>
  <text x="472" y="398" text-anchor="end" font-family="monospace" font-size="14" fill="#0f172a">${ref}</text>
  <text x="48" y="440" font-family="sans-serif" font-size="13" fill="#64748b">บัญชีปลายทาง</text>
  <text x="472" y="466" text-anchor="end" font-family="sans-serif" font-size="13" fill="#0f172a">${payee}</text>
  <text x="48" y="508" font-family="sans-serif" font-size="13" fill="#64748b">จากบัญชี</text>
  <text x="472" y="508" text-anchor="end" font-family="monospace" font-size="14" fill="#0f172a">xxx-x-x4821-9</text>
  <rect x="48" y="546" width="424" height="120" rx="10" fill="#f1f5f9"/>
  <text x="70" y="586" font-family="sans-serif" font-size="12" fill="#64748b">สลิปตัวอย่างสำหรับการทดสอบระบบ (E2E mock)</text>
  <text x="70" y="612" font-family="sans-serif" font-size="12" fill="#64748b">ไม่ใช่เอกสารทางการเงินจริง</text>
  <text x="70" y="644" font-family="monospace" font-size="11" fill="#94a3b8">GACP-E2E-SLIP-PREVIEW</text>
</svg>`;
}

/** A scanned-looking application document page. */
export function documentSvg(title = 'เอกสารประกอบคำขอ', subtitle = 'สำเนาบัตรประจำตัวประชาชน'): string {
  const lines = Array.from({ length: 11 }, (_, i) => {
    const y = 300 + i * 30;
    const w = i % 4 === 3 ? 250 : 430;
    return `<rect x="60" y="${y}" width="${w}" height="12" rx="4" fill="#e2e8f0"/>`;
  }).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="740" viewBox="0 0 560 740" role="img" aria-label="${title}">
  <rect width="560" height="740" fill="#94a3b8"/>
  <rect x="20" y="20" width="520" height="700" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
  <rect x="60" y="60" width="120" height="120" rx="6" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2"/>
  <circle cx="120" cy="108" r="26" fill="#cbd5e1"/>
  <path d="M78 168 q42 -44 84 0 z" fill="#cbd5e1"/>
  <text x="210" y="92" font-family="sans-serif" font-size="20" font-weight="bold" fill="#0f172a">${title}</text>
  <text x="210" y="124" font-family="sans-serif" font-size="15" fill="#475569">${subtitle}</text>
  <text x="210" y="156" font-family="monospace" font-size="13" fill="#64748b">DOC-2569-W1B-0001</text>
  <line x1="60" y1="220" x2="500" y2="220" stroke="#0f172a" stroke-width="2"/>
  <text x="60" y="262" font-family="sans-serif" font-size="15" font-weight="bold" fill="#0f172a">รายละเอียดเอกสาร</text>
  ${lines}
  <rect x="330" y="640" width="170" height="60" rx="6" fill="none" stroke="#16a34a" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="415" y="666" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#16a34a">ตรวจสอบแล้ว</text>
  <text x="415" y="686" text-anchor="middle" font-family="monospace" font-size="10" fill="#16a34a">E2E MOCK</text>
</svg>`;
}

/** An on-site inspection photo stand-in. */
export function auditPhotoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420" role="img" aria-label="ภาพถ่ายการตรวจแปลง">
  <rect width="640" height="420" fill="#bae6fd"/>
  <rect y="250" width="640" height="170" fill="#65a30d"/>
  <circle cx="540" cy="80" r="42" fill="#fde047"/>
  <path d="M0 250 q160 -70 320 0 q160 -70 320 0 z" fill="#4d7c0f"/>
  <g fill="#166534">
    <rect x="90" y="238" width="8" height="60"/><ellipse cx="94" cy="232" rx="26" ry="18"/>
    <rect x="210" y="246" width="8" height="52"/><ellipse cx="214" cy="240" rx="24" ry="16"/>
    <rect x="330" y="240" width="8" height="58"/><ellipse cx="334" cy="234" rx="26" ry="18"/>
    <rect x="450" y="250" width="8" height="48"/><ellipse cx="454" cy="244" rx="22" ry="15"/>
  </g>
  <rect x="16" y="352" width="300" height="52" rx="6" fill="#0f172a" fill-opacity="0.72"/>
  <text x="30" y="374" font-family="monospace" font-size="13" fill="#ffffff">18.7883 N, 98.9853 E</text>
  <text x="30" y="394" font-family="monospace" font-size="12" fill="#e2e8f0">27 ก.ค. 2569 11:14 · E2E MOCK</text>
</svg>`;
}

/**
 * A minimal but genuinely valid single-page PDF.
 *
 * Built rather than base64-blobbed so the byte offsets in the xref table are
 * computed, not copy-pasted — a PDF with a wrong xref renders blank in Chrome
 * and would make this fixture prove the opposite of what it claims.
 *
 * Only WinAnsi text, so no font embedding: enough for "does the viewer render
 * a page", which is what the preview assertions ask.
 */
export function slipPdf(lines: string[] = [
    'GACP e-Payment Slip (E2E MOCK)',
    'Amount: THB 5,000.00',
    'Ref: TXN-2569-0727-004512',
    'Date: 27/07/2569 09:41',
]): string {
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const text = lines
        .map((l, i) => `BT /F1 ${i === 0 ? 16 : 12} Tf 40 ${300 - i * 34} Td (${esc(l)}) Tj ET`)
        .join('\n');
    const stream = `q 0.85 0.92 1 rg 0 0 420 360 re f Q\n0 0 0 rg\n${text}`;

    const objects = [
        '<</Type/Catalog/Pages 2 0 R>>',
        '<</Type/Pages/Kids[3 0 R]/Count 1>>',
        '<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 360]/Contents 4 0 R'
        + '/Resources<</Font<</F1 5 0 R>>>>>>',
        `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
        '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
    ];

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(pdf.length);
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;
    return pdf;
}

function pdfRoute(body: string) {
    return {
        status: 200,
        contentType: 'application/pdf',
        headers: { 'cache-control': 'no-store' },
        body,
    };
}

function svgRoute(body: string) {
  return {
    status: 200,
    contentType: 'image/svg+xml; charset=utf-8',
    headers: { 'cache-control': 'no-store' },
    body,
  };
}

/**
 * Serve every preview URL the app requests in mock mode.
 *
 * Call BEFORE the page navigates. Safe to call more than once per page —
 * Playwright keeps the most recently registered matching handler.
 */
export async function installMockAssetRoutes(page: Page): Promise<void> {
  // Escape hatch for demonstrating the RED state. The guard lives here rather
  // than in the spec because the fixtures install these routes too — a
  // spec-level skip alone would still get them via `accountDtamMocks` and the
  // "broken preview" state would be unreachable.
  if (process.env.PREVIEW_NO_ASSET_ROUTES === '1') return;

  // Applicant + accounting slip images (`PaymentService.slipFileUrl`).
  //
  // The amount printed on the slip MUST match the `amountClaimed` on the row
  // the clerk is checking it against. A slip reading ฿5,535 next to an invoice
  // for ฿5,000 looks like a payment discrepancy — the exact thing this screen
  // exists to detect — so a mismatched mock would teach reviewers to distrust
  // a real signal. Keyed by slip id against the fixture amounts.
  const SLIP_AMOUNTS: Record<string, { amount: string; payee?: string }> = {
    'slip-w1c-dtam-001': { amount: '฿5,000.00' },
    'slip-w1c-plat-001': { amount: '฿535.00', payee: 'บริษัท เพรดิกทิฟ เอไอ จำกัด' },
  };
  await page.route('**/api/payments/slip/*/file*', async (route) => {
    const id = decodeURIComponent(route.request().url().match(/slip\/([^/]+)\/file/)?.[1] ?? '');
    // A slip may legitimately be a PDF — slip-upload-modal accepts
    // application/pdf alongside jpeg/png — so ids marked `-pdf` serve one.
    if (/pdf/i.test(id)) return route.fulfill(pdfRoute(slipPdf()));
    await route.fulfill(svgRoute(slipSvg(SLIP_AMOUNTS[id] ?? {})));
  });

  // Fixture-authored static paths under /mock/*.
  await page.route('**/mock/**', async (route) => {
    const url = route.request().url();
    if (/audit-photo/i.test(url)) return route.fulfill(svgRoute(auditPhotoSvg()));
    if (/slip/i.test(url)) {
      const platform = /platform|plat/i.test(url);
      return route.fulfill(svgRoute(slipSvg(
        platform
          ? { amount: '฿27,675.00', ref: 'TXN-2569-0727-004987', payee: 'บริษัท เพรดิกทิฟ เอไอ จำกัด' }
          : {},
      )));
    }
    return route.fulfill(svgRoute(documentSvg()));
  });

  // Reviewer document iframe + any other document file endpoint.
  await page.route('**/api/documents/**', async (route) => route.fulfill(svgRoute(documentSvg())));
  await page.route('**/api/applications/*/documents/*/file*', async (route) =>
    route.fulfill(svgRoute(documentSvg())));
}

/**
 * Assert every `<img>` currently in the page actually decoded.
 *
 * `naturalWidth === 0` on a complete image is the browser's own report that
 * the bytes failed to load or parse — the broken-image icon. This is the check
 * that was missing while the previews were silently broken.
 */
export async function expectImagesRendered(page: Page): Promise<{ total: number; broken: string[] }> {
  return page.evaluate(() => {
    const broken: string[] = [];
    const imgs = Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // not laid out; not a preview
      if (img.complete && img.naturalWidth === 0) {
        broken.push(img.getAttribute('src') || '(no src)');
      }
    }
    return { total: imgs.length, broken };
  });
}
