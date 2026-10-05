/**
 * Privacy Policy — Iter 28 marketing site.
 *
 * PDPA-compliant privacy notice. Structured around the disclosure
 * requirements of the Thai Personal Data Protection Act B.E. 2562
 * (2019) section 23: identity of controller, purposes, lawful basis,
 * categories of data, recipients, retention period, data subject
 * rights, contact for DPO.
 *
 * Replaces (does not delete) the older /privacy shortcut page which now
 * serves a shorter summary inside the registration flow.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'นโยบายความเป็นส่วนตัว (PDPA)',
  description:
    'นโยบายความเป็นส่วนตัวของระบบรับรอง GACP สมุนไพรไทย ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 ครอบคลุมประเภทข้อมูล ฐานทางกฎหมาย ระยะเวลาเก็บรักษา และสิทธิเจ้าของข้อมูล',
  alternates: { canonical: 'https://gacpth.com/privacy-policy' },
};

// Changelog:
//   v1.2 (27 ก.ย. 2569) — MAJOR: removed the former §7 "การส่งหรือโอนข้อมูลไป
//     ต่างประเทศ" entirely (operator ruling 2026-09-27) — it claimed all data
//     stays in Thailand with no cross-border transfer, which is false now
//     that the platform sends payment data to a payment provider abroad, and
//     its remaining sentence promised advance notice of a future transfer
//     that was not being kept. Sections formerly 8-13 renumbered to 7-12.
//   v1.1 (29 มิ.ย. 2569) — MINOR: §11 corrected to stop claiming "Encryption at
//     Rest" for stored personal data (PDPA field-level encryption is not yet
//     enabled in production); now states the verifiable TLS-in-transit + access
//     controls + field-encryption in development.
//   v1.0 (16 พ.ค. 2569) — initial PDPA notice.
const POLICY_VERSION = '1.2';
const POLICY_EFFECTIVE = '27 กันยายน 2569';

const SECTIONS = [
  {
    id: 'controller',
    title: '1. ผู้ควบคุมข้อมูลส่วนบุคคล',
    body: [
      'ผู้ควบคุมข้อมูลส่วนบุคคลคือ กรมการแพทย์แผนไทยและการแพทย์ทางเลือก กระทรวงสาธารณสุข ในฐานะหน่วยงานผู้รับผิดชอบระบบรับรองมาตรฐาน GACP',
      'ที่อยู่: 88/23 หมู่ 4 ตำบลตลาดขวัญ อำเภอเมืองนนทบุรี จังหวัดนนทบุรี 11000',
      'อีเมล: contact@gacpth.com · โทรศัพท์: 0-2591-7007',
    ],
  },
  {
    id: 'purpose',
    title: '2. วัตถุประสงค์การเก็บ ใช้ และเปิดเผยข้อมูล',
    body: [
      'เพื่อการยืนยันตัวตน การลงทะเบียนสมาชิก และการให้บริการตามกระบวนการรับรองมาตรฐาน GACP',
      'เพื่อการรับชำระค่าธรรมเนียม ออกใบเสร็จและใบกำกับภาษีอิเล็กทรอนิกส์ และปฏิบัติตามกฎหมายภาษีอากร',
      'เพื่อการตรวจประเมินภาคสนาม การออกใบรับรอง และการเปิดเผยข้อมูลใบรับรองสาธารณะผ่านระบบตรวจสอบ QR Code',
      'เพื่อการสื่อสาร แจ้งสถานะคำขอ และให้การสนับสนุนผู้ใช้งานทางเทคนิค',
      'เพื่อการรักษาความมั่นคงปลอดภัยของระบบ การป้องกันการทุจริต และการตรวจสอบย้อนหลังตามกฎหมาย',
    ],
  },
  {
    id: 'lawful-basis',
    title: '3. ฐานทางกฎหมายในการประมวลผลข้อมูล',
    body: [
      'ความยินยอม (มาตรา 19 พ.ร.บ. PDPA): สำหรับการรับข่าวสารและการสื่อสารทางการตลาด ซึ่งผู้ใช้งานสามารถถอนความยินยอมได้ทุกเมื่อ',
      'การปฏิบัติตามสัญญา (มาตรา 24(3)): สำหรับการดำเนินการตามคำขอรับรอง และการรับชำระค่าธรรมเนียม',
      'หน้าที่ตามกฎหมาย (มาตรา 24(6)): สำหรับการออกใบกำกับภาษี การเก็บข้อมูลทางการเงินตามกฎหมายภาษี และการเปิดเผยข้อมูลตามคำสั่งทางราชการ',
      'ประโยชน์โดยชอบด้วยกฎหมาย (มาตรา 24(5)): สำหรับการรักษาความมั่นคงปลอดภัยของระบบและการป้องกันการทุจริต',
      'ภารกิจของรัฐ (มาตรา 24(4)): สำหรับการออกใบรับรองตามอำนาจหน้าที่ของกรมการแพทย์แผนไทยฯ',
    ],
  },
  {
    id: 'data-categories',
    title: '4. ประเภทข้อมูลที่จัดเก็บ',
    body: [
      'ข้อมูลระบุตัวตน: ชื่อ-นามสกุล เลขประจำตัวประชาชน เลขทะเบียนนิติบุคคล วันเดือนปีเกิด',
      'ข้อมูลติดต่อ: ที่อยู่ เบอร์โทรศัพท์ อีเมล',
      'ข้อมูลทางเทคนิค: IP Address อุปกรณ์ ระบบปฏิบัติการ และ User Agent ที่ใช้เข้าถึงระบบ',
      'ข้อมูลฟาร์มและแปลงปลูก: พิกัด GPS ขนาดพื้นที่ ชนิดสมุนไพร เอกสารสิทธิ์ในที่ดิน รูปถ่ายแปลง',
      'ข้อมูลการชำระเงิน: หมายเลขอ้างอิงการโอน ใบเสร็จ และใบกำกับภาษี (ระบบไม่จัดเก็บหมายเลขบัตรเครดิตเต็มจำนวน)',
      'ข้อมูลผลการตรวจประเมิน: รายงานผลตรวจ คำสั่งให้แก้ไข (CAR) สถานะใบรับรอง',
    ],
  },
  {
    id: 'sensitive-data',
    title: '5. ข้อมูลส่วนบุคคลที่อ่อนไหว',
    body: [
      'โดยปกติระบบไม่จัดเก็บข้อมูลส่วนบุคคลที่อ่อนไหวตามมาตรา 26 พ.ร.บ. PDPA',
      'ระบบจะร้องขอข้อมูลที่อ่อนไหวก็ต่อเมื่อจำเป็นต่อกระบวนการตรวจประเมิน และจะดำเนินการเฉพาะเมื่อได้รับความยินยอมโดยชัดแจ้งจากเจ้าของข้อมูลเท่านั้น',
    ],
  },
  {
    id: 'recipients',
    title: '6. ผู้รับข้อมูลส่วนบุคคล',
    body: [
      'เจ้าหน้าที่กรมการแพทย์แผนไทยและการแพทย์ทางเลือก ที่มีอำนาจหน้าที่เกี่ยวข้องกับการตรวจประเมินและออกใบรับรอง',
      'ผู้ให้บริการรับชำระเงิน (Payment Gateway) ที่ผ่านมาตรฐาน PCI-DSS เพื่อประมวลผลการชำระค่าธรรมเนียม',
      'หน่วยงานภาครัฐที่มีอำนาจตามกฎหมาย เช่น กรมสรรพากร ในกรณีที่กฎหมายกำหนดให้ต้องเปิดเผย',
      'สาธารณชนผ่านระบบตรวจสอบใบรับรอง QR Code โดยเปิดเผยเฉพาะข้อมูลที่จำเป็นต่อการยืนยันสถานะใบรับรอง',
    ],
  },
  {
    id: 'retention',
    title: '7. ระยะเวลาจัดเก็บข้อมูล',
    body: [
      'ข้อมูลบัญชีผู้ใช้งานและข้อมูลทั่วไป: จัดเก็บตลอดระยะเวลาที่ผู้ใช้งานยังคงเป็นสมาชิก และอีก 1 ปีหลังจากปิดบัญชี',
      'ข้อมูลทางการเงินและภาษี (ใบเสร็จ ใบกำกับภาษี): จัดเก็บไม่น้อยกว่า 7 ปี ตามประมวลรัษฎากร',
      'ข้อมูลใบรับรองและผลการตรวจประเมิน: จัดเก็บไม่น้อยกว่า 10 ปีนับจากวันสิ้นอายุใบรับรอง เพื่อการตรวจสอบย้อนหลัง',
      'บันทึกความปลอดภัย (Security Logs): จัดเก็บ 1 ปีตามแนวปฏิบัติด้านความมั่นคงปลอดภัยสารสนเทศ',
      'เมื่อพ้นระยะเวลาที่กำหนด ระบบจะดำเนินการลบหรือทำให้ข้อมูลไม่สามารถระบุตัวบุคคลได้ (Anonymization)',
    ],
  },
  {
    id: 'rights',
    title: '8. สิทธิของเจ้าของข้อมูลส่วนบุคคล',
    body: [
      'สิทธิในการเข้าถึงข้อมูล (Right to Access): ขอสำเนาข้อมูลส่วนบุคคลของท่านที่ระบบจัดเก็บไว้',
      'สิทธิในการแก้ไขให้ถูกต้อง (Right to Rectification): ขอแก้ไขข้อมูลที่ไม่ถูกต้องหรือไม่เป็นปัจจุบัน',
      'สิทธิในการลบข้อมูล (Right to Erasure): ขอให้ลบข้อมูล เว้นแต่ข้อมูลที่อยู่ภายใต้กฎหมายซึ่งกำหนดให้ต้องจัดเก็บ',
      'สิทธิในการระงับการใช้ข้อมูล (Right to Restrict Processing): ขอให้ระงับการใช้ข้อมูลชั่วคราว',
      'สิทธิในการคัดค้านการประมวลผล (Right to Object): คัดค้านการประมวลผลข้อมูลที่อาศัยฐานประโยชน์โดยชอบด้วยกฎหมาย',
      'สิทธิในการขอโอนย้ายข้อมูล (Right to Data Portability): ขอรับข้อมูลในรูปแบบที่สามารถอ่านได้ด้วยเครื่อง',
      'สิทธิในการถอนความยินยอม (Right to Withdraw Consent): ถอนความยินยอมที่ให้ไว้ได้ทุกเมื่อ การถอนไม่กระทบความถูกต้องของการประมวลผลก่อนหน้านี้',
      'สิทธิในการร้องเรียน (Right to Lodge a Complaint): ร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (PDPC) หากเห็นว่าสิทธิของท่านถูกละเมิด',
    ],
  },
  {
    id: 'cookies',
    title: '9. การใช้คุกกี้และเทคโนโลยีติดตาม',
    body: [
      'ระบบใช้คุกกี้ที่จำเป็นสำหรับการล็อกอิน การรักษาสถานะ Session และการรักษาความปลอดภัยของระบบเท่านั้น',
      'ระบบไม่ใช้คุกกี้บุคคลที่สามเพื่อโฆษณาหรือการตลาด ผู้ใช้งานสามารถลบหรือปิดคุกกี้ผ่านการตั้งค่าเบราว์เซอร์ได้ แต่บางฟังก์ชันอาจใช้งานไม่ได้',
    ],
  },
  {
    id: 'security',
    title: '10. มาตรการรักษาความมั่นคงปลอดภัย',
    body: [
      'ข้อมูลถูกเข้ารหัสขณะรับส่งผ่านเครือข่ายด้วย TLS 1.2 ขึ้นไป (Encryption in Transit) ทุกการเชื่อมต่อ',
      'การเข้าถึงข้อมูลของเจ้าหน้าที่ใช้หลักการสิทธิ์ขั้นต่ำ (Principle of Least Privilege) และมีการบันทึก Audit Log',
      'ใช้การยืนยันตัวตนสองปัจจัย (Two-Factor Authentication) สำหรับเจ้าหน้าที่ตรวจประเมินและผู้ดูแลระบบ',
      'มีการประเมินความเสี่ยงและตรวจสอบช่องโหว่ระบบอย่างสม่ำเสมอตามมาตรฐาน ISO/IEC 27001',
      'ระบบอยู่ระหว่างการพัฒนาการเข้ารหัสข้อมูลส่วนบุคคลที่มีความอ่อนไหวเป็นรายฟิลด์ (Field-Level Encryption) เช่น เลขประจำตัวประชาชน และจะปรับปรุงนโยบายฉบับนี้ให้สอดคล้องเมื่อเปิดใช้งานจริง',
    ],
  },
  {
    id: 'dpo',
    title: '11. เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO)',
    body: [
      'ผู้ใช้งานสามารถติดต่อเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (Data Protection Officer) เพื่อใช้สิทธิหรือสอบถามข้อมูล',
      'อีเมล DPO: contact@gacpth.com (หัวข้อ: "PDPA สิทธิเจ้าของข้อมูล")',
      'ระบบจะตอบกลับคำร้องขอใช้สิทธิภายใน 30 วันนับจากวันที่ได้รับคำร้องที่ครบถ้วน',
    ],
  },
  {
    id: 'updates',
    title: '12. การปรับปรุงนโยบาย',
    body: [
      'นโยบายความเป็นส่วนตัวฉบับนี้อาจปรับปรุงตามกฎหมาย หลักเกณฑ์ของ PDPC หรือแนวปฏิบัติของหน่วยงาน',
      'การเปลี่ยนแปลงสาระสำคัญจะแจ้งให้ทราบผ่านอีเมลและประกาศในระบบล่วงหน้าไม่น้อยกว่า 30 วันก่อนวันที่มีผลบังคับใช้',
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <>
      <section
        aria-labelledby="pp-hero"
        className="bg-primary-50 dark:bg-zinc-950"
      >
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
          <p className="mb-2 text-xs font-semibold text-primary-700 dark:text-primary-300">
            PDPA · พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล
          </p>
          <h1 id="pp-hero" className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl md:text-5xl">
            นโยบายความเป็นส่วนตัว
          </h1>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600 dark:text-zinc-300">
            <div className="flex gap-2">
              <dt className="font-semibold">เวอร์ชัน:</dt>
              <dd>{POLICY_VERSION}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold">วันที่มีผลบังคับใช้:</dt>
              <dd>{POLICY_EFFECTIVE}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold">อ้างอิง:</dt>
              <dd>พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (มาตรา 23)</dd>
            </div>
          </dl>
          <p className="mt-4 max-w-3xl text-base text-zinc-600 dark:text-zinc-300">
            นโยบายฉบับนี้อธิบายแนวทางการเก็บ ใช้ เปิดเผย และคุ้มครองข้อมูลส่วนบุคคลของผู้ใช้งานระบบรับรองมาตรฐาน GACP
            ตามที่กำหนดในพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
          </p>
        </div>
      </section>

      <section
        aria-label="สารบัญนโยบาย"
        className="border-y border-primary-100 bg-white dark:border-primary-900/40 dark:bg-zinc-950"
      >
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
          <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">สารบัญ</h2>
          <ol className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {SECTIONS.map((section) => (
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
        {SECTIONS.map((section) => (
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
          <h2 className="text-base font-semibold text-primary-900 dark:text-primary-100">การใช้สิทธิเจ้าของข้อมูล</h2>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
            หากต้องการใช้สิทธิตามมาตรา 30–37 พ.ร.บ. PDPA ให้ส่งคำร้องพร้อมเอกสารยืนยันตัวตนมาที่อีเมล{' '}
            <a className="text-primary-700 underline" href="mailto:contact@gacpth.com">contact@gacpth.com</a>{' '}
            ระบบจะตอบกลับภายใน 30 วันนับจากวันที่ได้รับคำร้องที่ครบถ้วน
          </p>
          <ul className="mt-4 space-y-1 text-sm">
            <li>
              <Link href="/terms-of-service" className="text-primary-700 underline hover:text-primary-800 dark:text-primary-300">
                ข้อกำหนดและเงื่อนไขการใช้บริการ
              </Link>
            </li>
            <li>
              <Link href="/about" className="text-primary-700 underline hover:text-primary-800 dark:text-primary-300">
                เกี่ยวกับเราและช่องทางติดต่อ
              </Link>
            </li>
          </ul>
        </aside>
      </article>
    </>
  );
}
