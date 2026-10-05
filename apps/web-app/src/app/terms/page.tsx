export const dynamic = 'force-dynamic';

import Image from 'next/image';
import Link from 'next/link';
import { Footer } from '@/components/layout/Footer';

const TERMS_UPDATED_AT = '26 กุมภาพันธ์ 2026';

const TERMS_SECTIONS = [
  {
    title: '1. ขอบเขตการใช้งาน',
    details: [
      'ระบบนี้เป็นระบบอิเล็กทรอนิกส์เพื่อยื่นคำขอ ติดตามผล และจัดการข้อมูลที่เกี่ยวข้องกับงานรับรองมาตรฐาน GACP ของระบบรับรองมาตรฐาน GACP สมุนไพร',
      'ผู้ใช้งานต้องใช้ข้อมูลจริงและข้อมูลที่เป็นปัจจุบันในการสมัครสมาชิกและการใช้งานระบบ',
      'หน่วยงานอาจปรับปรุงกระบวนการทำงานหรือแบบฟอร์มในระบบเพื่อให้สอดคล้องกับข้อกำหนดของภาครัฐ',
    ],
  },
  {
    title: '2. หน้าที่ของผู้ใช้งาน',
    details: [
      'ผู้ใช้งานต้องเก็บรักษาข้อมูลเข้าสู่ระบบเป็นความลับและรับผิดชอบการใช้งานภายใต้บัญชีของตน',
      'ห้ามนำระบบไปใช้ในลักษณะที่ขัดต่อกฎหมาย ก่อให้เกิดความเสียหาย หรือกระทบต่อความมั่นคงปลอดภัยของระบบ',
      'ผู้ใช้งานต้องยินยอมให้ตรวจสอบข้อมูลที่เกี่ยวข้องเมื่อมีเหตุจำเป็นด้านความปลอดภัยหรือการกำกับดูแล',
    ],
  },
  {
    title: '3. การระงับหรือยกเลิกการใช้งาน',
    details: [
      'หน่วยงานสามารถระงับการใช้งานชั่วคราวหรือถาวรได้ หากพบการใช้งานที่ผิดเงื่อนไขหรือมีความเสี่ยงด้านความปลอดภัย',
      'การระงับการใช้งานจะดำเนินการตามหลักเกณฑ์ที่เกี่ยวข้อง และอาจมีการแจ้งเหตุผลให้ผู้ใช้งานทราบ',
    ],
  },
  {
    title: '4. การเปลี่ยนแปลงเงื่อนไข',
    details: [
      'หน่วยงานอาจปรับปรุงข้อกำหนดและเงื่อนไขการใช้งานตามนโยบายภาครัฐ กฎหมาย หรือข้อกำกับที่มีผลบังคับใช้',
      'เมื่อมีการเปลี่ยนแปลงสาระสำคัญ ระบบจะแสดงวันที่ปรับปรุงล่าสุดเพื่อให้ผู้ใช้งานรับทราบ',
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="gov-doc-page">
      <header className="gov-auth-header">
        <div className="gov-auth-header-inner">
          <div className="flex items-center gap-3">
            <div className="gov-auth-brand-mark" aria-hidden="true">
              <Image
                src="/images/gacpthai-logo.png"
                alt=""
                width={56}
                height={56}
                className="gov-auth-brand-logo"
                priority
              />
            </div>
            <div>
              <p className="gov-auth-brand-title">GACP Registration Portal</p>
              <p className="gov-auth-brand-subtitle">กรมการแพทย์แผนไทยและการแพทย์ทางเลือก, กระทรวงสาธารณสุข</p>
            </div>
          </div>
          <Link href="/register" className="gov-auth-link text-sm">
            กลับหน้าสมัครสมาชิก
          </Link>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 md:px-8 lg:py-12 xl:py-9">
        <section className="gov-auth-panel animate-fade-in-up">
          <h1 className="text-xl font-semibold text-foreground transition-colors duration-200 sm:text-2xl lg:text-3xl">ข้อกำหนดและเงื่อนไขการใช้งานระบบ</h1>
          <p className="mt-2 text-sm text-foreground">
            ใช้สำหรับการสมัครสมาชิกและใช้งานระบบรับรองมาตรฐาน GACP ของระบบรับรองมาตรฐาน GACP สมุนไพร
          </p>
          <p className="mt-1 text-xs text-muted-foreground">ปรับปรุงล่าสุด: {TERMS_UPDATED_AT}</p>

          <div className="mt-6 space-y-5">
            {TERMS_SECTIONS.map((section) => (
              <section key={section.title} className="gov-auth-panel-muted group transition-shadow duration-200 hover:shadow-md">
                <h2 className="text-sm font-semibold text-foreground group-hover:text-primary sm:text-base">{section.title}</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-foreground">
                  {section.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link href="/privacy" className="gov-auth-primary-btn transition-transform duration-150 hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-primary" aria-label="อ่านนโยบายความเป็นส่วนตัว">
              อ่านนโยบายความเป็นส่วนตัว
            </Link>
            <Link href="/auth/health/login" className="gov-auth-link text-sm transition-colors duration-150 hover:text-primary" aria-label="ไปหน้าเข้าสู่ระบบ">
              ไปหน้าเข้าสู่ระบบ
            </Link>
          </div>
        </section>
      </main>

      <Footer />{/* Phase A5 §4.2 — replaces ad-hoc gov-auth-footer */}
    </div>
  );
}
