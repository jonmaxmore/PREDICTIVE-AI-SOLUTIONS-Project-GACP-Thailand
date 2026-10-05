/**
 * Terms of Service — Iter 28 marketing site.
 *
 * Binding Terms of Service for the GACP Thailand platform. Covers
 * service scope, fees and payment terms, refund policy, user obligations,
 * platform liability limits, dispute resolution, and effective date.
 *
 * Replaces (does not delete) the older /terms shortcut page which now
 * re-exports a legacy summary used inside the registration flow.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPublicFees } from '@/lib/pricing/fetch-public-fees';
import {
  FEES_UNAVAILABLE_TH,
  formatBaht,
  servedVatPart,
  vatPercentLabel,
  type PublicFees,
} from '@/lib/pricing/public-fees';
import {
  PAYEE_TH,
  PAYMENT_CHANNEL_TH,
  RECEIPT_TH,
  REFUND_POLICY_TH,
  REFUND_REQUEST_TH,
} from '@/constants/service-facts';
import { FEE_SERVICES_FALLBACK } from '@/lib/pricing/fee-services';

// Fee figures are the ones GET /api/pricing/fees serves (fetchPublicFees), so
// the binding ToS states the amount the invoice engine charges. They used to be
// literals from constants/fees.ts, which would have stayed at the old price
// after a fee changed in the fee engine (apps/backend/config/business-rules.js;
// served by /api/pricing/fees and cached up to 300 s). When the fees cannot be read, the clause
// states the structure and FEES_UNAVAILABLE_TH, never a remembered number.
//
// W14 (operator ruling 2026-08-22, the change log c28355ea): this clause used to
// state that the state fee was VAT-exempt under ม.77/1(10) and that VAT applied
// only to the platform service fee, and it computed that VAT inline as
// base x 10% x 7%. Both are now FALSE — one company issues every document and
// the whole ค่าบริการ is its taxable supply — and this is the binding ToS the
// applicant agrees to, so it cannot be left saying the retired thing.
//
// Operator decision 6 (2026-09-17), audit UXUI-01 / UXUI-X2: clause 3 also
// named PromptPay plus a transfer to the company's bank account (the rail is
// Stripe PromptPay only and the transfer rail is retired), promised documents
// within one working day (no such timetable is kept), and gave its own refund
// rule (phase 2 refundable up to 7 working days before the visit) that the
// payment terms the applicant actually accepts before paying do not contain.
// Channel, payee, receipt and refund lines now come from
// constants/service-facts.ts; the refund clause defers to
// docs/legal/payment-terms-th-v1.2.md, whose rules it summarises.
//
// fix/fee-line-descriptions (operator 2026-10-03): each charge is named, and its
// coverage stated, in the server's catalogue words (GET /api/pricing/fees
// `services`; the one web mirror when the fees cannot be read). Phase 2 was
// called "ค่าบริการตรวจประเมินภาคสนาม" here — a third name for one charge.
function feeClause(fees: PublicFees | null): string {
  const services = fees?.services ?? FEE_SERVICES_FALLBACK;
  const { PHASE_1: p1, PHASE_2: p2, RENEWAL: rn } = services;
  if (!fees) {
    return `ค่าบริการคิดต่อรูปแบบการปลูก แบ่งชำระเป็น 2 งวด ได้แก่ ${p1.name} (${p1.coverage}) และ${p2.name} (${p2.coverage}) แต่ละงวดบวกภาษีมูลค่าเพิ่ม ส่วน${rn.name} (${rn.coverage}) คิดต่อรูปแบบการปลูก ชำระครั้งเดียวบวกภาษีมูลค่าเพิ่ม ${FEES_UNAVAILABLE_TH}`;
  }
  const vat = vatPercentLabel(fees);
  return `ค่าบริการคิดต่อรูปแบบการปลูก แบ่งชำระเป็น 2 งวด ได้แก่ ${p1.name} ${formatBaht(fees.applicationFee)} บาท บวกภาษีมูลค่าเพิ่ม ${vat} ${formatBaht(servedVatPart(fees.applicationFee, fees.phase1TotalPerScope))} บาท รวม ${formatBaht(fees.phase1TotalPerScope)} บาท (${p1.coverage}) และ${p2.name} ${formatBaht(fees.inspectionFee)} บาท บวกภาษีมูลค่าเพิ่ม ${vat} ${formatBaht(servedVatPart(fees.inspectionFee, fees.phase2TotalPerScope))} บาท รวม ${formatBaht(fees.phase2TotalPerScope)} บาท (${p2.coverage}) ส่วน${rn.name} ${formatBaht(fees.renewalFee)} บาท คิดต่อรูปแบบการปลูก ชำระครั้งเดียว บวกภาษีมูลค่าเพิ่ม ${vat} ${formatBaht(servedVatPart(fees.renewalFee, fees.renewalTotalPerScope))} บาท รวม ${formatBaht(fees.renewalTotalPerScope)} บาท (${rn.coverage})`;
}

export const metadata: Metadata = {
  title: 'ข้อกำหนดและเงื่อนไขการใช้บริการ',
  description:
    // Said "ภายใต้กรมการแพทย์แผนไทยฯ": the page itself says the platform is the
    // company's service and only the certificate is the department's (§1-§2),
    // the same endorsement class the footer dropped (audit UXUI-02).
    'ข้อกำหนดและเงื่อนไขการใช้บริการระบบรับรองมาตรฐาน GACP สำหรับเกษตรกรไทย ให้บริการโดยบริษัทผู้ให้บริการแพลตฟอร์ม ใบรับรองออกโดยกรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
  alternates: { canonical: 'https://gacpth.com/terms-of-service' },
};

// 1.1 (operator 2026-10-03, "เพิ่มต่ออายุไปด้วย"): the fee clause now states the
// renewal charge, which every renewal applicant pays but 1.0 never named.
const TERMS_VERSION = '1.1';
const TERMS_EFFECTIVE = '3 ตุลาคม 2569';

const sections = (fees: PublicFees | null) => [
  {
    id: 'definitions',
    title: '1. คำนิยาม',
    body: [
      '"แพลตฟอร์ม" หมายถึง ระบบรับรองมาตรฐาน GACP สมุนไพรไทย ที่ให้บริการผ่านเว็บไซต์ gacpth.com และระบบที่เกี่ยวข้อง',
      '"กรมฯ" หมายถึง กรมการแพทย์แผนไทยและการแพทย์ทางเลือก กระทรวงสาธารณสุข ในฐานะหน่วยงานผู้ออกใบรับรอง',
      '"ผู้ใช้งาน" หมายถึง เกษตรกร นิติบุคคล กลุ่มเกษตรกร หรือบุคคลใดที่ลงทะเบียนเข้าใช้แพลตฟอร์ม',
      `"บริษัท" หมายถึง ${PAYEE_TH} ซึ่งเป็นผู้รับชำระค่าบริการและผู้ออกเอกสารทางการเงินทั้งหมด`,
      '"ใบรับรอง GACP" หมายถึง หนังสือรับรองที่กรมฯ ออกให้แก่ผู้ผ่านการตรวจประเมินตามมาตรฐาน GACP',
    ],
  },
  {
    id: 'service-scope',
    title: '2. ขอบเขตการให้บริการ',
    body: [
      'แพลตฟอร์มให้บริการยื่นคำขอ บันทึกข้อมูลฟาร์มและแปลงปลูก อัปโหลดเอกสารประกอบ ติดตามสถานะคำขอ ชำระค่าบริการ รับผลการตรวจประเมิน และรับใบรับรองในรูปแบบดิจิทัล',
      'การออกใบรับรองเป็นอำนาจหน้าที่ของกรมฯ ตามกฎหมาย แพลตฟอร์มเป็นเครื่องมือสนับสนุนการดำเนินงาน ไม่ใช่ผู้ออกใบรับรอง',
      'ผู้ใช้งานรับทราบว่าผลการตรวจประเมินขึ้นอยู่กับสภาพแปลงปลูก ความสมบูรณ์ของเอกสาร และการพิจารณาของคณะผู้ตรวจตามหลักเกณฑ์ของกรมฯ',
    ],
  },
  {
    id: 'fees',
    title: '3. ค่าบริการและเงื่อนไขการชำระเงิน',
    body: [
      feeClause(fees),
      `ผู้ใช้งานชำระค่าบริการทั้งหมดให้บริษัทเพียงรายเดียว ไม่มียอดใดที่ต้องชำระแยกให้กรมฯ ${PAYMENT_CHANNEL_TH} โดยชำระครั้งเดียวต่องวด`,
      `บริษัทเป็นผู้ออกใบเสนอราคา ใบวางบิล และใบเสร็จรับเงิน/ใบกำกับภาษีเต็มรูปแต่เพียงผู้เดียว ${RECEIPT_TH}`,
      `นโยบายการคืนเงินเป็นไปตามเงื่อนไขการชำระค่าบริการและการคืนเงิน ที่ผู้ใช้งานกดยอมรับก่อนชำระเงินทุกครั้ง โดยสรุปดังนี้ ${REFUND_POLICY_TH.join(' ')} ${REFUND_REQUEST_TH}`,
    ],
  },
  {
    id: 'user-obligations',
    title: '4. หน้าที่และความรับผิดชอบของผู้ใช้งาน',
    body: [
      'ผู้ใช้งานต้องให้ข้อมูลที่ถูกต้อง ครบถ้วน และเป็นปัจจุบันในการลงทะเบียนและยื่นคำขอ',
      'ผู้ใช้งานต้องเก็บรักษาข้อมูลเข้าสู่ระบบ (Username, Password, OTP) เป็นความลับ การกระทำใดที่เกิดขึ้นภายใต้บัญชีของผู้ใช้งานถือเป็นการกระทำของผู้ใช้งานเอง',
      'ห้ามใช้ระบบในลักษณะที่ขัดต่อกฎหมาย ก่อให้เกิดความเสียหายต่อระบบ หรือกระทบความมั่นคงปลอดภัยสารสนเทศ',
      'ผู้ใช้งานต้องให้ความร่วมมือกับเจ้าหน้าที่ตรวจประเมิน เปิดให้เข้าตรวจแปลงปลูกตามวันเวลาที่กำหนด',
    ],
  },
  {
    id: 'liability',
    title: '5. ข้อจำกัดความรับผิดของแพลตฟอร์ม',
    body: [
      'แพลตฟอร์มจะดูแลให้ระบบใช้งานได้อย่างต่อเนื่อง อย่างไรก็ตามอาจมีช่วงเวลาบำรุงรักษาหรือเหตุสุดวิสัยที่ทำให้ระบบไม่สามารถใช้งานชั่วคราว',
      'แพลตฟอร์มไม่รับผิดต่อความเสียหายทางอ้อม ความเสียหายโดยบังเอิญ หรือการสูญเสียโอกาสทางธุรกิจที่เกิดจากการใช้งานระบบ เว้นแต่เป็นการกระทำโดยจงใจหรือประมาทเลินเล่ออย่างร้ายแรง',
      'ผลการตรวจประเมินและการออกใบรับรองเป็นดุลพินิจของกรมฯ แพลตฟอร์มไม่อาจรับประกันว่าคำขอใด ๆ จะต้องผ่านการตรวจประเมิน',
    ],
  },
  {
    id: 'suspension',
    title: '6. การระงับและยกเลิกบัญชี',
    body: [
      'หน่วยงานสามารถระงับบัญชีชั่วคราวหรือถาวรได้หากพบการใช้งานที่ขัดต่อข้อกำหนด การให้ข้อมูลเท็จ หรือพฤติกรรมที่อาจกระทบความมั่นคงปลอดภัยของระบบ',
      'ผู้ใช้งานสามารถขอลบบัญชีได้ผ่านช่องทางที่ระบบกำหนด โดยข้อมูลที่อยู่ภายใต้ระยะเวลาเก็บรักษาตามกฎหมายจะยังคงถูกเก็บไว้ตามที่กฎหมายกำหนด',
    ],
  },
  {
    id: 'changes',
    title: '7. การเปลี่ยนแปลงข้อกำหนด',
    body: [
      'หน่วยงานอาจปรับปรุงข้อกำหนดนี้ตามนโยบายภาครัฐ กฎหมาย หรือข้อกำกับที่มีผลบังคับใช้',
      'การเปลี่ยนแปลงสาระสำคัญจะแจ้งผู้ใช้งานล่วงหน้าไม่น้อยกว่า 30 วันผ่านอีเมลและในระบบ การใช้งานต่อหลังวันที่มีผลบังคับใช้ถือว่ายอมรับข้อกำหนดฉบับใหม่',
    ],
  },
  {
    id: 'dispute',
    title: '8. กฎหมายที่ใช้บังคับและเขตอำนาจศาล',
    body: [
      'ข้อกำหนดและเงื่อนไขนี้อยู่ภายใต้กฎหมายของราชอาณาจักรไทย',
      'กรณีเกิดข้อพิพาทจะให้พยายามไกล่เกลี่ยโดยสันติวิธีเป็นลำดับแรก หากไม่สามารถตกลงกันได้ ให้นำคดีขึ้นพิจารณาในศาลปกครองหรือศาลที่มีเขตอำนาจตามกฎหมายไทย',
    ],
  },
  {
    id: 'contact',
    title: '9. ช่องทางติดต่อ',
    body: [
      'หากมีข้อสงสัยเกี่ยวกับข้อกำหนดและเงื่อนไขนี้ สามารถติดต่อกรมการแพทย์แผนไทยและการแพทย์ทางเลือก ที่อีเมล contact@gacpth.com หรือโทร 0-2591-7007 ในวันและเวลาราชการ',
    ],
  },
];

// Rendered per request. A segment `revalidate` made Next prerender this page at
// `docker build`, where no backend runs, so the image shipped the no-number
// fallback as a cached page (staging/demo 2026-10-03). The fee fetch itself is
// still cached for PRICING_REVALIDATE_SECONDS. Pinned by fees-from-server.test.tsx.
export const dynamic = 'force-dynamic';

export default async function TermsOfServicePage() {
  const fees = await fetchPublicFees();
  const sectionList = sections(fees);
  return (
    <>
      <section
        aria-labelledby="tos-hero"
        className="bg-primary-50 dark:bg-zinc-950"
      >
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
          <p className="mb-2 text-xs font-semibold text-primary-700 dark:text-primary-300">
            เอกสารทางสัญญา
          </p>
          <h1 id="tos-hero" className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl md:text-5xl">
            ข้อกำหนดและเงื่อนไขการใช้บริการ
          </h1>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600 dark:text-zinc-300">
            <div className="flex gap-2">
              <dt className="font-semibold">เวอร์ชัน:</dt>
              <dd>{TERMS_VERSION}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold">วันที่มีผลบังคับใช้:</dt>
              <dd>{TERMS_EFFECTIVE}</dd>
            </div>
          </dl>
          <p className="mt-4 max-w-3xl text-base text-zinc-600 dark:text-zinc-300">
            กรุณาอ่านข้อกำหนดและเงื่อนไขฉบับนี้โดยละเอียดก่อนใช้บริการ การลงทะเบียนหรือใช้งานแพลตฟอร์มถือว่าผู้ใช้งานยอมรับข้อกำหนดและเงื่อนไขทั้งหมดที่ระบุไว้
          </p>
        </div>
      </section>

      <section
        aria-label="สารบัญข้อกำหนด"
        className="border-y border-primary-100 bg-white dark:border-primary-900/40 dark:bg-zinc-950"
      >
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
          <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">สารบัญ</h2>
          <ol className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {sectionList.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-primary-700 underline hover:text-primary-800 dark:text-primary-300">
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 md:py-16 lg:px-0">
        {sectionList.map((section) => (
          <section key={section.id} id={section.id} className="mb-10 scroll-mt-24">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 sm:text-2xl">{section.title}</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-base leading-7 text-zinc-700 dark:text-zinc-200">
              {section.body.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ol>
          </section>
        ))}

        <aside className="mt-12 rounded-2xl border border-primary-100 bg-primary-50/60 p-6 dark:border-primary-900/40 dark:bg-primary-900/20">
          <h2 className="text-base font-semibold text-primary-900 dark:text-primary-100">เอกสารอ้างอิงที่เกี่ยวข้อง</h2>
          <ul className="mt-3 space-y-1 text-sm">
            <li>
              <Link href="/privacy-policy" className="text-primary-700 underline hover:text-primary-800 dark:text-primary-300">
                นโยบายความเป็นส่วนตัว
              </Link>
            </li>
            <li>
              <Link href="/pricing" className="text-primary-700 underline hover:text-primary-800 dark:text-primary-300">
                ค่าบริการการรับรอง
              </Link>
            </li>
            <li>
              <Link href="/about" className="text-primary-700 underline hover:text-primary-800 dark:text-primary-300">
                เกี่ยวกับเรา และช่องทางติดต่อ
              </Link>
            </li>
          </ul>
        </aside>
      </article>
    </>
  );
}
