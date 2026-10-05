/**
 * The payment-terms summary the checkout screen shows above the tick.
 *
 * Written from docs/legal/payment-terms-th-v1.2.md (operator 2026-10-03,
 * effective 4 ตุลาคม 2569). The version a grant is RECORDED under is still the
 * server's (ConsentVersions.PAYMENT_TERMS, coordinator ruling 2): this module
 * only says which document the summary was written from, and
 * src/__tests__/truthful-copy/payment-terms-summary-is-the-published-document.test.ts
 * keeps PAYMENT_TERMS_SUMMARY_VERSION equal to the backend's published default
 * and every line below equal to text in that document. Publishing a new
 * version turns that suite red until this summary is rewritten.
 *
 * ท่าน is kept inside these lines on purpose: they quote a legal surface
 * (thai-ui-copy), as the rest of the checkout disclosure does.
 */

import { FEE_SERVICES_FALLBACK } from '@/lib/pricing/fee-services';

/** The document this summary is written from (the backend's PUBLISHED_CONSENT_VERSIONS). */
export const PAYMENT_TERMS_SUMMARY_VERSION = 'payment-terms-th-v1.2';

/** The document's title, without the edition. */
export const PAYMENT_TERMS_TITLE_TH = 'เงื่อนไขการชำระค่าบริการและการคืนเงิน';

/** The edition printed in the document heading. */
export const PAYMENT_TERMS_EDITION_TH = '1.2';

/** The date the edition took effect, as the document states it. */
export const PAYMENT_TERMS_EFFECTIVE_TH = '4 ตุลาคม 2569';

/**
 * The label the catalogue puts before each coverage line on the finance
 * documents. The terms (§2.5) print the same line after "<name>: " instead.
 */
const COVERAGE_LABEL = 'ครอบคลุม: ';

/**
 * §2.5: each line by its catalogue name and what it covers. Not a copy: both
 * come from the one web mirror of the backend's SERVICE_CATALOGUE
 * (lib/pricing/fee-services.ts → constants/fee-service-catalogue.json, pinned
 * field for field by apps/backend/__tests__/unit/fee-service-catalogue-web-mirror.test.js),
 * the same words the quotation, invoice and receipt print.
 */
export const PAYMENT_TERMS_SERVICE_LINES: ReadonlyArray<{ name: string; covers: string }> = (
    ['PHASE_1', 'PHASE_2', 'RENEWAL'] as const
).map((key) => ({
    name: FEE_SERVICES_FALLBACK[key].name,
    covers: FEE_SERVICES_FALLBACK[key].coverage.startsWith(COVERAGE_LABEL)
        ? FEE_SERVICES_FALLBACK[key].coverage.slice(COVERAGE_LABEL.length)
        : FEE_SERVICES_FALLBACK[key].coverage,
}));

/** §2.6: one fee, no state part, no inspector travel/lodging/fee. */
export const PAYMENT_TERMS_ONE_FEE_TH =
    'ค่าบริการเป็นจำนวนเดียวที่บริษัทเรียกเก็บ ไม่แยกเป็นส่วนของหน่วยงานรัฐ และไม่รวมค่าเดินทาง ค่าที่พัก หรือค่าตอบแทนของผู้ตรวจ';

/** §3.4: the accepted quotation's price binds every instalment of the application. */
export const PAYMENT_TERMS_PRICE_BINDING_TH =
    'ราคาตามใบเสนอราคานั้นผูกพันทุกงวดของคำขอนี้จนชำระครบ';
