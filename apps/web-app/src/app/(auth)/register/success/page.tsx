'use client';


import { Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { IconCheck, IconChevronRight, IconShieldCheck } from '@tabler/icons-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { Footer } from '@/components/layout/Footer';

const COPY = {
  th: {
    brandTitle: 'GACP Registration',
    brandSubtitle:
      'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก, กระทรวงสาธารณสุข',
    switchLang: 'EN',
    heroTitle: 'ยินดีต้อนรับสู่ระบบ GACP',
    heroSubtitle: 'การลงทะเบียนของท่านเสร็จสมบูรณ์แล้ว สามารถเริ่มใช้งานได้ทันที',
    heroFeature1: 'ยื่นคำขอรับรองมาตรฐาน GACP',
    heroFeature2: 'ติดตามสถานะเอกสารแบบเรียลไทม์',
    heroFeature3: 'เข้าถึงบริการภาครัฐอย่างปลอดภัย',
    securityBadge: 'ลงทะเบียนสำเร็จ',
    title: 'ลงทะเบียนสำเร็จ',
    subtitle: 'สามารถเข้าสู่ระบบเพื่อเริ่มยื่นคำขอรับรองมาตรฐาน GACP ได้ทันที',
    accountType: 'ประเภทบัญชี',
    accountTypeValue: 'บุคคล/Health ID',
    registrantName: 'ชื่อผู้ลงทะเบียน',
    accountReference: 'เลขอ้างอิงบัญชี',
    accountReferenceValue: 'ใช้เลขประจำตัวที่ลงทะเบียนไว้เพื่อเข้าสู่ระบบ',
    securityNotice:
      'โปรดยืนยันข้อมูลบัญชีให้ครบถ้วนหลังเข้าสู่ระบบ และเก็บข้อมูลเข้าสู่ระบบไว้เป็นความลับ',
    goToLogin: 'ไปหน้าเข้าสู่ระบบ',
    loading: 'กำลังโหลด...',
  },
  en: {
    brandTitle: 'GACP Registration',
    brandSubtitle:
      'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก, กระทรวงสาธารณสุข',
    switchLang: 'TH',
    heroTitle: 'Welcome to GACP',
    heroSubtitle: 'Your registration is complete. You can start using the system right away.',
    heroFeature1: 'Apply for GACP certification',
    heroFeature2: 'Track document status in real-time',
    heroFeature3: 'Access government services securely',
    securityBadge: 'Registration Complete',
    title: 'Registration Completed',
    subtitle: 'You can sign in now to start GACP certification workflows.',
    accountType: 'Account type',
    accountTypeValue: 'Individual / Health ID',
    registrantName: 'Registered name',
    accountReference: 'Account reference',
    accountReferenceValue: 'Use your registered identifier to sign in',
    securityNotice:
      'Please complete your profile after sign-in and keep your credentials confidential.',
    goToLogin: 'Go to Sign in',
    loading: 'Loading...',
  },
} as const;

function RegisterSuccessContent() {
  const searchParams = useSearchParams();
  const { language, setLanguage } = useLanguage();
  const copy = COPY[language === 'en' ? 'en' : 'th'];
  const name = searchParams.get('name') || '-';

  return (
    <div className="gov-auth-page">
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
              <p className="gov-auth-brand-title">{copy.brandTitle}</p>
              <p className="gov-auth-brand-subtitle">{copy.brandSubtitle}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
            className="gov-auth-lang-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-label={language === 'th' ? 'Switch language to English' : 'เปลี่ยนภาษาเป็นภาษาไทย'}
          >
            {copy.switchLang}
          </button>
        </div>
      </header>

      <main id="main-content" className="gov-auth-main">
        <section className="gov-auth-hero order-2 xl:order-1">
          <div>
            <div className="gov-auth-hero-badge mb-5">
              <IconCheck size={14} aria-hidden="true" />
              <span>{copy.securityBadge}</span>
            </div>
            <h1 className="gov-auth-hero-title">{copy.heroTitle}</h1>
            <p className="gov-auth-hero-subtitle">{copy.heroSubtitle}</p>
          </div>

          <div className="mt-8 space-y-3">
            <div className="gov-auth-hero-feature">
              <div className="gov-auth-hero-feature-icon" aria-hidden="true">
                <IconCheck size={12} />
              </div>
              <span>{copy.heroFeature1}</span>
            </div>
            <div className="gov-auth-hero-feature">
              <div className="gov-auth-hero-feature-icon" aria-hidden="true">
                <IconCheck size={12} />
              </div>
              <span>{copy.heroFeature2}</span>
            </div>
            <div className="gov-auth-hero-feature">
              <div className="gov-auth-hero-feature-icon" aria-hidden="true">
                <IconCheck size={12} />
              </div>
              <span>{copy.heroFeature3}</span>
            </div>
          </div>

          <p className="gov-auth-hero-note mt-6 text-xs">
            {copy.securityNotice}
          </p>
        </section>

        <section className="gov-auth-panel order-1 xl:order-2">
          <div className="flex items-center gap-2">
            <IconCheck size={18} className="gov-auth-icon-brand" aria-hidden="true" />
            <h2 className="text-xl font-semibold text-foreground">{copy.title}</h2>
          </div>
          <p className="mt-2 text-sm text-foreground">{copy.subtitle}</p>

          <div className="gov-auth-panel-muted mt-4">
            <dl className="space-y-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <dt className="font-semibold text-foreground">{copy.registrantName}</dt>
                <dd className="text-foreground">{name}</dd>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <dt className="font-semibold text-foreground">{copy.accountReference}</dt>
                <dd className="text-foreground">{copy.accountReferenceValue}</dd>
              </div>
            </dl>
          </div>

          <div className="gov-auth-panel-muted mt-4">
            <div className="flex items-start gap-2 text-sm text-foreground">
              <IconShieldCheck
                size={16}
                className="gov-auth-icon-brand mt-0.5"
                aria-hidden="true"
              />
              <p>{copy.securityNotice}</p>
            </div>
          </div>

          <Link href="/auth/health/login" className="gov-auth-primary-btn mt-5 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            {copy.goToLogin}
            <IconChevronRight size={16} className="ml-1" aria-hidden="true" />
          </Link>
        </section>
      </main>

      <Footer />{/* Phase A5 §4.2 — replaces ad-hoc gov-auth-footer */}
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="gov-auth-page">
      <main className="gov-auth-main">
        <section className="gov-auth-panel text-center text-sm text-foreground">กำลังโหลด...</section>
      </main>
    </div>
  );
}

export default function RegisterSuccessPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RegisterSuccessContent />
    </Suspense>
  );
}
