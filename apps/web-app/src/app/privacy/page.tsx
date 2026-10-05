export const dynamic = 'force-dynamic';

import Image from 'next/image';
import Link from 'next/link';
import { Footer } from '@/components/layout/Footer';

const PRIVACY_UPDATED_AT = '26 กุมภาพันธ์ 2026';

const PRIVACY_SECTIONS = [
  {
    title: '1. วัตถุประสงค์การเก็บข้อมูล',
    details: [
      'ใช้เพื่อยืนยันตัวตนผู้ใช้งาน จัดการบัญชีสมาชิก และให้บริการตามกระบวนการรับรองมาตรฐาน GACP',
      'ใช้เพื่อการติดต่อสื่อสาร การแจ้งผลการดำเนินงาน และการสนับสนุนการใช้งานระบบ',
      'ใช้เพื่อความมั่นคงปลอดภัย การตรวจสอบย้อนหลัง และการป้องกันการใช้งานที่ไม่เหมาะสม',
    ],
  },
  {
    title: '2. ประเภทข้อมูลที่จัดเก็บ',
    details: [
      'ข้อมูลระบุตัวตน เช่น เลขประจำตัวประชาชนหรือเลขทะเบียนนิติบุคคล ตามประเภทบัญชี',
      'ข้อมูลติดต่อ เช่น เบอร์โทรศัพท์ อีเมล และข้อมูลบัญชีผู้ใช้งาน',
      'ข้อมูลการใช้งานระบบ เช่น เวลาการเข้าใช้งาน อุปกรณ์ และบันทึกเหตุการณ์ด้านความปลอดภัย',
    ],
  },
  {
    title: '3. การคุ้มครองและระยะเวลาจัดเก็บ',
    details: [
      'ข้อมูลส่วนบุคคลได้รับการคุ้มครองตามมาตรการด้านความมั่นคงปลอดภัยสารสนเทศที่เหมาะสม',
      'จัดเก็บข้อมูลเท่าที่จำเป็นตามวัตถุประสงค์และระยะเวลาที่กำหนดโดยกฎหมายหรือข้อกำกับภาครัฐ',
      'เมื่อพ้นระยะเวลาจัดเก็บ ระบบจะดำเนินการลบหรือทำให้ข้อมูลไม่สามารถระบุตัวบุคคลได้ตามนโยบาย',
    ],
  },
  {
    title: '4. สิทธิของเจ้าของข้อมูลส่วนบุคคล',
    details: [
      'ผู้ใช้งานสามารถขอเข้าถึง ขอแก้ไข หรือขอจำกัดการใช้ข้อมูลส่วนบุคคลได้ตามสิทธิที่กฎหมายกำหนด',
      'การใช้สิทธิอาจต้องยืนยันตัวตนและพิจารณาตามข้อยกเว้นที่กฎหมายอนุญาต',
      'กรณีต้องการสอบถามเพิ่มเติม สามารถติดต่อหน่วยงานเจ้าของระบบผ่านช่องทางราชการที่ประกาศ',
    ],
  },
];

export default function PrivacyPage() {
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
          <h1 className="text-xl font-semibold text-foreground transition-colors duration-200 sm:text-2xl lg:text-3xl">นโยบายความเป็นส่วนตัว</h1>
          <p className="mt-2 text-sm text-foreground">
            นโยบายนี้อธิบายแนวทางการเก็บ ใช้ เปิดเผย และคุ้มครองข้อมูลส่วนบุคคลของผู้ใช้งานระบบรับรองมาตรฐาน GACP
          </p>
          <p className="mt-1 text-xs text-muted-foreground">ปรับปรุงล่าสุด: {PRIVACY_UPDATED_AT}</p>

          <div className="mt-6 space-y-5">
            {PRIVACY_SECTIONS.map((section) => (
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
            <Link href="/terms" className="gov-auth-primary-btn transition-transform duration-150 hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-primary" aria-label="อ่านข้อกำหนดการใช้งาน">
              อ่านข้อกำหนดการใช้งาน
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
