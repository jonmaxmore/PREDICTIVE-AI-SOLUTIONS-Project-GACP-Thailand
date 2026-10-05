/**
 * Pricing page — Iter 28 marketing site.
 *
 * Full fee transparency for the GACP certification process. Mirrors the
 * pricing teaser table on the landing page but adds detail: who pays
 * what, when, refund policy, and links to the Terms of Service for the
 * binding contractual terms.
 *
 * Operator decision 6 (2026-09-17), audit UXUI-01 / UXUI-X2: this page named
 * the department's PromptPay tax ID and bank account as places to pay, an
 * "e-Tax Invoice" within one working day, a phase-2 refund up to 7 working days
 * before the visit, and no renewal charge under "ไม่มีค่าใช้จ่ายแอบแฝง". The
 * payee, rail, receipt and refund statements now come from
 * constants/service-facts.ts (each names its record), and the renewal charge is
 * disclosed beside the two phases.
 *
 * Every amount on this page is the one GET /api/pricing/fees serves
 * (fetchPublicFees, revalidated every PRICING_REVALIDATE_SECONDS). The page
 * used to print literals from constants/fees.ts, which would have kept showing
 * the old price after a fee changed in the fee engine
 * (apps/backend/config/business-rules.js) while invoices billed the new one.
 * The served figures may be up to 300 s old (Next revalidation). When the fees cannot be read, the page shows FEES_UNAVAILABLE_TH and
 * no number at all.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingSection } from '@/components/marketing/marketing-section';
import { fetchPublicFees } from '@/lib/pricing/fetch-public-fees';
import {
  FEES_UNAVAILABLE_TH,
  formatBaht,
  servedVatPart,
  vatPercentLabel,
  type PublicFees,
} from '@/lib/pricing/public-fees';
import {
  ONLINE_PAYMENT_STEP_TH,
  PAYEE_STATEMENT_TH,
  PAYEE_TH,
  PAYMENT_CHANNEL_TH,
  RECEIPT_TH,
  REFUND_AUDIT_TH,
  REFUND_PHASE1_TH,
  REFUND_POLICY_TH,
  REFUND_REQUEST_TH,
  RENEWAL_WINDOW_TH,
} from '@/constants/service-facts';
import { FEE_SERVICES_FALLBACK, SERVICE_NAME } from '@/lib/pricing/fee-services';
import {
  PAYMENT_TERMS_EDITION_TH,
  PAYMENT_TERMS_TITLE_TH,
} from '@/constants/payment-terms';

export const metadata: Metadata = {
  title: 'ค่าบริการการรับรอง GACP',
  description:
    `ค่าบริการการรับรอง GACP สมุนไพรไทย แบ่งชำระ 2 งวด (${FEE_SERVICES_FALLBACK.PHASE_1.name} และ${FEE_SERVICES_FALLBACK.PHASE_2.name}) ราคาต่อหนึ่งรูปแบบการปลูก รวมภาษีมูลค่าเพิ่มแล้ว ชำระให้บริษัทผู้ให้บริการแพลตฟอร์ม พร้อม${FEE_SERVICES_FALLBACK.RENEWAL.name}`,
  alternates: { canonical: 'https://gacpth.com/pricing' },
};

// Rendered per request. A segment `revalidate` made Next prerender this page at
// `docker build`, where no backend runs, so the image shipped the no-number
// fallback as a cached page (staging/demo 2026-10-03). The fee fetch itself is
// still cached for PRICING_REVALIDATE_SECONDS. Pinned by fees-from-server.test.tsx.
export const dynamic = 'force-dynamic';

// operator 2026-09-11: "ไม่มีการแยกค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการทั้งหมด"
// หน้านี้เคยแสดงสามส่วน (ราคาเต็ม + ค่าแพลตฟอร์ม 10% + VAT) และก่อนหน้านั้นเคยบอกว่า
// ค่าธรรมเนียมรัฐได้รับยกเว้น VAT ตาม ม.77/1(10) ทั้งสองอย่างไม่เป็นความจริงแล้ว
// ตอนนี้แสดงสองส่วน: ค่าบริการ กับ VAT ของมัน ทุกตัวเลขมาจาก GET /api/pricing/fees
// ไม่มีค่าออกใบรับรอง และไม่มีค่าตรวจติดตามรายปี

type FeeRow = {
  code: string;
  name: string;
  nameEn: string;
  /** null when the served fees could not be read: the row shows no amount */
  amount: { serviceFee: number; vat: number; total: number } | null;
  when: string;
  coverage: string;
  refund: string;
  note: string | null;
};

const amountOf = (serviceFee: number, total: number) => ({
  serviceFee,
  vat: servedVatPart(serviceFee, total),
  total,
});

// fix/fee-line-descriptions (operator 2026-10-03): every name and coverage line is
// the server's catalogue (GET /api/pricing/fees `services`), with the one web mirror
// standing in only when the fees cannot be read. The phase-2 coverage used to read
// "ค่าตอบแทนคณะผู้ตรวจ ค่าเดินทาง และค่าที่พักเจ้าหน้าที่ตรวจ" — the fee covers none of
// those, and the department asks why a service fee would.
function feeRows(fees: PublicFees | null): { phases: FeeRow[]; renewal: FeeRow } {
  const services = fees?.services ?? FEE_SERVICES_FALLBACK;
  const phases: FeeRow[] = [
    {
      code: 'PHASE1',
      name: services.PHASE_1.name,
      nameEn: services.PHASE_1.nameEn,
      amount: fees ? amountOf(fees.applicationFee, fees.phase1TotalPerScope) : null,
      when: 'ชำระหลังยื่นคำขอและยอมรับใบเสนอราคา',
      coverage: `${services.PHASE_1.coverage} (ต่อขอบเขตการปลูก)`,
      refund: REFUND_PHASE1_TH,
      note: null,
    },
    {
      code: 'PHASE2',
      name: services.PHASE_2.name,
      nameEn: services.PHASE_2.nameEn,
      amount: fees ? amountOf(fees.inspectionFee, fees.phase2TotalPerScope) : null,
      when: 'ชำระก่อนวันนัดตรวจประเมิน',
      coverage: `${services.PHASE_2.coverage} (ต่อขอบเขตการปลูก)`,
      refund: REFUND_AUDIT_TH,
      note: null,
    },
  ];

  // W12 (operator 2026-08-22): a renewal is ONE charge, with no document
  // review. Listed so the page's "no hidden costs" line does not leave out the
  // one charge a certified farm meets every year (CERTIFICATE.VALIDITY_YEARS).
  // Not part of the hero total, which is the price of a new application.
  const renewal: FeeRow = {
    code: 'RENEWAL',
    name: services.RENEWAL.name,
    nameEn: services.RENEWAL.nameEn,
    amount: fees ? amountOf(fees.renewalFee, fees.renewalTotalPerScope) : null,
    when: 'ชำระครั้งเดียวเมื่อยื่นต่ออายุ',
    // Its own line under the table: glued onto `when` it read as one run-on
    // sentence ("ชำระครั้งเดียวเมื่อยื่นต่ออายุ ยื่นต่ออายุได้ขณะที่…").
    note: RENEWAL_WINDOW_TH,
    coverage: `${services.RENEWAL.coverage} (ต่อขอบเขตการปลูก)`,
    refund: REFUND_AUDIT_TH,
  };

  return { phases, renewal };
}

export default async function PricingPage() {
  const fees = await fetchPublicFees();
  const { phases, renewal } = feeRows(fees);
  const vat = fees ? vatPercentLabel(fees) : null;

  return (
    <>
      <section
        aria-labelledby="pricing-hero"
        className="bg-primary-50 dark:bg-zinc-950"
      >
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 md:py-20 lg:px-8">
          <p className="mb-2 text-xs font-semibold text-primary-700 dark:text-primary-300">
            ค่าบริการ
          </p>
          <h1 id="pricing-hero" className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl md:text-5xl">
            ค่าบริการการรับรอง GACP
          </h1>
          {/* The page said the rates follow a department announcement. The price
              is the company's ค่าบริการ (operator 2026-09-11: no state fee, no
              platform fee, one ค่าบริการ), paid to the company
              (W14), so it names the payee instead. */}
          <p className="mt-4 max-w-3xl text-base text-zinc-600 dark:text-zinc-300 sm:text-lg">
            ค่าบริการทุกรายการชำระให้{PAYEE_TH} หน้านี้แสดงค่าใช้จ่ายทุกรายการไว้ล่วงหน้า
            รวม{SERVICE_NAME.RENEWAL} ไม่มีค่าใช้จ่ายแอบแฝง
          </p>
          <div className="mt-6 inline-flex flex-col gap-1 rounded-xl border border-primary-200 bg-white px-5 py-4 text-sm shadow-sm dark:border-primary-800 dark:bg-zinc-900">
            <span className="text-xs font-semibold text-primary-700 dark:text-primary-300">รวมค่าบริการต่อขอบเขตการปลูก (2 งวด)</span>
            {fees ? (
              <>
                <span className="text-2xl font-bold tabular-nums text-primary-800 dark:text-primary-200">{formatBaht(fees.phase1TotalPerScope + fees.phase2TotalPerScope)} บาท</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  งวดที่ 1 <span className="tabular-nums">{formatBaht(fees.phase1TotalPerScope)}</span> + งวดที่ 2 <span className="tabular-nums">{formatBaht(fees.phase2TotalPerScope)}</span>  รวม VAT {vat} บนค่าบริการแล้ว
                </span>
              </>
            ) : (
              <span data-testid="fees-unavailable" className="text-sm text-zinc-700 dark:text-zinc-200">{FEES_UNAVAILABLE_TH}</span>
            )}
          </div>
        </div>
      </section>

      <MarketingSection
        id="fee-breakdown"
        eyebrow="รายละเอียด"
        title="รายละเอียดค่าบริการแต่ละรายการ"
      >
        <div className="space-y-4">
          {[...phases, renewal].map((fee) => (
            <article
              key={fee.code}
              className="rounded-2xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-zinc-900"
              aria-labelledby={`fee-${fee.code}`}
            >
              <header className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 id={`fee-${fee.code}`} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {fee.name}
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400" lang="en">{fee.nameEn}</p>
                </div>
                <div className="text-right">
                  {/* `font-mono` here put the digits in Menlo/Courier (no Thai glyphs) while
                      "บาท" fell through to Sukhumvit Set — two typefaces in one money
                      line, measured on the live page. What was wanted is aligned digits,
                      which is `tabular-nums`. */}
                  {fee.amount ? (
                    <>
                      <p className="text-2xl font-bold tabular-nums text-primary-800 dark:text-primary-200">{formatBaht(fee.amount.total)} บาท</p>
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        ค่าบริการ <span className="tabular-nums">{formatBaht(fee.amount.serviceFee)}</span> + VAT {vat} <span className="tabular-nums">{formatBaht(fee.amount.vat)}</span>
                      </p>
                    </>
                  ) : null}
                </div>
              </header>
              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">ระยะเวลาชำระ</dt>
                  <dd className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{fee.when}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">บริการที่ได้รับ</dt>
                  <dd className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{fee.coverage}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">นโยบายขอคืน</dt>
                  <dd className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{fee.refund}</dd>
                </div>
              </dl>
              {fee.note ? (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{fee.note}</p>
              ) : null}
            </article>
          ))}
        </div>
      </MarketingSection>

      <div className="bg-primary-50/40 dark:bg-primary-900/20">
        <MarketingSection
          id="payment-channels"
          eyebrow="ช่องทางชำระเงิน"
          title="ผู้รับเงินและช่องทางการชำระเงิน"
          description={PAYEE_STATEMENT_TH}
        >
          <ul className="grid gap-3 sm:grid-cols-2">
            <li className="rounded-xl border border-primary-100 bg-white p-4 text-sm shadow-sm dark:border-primary-900/40 dark:bg-zinc-900">
              <span className="block font-semibold text-zinc-900 dark:text-zinc-50">ผู้รับเงิน</span>
              <span className="text-zinc-600 dark:text-zinc-300">{PAYEE_TH}</span>
            </li>
            <li className="rounded-xl border border-primary-100 bg-white p-4 text-sm shadow-sm dark:border-primary-900/40 dark:bg-zinc-900">
              <span className="block font-semibold text-zinc-900 dark:text-zinc-50">QR พร้อมเพย์ ผ่านผู้ให้บริการรับชำระเงิน</span>
              <span className="text-zinc-600 dark:text-zinc-300">{PAYMENT_CHANNEL_TH}</span>
            </li>
          </ul>
          {/* Review M-4: this is how paying works, true in both states of the
              rail — information, not a warning, so no amber status box. */}
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
            {ONLINE_PAYMENT_STEP_TH}
          </p>
          <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-300">
            {RECEIPT_TH} และดูได้ที่หน้าการชำระเงินในระบบ
          </p>
        </MarketingSection>
      </div>

      <MarketingSection
        id="refund-policy"
        eyebrow="การคืนเงิน"
        title="เงื่อนไขการคืนเงิน"
        description={`สรุปจาก${PAYMENT_TERMS_TITLE_TH} ฉบับที่ ${PAYMENT_TERMS_EDITION_TH} ที่ผู้ยื่นคำขอกดยอมรับก่อนชำระเงินทุกครั้ง`}
      >
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
          {REFUND_POLICY_TH.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">{REFUND_REQUEST_TH}</p>
      </MarketingSection>

      <MarketingSection
        id="legal-link"
        eyebrow="เงื่อนไขสัญญา"
        title="เงื่อนไขทางสัญญาฉบับเต็ม"
        description="รายละเอียดเงื่อนไขการให้บริการ การคืนเงิน และความรับผิดของแพลตฟอร์ม"
      >
        <div className="flex flex-wrap gap-3">
          <Link
            href="/terms-of-service"
            className="inline-flex items-center justify-center rounded-md bg-primary-600 px-5 py-3 text-sm font-semibold text-white hover:bg-primary-700"
          >
            อ่านข้อกำหนดและเงื่อนไข
          </Link>
          <Link
            href="/privacy-policy"
            className="inline-flex items-center justify-center rounded-md border border-primary-300 px-5 py-3 text-sm font-semibold text-primary-800 hover:bg-primary-50 dark:border-primary-700 dark:text-primary-200 dark:hover:bg-primary-900/30"
          >
            นโยบายความเป็นส่วนตัว
          </Link>
        </div>
      </MarketingSection>
    </>
  );
}
