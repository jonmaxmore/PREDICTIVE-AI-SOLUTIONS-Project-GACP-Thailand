'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CreditCard,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  Globe,
  ChevronRight
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AuthService } from '@/lib/services/auth-service';
import { useLanguage } from '@/lib/i18n/language-context';
import { HEALTH_DASHBOARD_ROUTE, PROVIDER_LOGIN_ROUTE } from '@/lib/constants/auth-routes';
import {
  ACCOUNT_INACTIVE_MESSAGE_EN,
  ACCOUNT_INACTIVE_MESSAGE_TH,
} from '@/lib/api/account-inactive';
import MfaChallengeForm from './mfa-challenge-form';
import { useAccountInactiveNotice } from './use-account-inactive-notice';

// Open-redirect guard: only honour a `?redirect=` value that is a same-origin
// absolute path ("/dashboard"). A protocol-relative ("//evil.com") or absolute
// URL ("https://evil.com") would let a crafted login link bounce the user
// off-site after authenticating, so fall back to the dashboard instead.
function toInternalPath(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}

/* ── Login schema ──
 * Wave E.3-B follow-up: same factory pattern as register page (#244).
 * Validation messages used to be hardcoded Thai literals — English
 * users saw Thai error text on the login form. Built per language
 * change via createLoginSchema(v) inside the component.
 *
 * V1-A — `createLoginSchema` and `LOGIN_COPY` are exported so
 * health-login-schema.test.ts can assert that an empty identifier in
 * Thai mode returns the Thai validation message verbatim. Without
 * this export the schema would only be reachable through the full
 * page render, which the web-app test harness does not support.
 */
export type LoginValidationCopy = {
  identifier: string;
  password: string;
};

export function createLoginSchema(v: LoginValidationCopy) {
  return z.object({
    identifier: z.string().min(1, v.identifier),
    // Login validates PRESENCE only — never strength. A legacy user whose
    // password predates the strong-password policy must still be able to sign
    // in (the server bcrypt-compares the stored hash, it never re-checks
    // strength). Strength is enforced only when SETTING a password (register /
    // change / reset). Matches the backend loginPasswordField (min 1).
    password: z.string().min(1, v.password),
  });
}

type LoginFormValues = z.infer<ReturnType<typeof createLoginSchema>>;

export const LOGIN_COPY = {
  th: {
    title: 'เข้าสู่ระบบ',
    subtitle: 'สำหรับประชาชน / เกษตรกร',
    labelId: 'เลขประจำตัวประชาชน (13 หลัก)',
    labelPw: 'รหัสผ่าน',
    placeholderId: 'x-xxxx-xxxxx-xx-x',
    placeholderPw: '••••••••',
    btnSubmit: 'เข้าสู่ระบบ',

    noAccount: 'ยังไม่มีบัญชี?',
    register: 'สมัครสมาชิก',
    secure: 'ระบบรักษาความปลอดภัยมาตรฐานภาครัฐ',
    heroTitle: 'มาตรฐานสมุนไพร\nไทยสู่สากล',
    heroSub: 'ยกระดับการปลูกและผลิตสมุนไพรด้วยระบบ Digital GACP เพื่อการรับรองที่โปร่งใสและตรวจสอบได้',
    accountInactive: ACCOUNT_INACTIVE_MESSAGE_TH,
    validation: {
      identifier: 'กรุณากรอกเลขบัตรประชาชน 13 หลัก',
      password: 'กรุณากรอกรหัสผ่าน',
    },
  },
  en: {
    title: 'Member Login',
    subtitle: 'GACP Herbal Standard Certification — Digital Platform',
    labelId: 'National ID (13 digits)',
    labelPw: 'Password',
    placeholderId: 'Enter identifier...',
    placeholderPw: '••••••••',
    btnSubmit: 'Login',

    noAccount: "Don't have an account?",
    register: 'Register now',
    secure: 'Government Standard Security System',
    heroTitle: 'Thai Herbs to\nGlobal Standards',
    heroSub: 'Elevating cultivation and production with Digital GACP for transparent certification.',
    accountInactive: ACCOUNT_INACTIVE_MESSAGE_EN,
    validation: {
      identifier: 'Please enter your 13-digit citizen ID',
      password: 'Please enter your password',
    },
  }
};

export default function CitizenLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language, setLanguage } = useLanguage();
  const copy = LOGIN_COPY[language === 'en' ? 'en' : 'th'];

  // Wave E.3-B follow-up: schema rebuilt when language changes; identity
  // is stable within the same language so react-hook-form doesn't remount
  // its resolver on every render.
  const loginSchema = useMemo(
    () => createLoginSchema(copy.validation),
    [copy.validation],
  );

  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState('');
  // This browser was just signed out because the account is suspended or deleted.
  const signedOutInactive = useAccountInactiveNotice();
  // When login returns a 2FA challenge, swap the password form for the OTP form.
  const [mfaSession, setMfaSession] = useState('');

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError('');
    try {
      const result = await AuthService.login({
        identifier: values.identifier,
        password: values.password,
      });

      if (result.success) {
        const redirect = toInternalPath(searchParams.get('redirect'), HEALTH_DASHBOARD_ROUTE);
        router.replace(redirect);
      } else if (result.mfaRequired && result.mfaSession) {
        setMfaSession(result.mfaSession);
      } else {
        setServerError(result.error || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
      }
    } catch {
      setServerError('เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง');
    }
  };

  return (
    <div className="gov-auth-page">
      {/* ── Mobile Green Header (< lg only) ── */}
      <div className="gov-auth-mobile-header">
        <div className="gov-auth-mobile-header-brand">
          <div className="gov-auth-mobile-header-brand-icon overflow-hidden !bg-white">
            <Image src="/images/dtam-seal.png" alt="" width={20} height={20} className="h-5 w-5 object-contain" />
          </div>
          <div>
            <div className="gov-auth-mobile-header-title">GACP THAILAND</div>
            <div className="gov-auth-mobile-header-subtitle">ระบบออกใบรับรองมาตรฐาน GACP</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
          className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
          aria-label={language === 'th' ? 'Switch language to English' : 'เปลี่ยนภาษาเป็นภาษาไทย'}
        >
          <Globe size={12} aria-hidden="true" focusable="false" />
          {language === 'th' ? 'EN' : 'TH'}
        </button>
      </div>

      {/* ── Left Hero Panel (Desktop) ── */}
      <section className="gov-auth-hero">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-white p-1.5">
            <Image src="/images/dtam-seal.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
          </div>
          <span className="text-xs font-black text-white/90">GACP Platform</span>
        </div>

        {/* Focal group — title + subtitle + features wrapped as ONE space-between
            child so the hero reads brand(top) · focal(centre) · dept(bottom) with
            no mid-panel void. See .gov-auth-hero-focal in globals-components-auth.css. */}
        <div className="gov-auth-hero-focal">
          <div className="gov-auth-hero-content">
            <h1 className="gov-auth-hero-title whitespace-pre-line">{copy.heroTitle}</h1>
            <p className="gov-auth-hero-subtitle">{copy.heroSub}</p>
          </div>

          <div className="gov-auth-hero-features">
            <div className="gov-auth-hero-feature">
              <span className="gov-auth-feat-dot">
                <ChevronRight className="h-3.5 w-3.5 text-white/85" aria-hidden="true" focusable="false" />
              </span>
              <span>{language === 'en' ? 'Apply for GACP certification' : 'ยื่นคำขอรับรอง GACP'}</span>
            </div>
            <div className="gov-auth-hero-feature">
              <span className="gov-auth-feat-dot">
                <ChevronRight className="h-3.5 w-3.5 text-white/85" aria-hidden="true" focusable="false" />
              </span>
              <span>{language === 'en' ? 'Track payment and status' : 'ติดตามการชำระเงินและสถานะ'}</span>
            </div>
            <div className="gov-auth-hero-feature">
              <span className="gov-auth-feat-dot">
                <ChevronRight className="h-3.5 w-3.5 text-white/85" aria-hidden="true" focusable="false" />
              </span>
              <span>{language === 'en' ? 'View certificates and Trace' : 'ดูผลการรับรองและตรวจสอบย้อนกลับ'}</span>
            </div>
          </div>
        </div>

        <div className="text-xs font-medium text-white/80">
          {language === 'en' ? 'Department of Thai Traditional and Alternative Medicine' : 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก'}
        </div>
      </section>

      {/* ── Right Form Panel ── */}
      <section className="gov-auth-form-panel">
        <div className="gov-auth-form-scroll">
          <div className="gov-auth-form-inner">
            <div className="gov-auth-lang-row">
              <button
                type="button"
                onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
                className="gov-auth-lang-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                aria-label={language === 'th' ? 'Switch language to English' : 'เปลี่ยนภาษาเป็นภาษาไทย'}
              >
                <Globe size={14} aria-hidden="true" focusable="false" />
                {language === 'th' ? 'EN' : 'TH'}
              </button>
            </div>

            {mfaSession ? (
              <MfaChallengeForm
                lang={language === 'en' ? 'en' : 'th'}
                mfaSession={mfaSession}
                onSuccess={() => router.replace(toInternalPath(searchParams.get('redirect'), HEALTH_DASHBOARD_ROUTE))}
              />
            ) : (
            <>
            <h2 className="gov-auth-form-title">{copy.title}</h2>
            <p className="gov-auth-form-subtitle">{copy.subtitle}</p>

            {signedOutInactive && !serverError && (
              <div className="gov-auth-alert gov-auth-alert-danger mb-6" role="alert">
                {copy.accountInactive}
              </div>
            )}

            {serverError && (
              <div className="gov-auth-alert gov-auth-alert-danger animate-shake mb-6" role="alert">
                {serverError}
              </div>
            )}

            {/* method="post" — กันเคสกดก่อน hydrate: native GET submit เคยพารหัสผ่านขึ้น query string ลง access log (Deep QA 2026-09-07) */}
            <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label htmlFor="identifier" className="gov-auth-label">{copy.labelId}</label>
                <div className="gov-auth-input-wrapper">
                  <CreditCard className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                  <Controller
                    name="identifier"
                    control={control}
                    render={({ field }) => (
                      <input
                        {...field}
                        id="identifier"
                        className="gov-auth-input"
                        placeholder={copy.placeholderId}
                        autoComplete="username"
                        inputMode="numeric"
                        aria-invalid={errors.identifier ? 'true' : 'false'}
                        aria-describedby={errors.identifier ? 'identifier-error' : undefined}
                      />
                    )}
                  />
                </div>
                {errors.identifier && <p id="identifier-error" className="mt-1.5 text-xs font-bold text-destructive" role="alert">{errors.identifier.message}</p>}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="password" className="gov-auth-label mb-0">{copy.labelPw}</label>
                  {/* ไม่มีลิงก์รีเซ็ตรหัสผ่าน: ระบบไม่ส่งอะไรทางอีเมลหรือ SMS (มติ operator 2026-09-16) และไม่มีการกู้บัญชี (มติ 2026-09-17) */}
                </div>
                <div className="gov-auth-input-wrapper">
                  <Lock className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                  <Controller
                    name="password"
                    control={control}
                    render={({ field }) => (
                      <input
                        {...field}
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        className="gov-auth-input"
                        placeholder={copy.placeholderPw}
                        autoComplete="current-password"
                        aria-invalid={errors.password ? 'true' : 'false'}
                        aria-describedby={errors.password ? 'password-error' : undefined}
                      />
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={18} aria-hidden="true" focusable="false" /> : <Eye size={18} aria-hidden="true" focusable="false" />}
                  </button>
                </div>
                {errors.password && <p id="password-error" className="mt-1.5 text-xs font-bold text-destructive" role="alert">{errors.password.message}</p>}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="gov-auth-primary-btn transition-transform duration-150 hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={copy.btnSubmit}
              >
                {isSubmitting ? (language === 'en' ? 'Checking...' : 'กำลังตรวจสอบ...') : copy.btnSubmit}
              </button>


            </form>
            </>
            )}

            <div className="gov-auth-footer-row">
              <span>{copy.noAccount}</span>
              <Link href="/register" className="gov-auth-link font-bold">
                {copy.register}
              </Link>
            </div>

            <div className="flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground sm:flex-row sm:gap-1.5">
              <ShieldCheck size={14} className="text-leaf-700" aria-hidden="true" focusable="false" />
              <Link href={PROVIDER_LOGIN_ROUTE} className="gov-auth-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                {language === 'en' ? 'For Officers' : 'สำหรับเจ้าหน้าที่'}
              </Link>
            </div>

            <div className="gov-auth-secure-note">
              <ShieldCheck size={14} className="text-leaf-700" aria-hidden="true" focusable="false" />
              <span>{language === 'en' ? 'Encrypted & secure' : 'ข้อมูลปลอดภัย เข้ารหัสตามมาตรฐาน'}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
