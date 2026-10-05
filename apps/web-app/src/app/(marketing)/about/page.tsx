/**
 * About page — Iter 28 marketing site.
 *
 * Explains what the GACP Thailand platform is: a GACP certification system for
 * Thai herbs, still in development and testing. The funding acknowledgment is
 * fixed by the funder's clause 14 and pinned verbatim by
 * __tests__/funding-acknowledgment.test.tsx. Operator 2026-10-03: no wording that
 * concedes a delivery duty, a commission for a named agency, or a contract output.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingSection, MarketingCard } from '@/components/marketing/marketing-section';
import { MINISTRY_CONTACT } from '@/lib/ministry-contact';
import { FUNDING_ACKNOWLEDGMENT, PROJECT_STATUS } from '@/lib/project-info';

export const metadata: Metadata = {
  title: 'เกี่ยวกับเรา',
  description:
    'ระบบสำหรับการรับรองมาตรฐาน GACP ของสมุนไพรไทย อยู่ระหว่างการพัฒนาและทดสอบ ยังไม่เปิดให้บริการจริง',
  alternates: { canonical: 'https://gacpth.com/about' },
};

const PARTNERS = [
  {
    title: 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
    description:
      'ระบบสำหรับการรับรองมาตรฐาน GACP ของสมุนไพรไทย ตามหลักเกณฑ์ของกรมการแพทย์แผนไทยและการแพทย์ทางเลือก กระทรวงสาธารณสุข',
    badge: 'หน่วยงานกำกับมาตรฐาน',
  },
  {
    title: 'ทุนวิจัย บพข.',
    description:
      'หน่วยบริหารและจัดการทุนด้านการเพิ่มความสามารถในการแข่งขันของประเทศ (บพข.) สนับสนุนทุนจากกองทุนส่งเสริมวิทยาศาสตร์ วิจัยและนวัตกรรม (กองทุน ววน.)',
    badge: 'แหล่งทุน',
  },
];

const MISSION_POINTS = [
  {
    title: 'ยกระดับสมุนไพรไทยสู่สากล',
    description:
      'สร้างมาตรฐานเดียวกันทั่วประเทศ ทำให้ผลผลิตสมุนไพรไทยมีคุณภาพสม่ำเสมอและตรวจสอบย้อนกลับได้',
  },
  {
    title: 'ลดต้นทุนและเวลาให้เกษตรกร',
    description:
      'ลดขั้นตอนเอกสารกระดาษ ตัดการเดินทาง และเปิดให้ติดตามสถานะการรับรองได้ทุกขั้นตอนผ่านระบบออนไลน์',
  },
  {
    title: 'โปร่งใส ตรวจสอบได้',
    description:
      'ใบรับรองทุกฉบับมี QR Code ผู้ซื้อ ผู้นำเข้า และผู้บริโภคสามารถตรวจสอบความถูกต้องได้สาธารณะ',
  },
];

export default function AboutPage() {
  return (
    <>
      <section
        aria-labelledby="about-hero"
        className="bg-primary-50 dark:bg-zinc-950"
      >
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 md:py-20 lg:px-8">
          <p className="mb-2 text-xs font-semibold text-primary-700 dark:text-primary-300">
            เกี่ยวกับเรา
          </p>
          <h1 id="about-hero" className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl md:text-5xl">
            พันธมิตรเพื่อมาตรฐานสมุนไพรไทย
          </h1>
          <p className="mt-4 max-w-3xl text-base text-zinc-600 dark:text-zinc-300 sm:text-lg">
            GACP Thailand พัฒนาขึ้นเพื่อให้กระบวนการรับรองมาตรฐานสมุนไพรไทยเป็นเรื่องที่
            เกษตรกรทุกคนเข้าถึงได้
          </p>
          <p
            role="note"
            className="mt-4 max-w-3xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
          >
            {PROJECT_STATUS}
          </p>
        </div>
      </section>

      <MarketingSection
        id="partners"
        eyebrow="เกี่ยวกับโครงการ"
        title="ที่มาของระบบ"
        description="มาตรฐานที่ระบบรองรับ และแหล่งทุนสนับสนุนโครงการ"
      >
        <div className="grid gap-6 md:grid-cols-2">
          {PARTNERS.map((partner) => (
            <MarketingCard
              key={partner.title}
              title={partner.title}
              description={partner.description}
              badge={partner.badge}
            />
          ))}
        </div>
        <p className="mt-6 text-sm text-zinc-700 dark:text-zinc-300">{FUNDING_ACKNOWLEDGMENT}</p>
      </MarketingSection>

      <div className="bg-primary-50/40 dark:bg-primary-900/20">
        <MarketingSection
          id="mission"
          eyebrow="พันธกิจ"
          title="พันธกิจของเรา"
          description="สามเป้าหมายที่ทีมงานยึดเป็นกรอบในการพัฒนาแพลตฟอร์ม"
        >
          <div className="grid gap-6 md:grid-cols-3">
            {MISSION_POINTS.map((item) => (
              <MarketingCard key={item.title} title={item.title} description={item.description} />
            ))}
          </div>
        </MarketingSection>
      </div>

      <MarketingSection
        id="about-contact"
        eyebrow="ช่องทางติดต่อ"
        title="ติดต่อเจ้าหน้าที่กรมฯ"
        description="สำหรับคำถามเชิงนโยบาย กระบวนการรับรอง หรือสิทธิผู้ใช้งาน"
      >
        <div className="rounded-2xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-zinc-900">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">หน่วยงาน</dt>
              <dd className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{MINISTRY_CONTACT.ministry}</dd>
              <dd className="text-xs text-zinc-500 dark:text-zinc-400" lang="en">{MINISTRY_CONTACT.ministryEn}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">ที่อยู่</dt>
              <dd className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{MINISTRY_CONTACT.address}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">โทรศัพท์</dt>
              <dd className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{MINISTRY_CONTACT.phone}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">อีเมล</dt>
              <dd className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{MINISTRY_CONTACT.email}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">เว็บไซต์</dt>
              <dd className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                <a
                  href={MINISTRY_CONTACT.website}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded text-primary-700 underline hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 dark:text-primary-300"
                  aria-label={`${MINISTRY_CONTACT.website} (เปิดในแท็บใหม่)`}
                >
                  {MINISTRY_CONTACT.website}
                </a>
              </dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
            >
              เริ่มสมัครใช้งาน
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-md border border-primary-300 px-4 py-2 font-semibold text-primary-800 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:border-primary-700 dark:text-primary-200 dark:hover:bg-primary-900/30"
            >
              ดูค่าบริการ
            </Link>
          </div>
        </div>
      </MarketingSection>
    </>
  );
}
