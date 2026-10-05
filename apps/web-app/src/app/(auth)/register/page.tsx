'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  User,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  Globe,
  Leaf,
  Mail,
  Phone,
  Check,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import { AuthService } from '@/lib/services/auth-service';
import { isValidThaiNationalId } from '@/lib/validation/thai-formats';
import { useLanguage } from '@/lib/i18n/language-context';

/* ── 4-step wizard schema ──
 * Wave E.3-B: factory pattern. Validation messages used to be hardcoded
 * Thai literals in z.string().min(...) — meaning English users saw Thai
 * error text. The schema is now built per render via createRegisterSchema(t),
 * pulling messages from the local COPY object so they follow the active
 * language. Schema shape and refinement rules are preserved verbatim.
 */
type ValidationCopy = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  identifierLength: string;
  identifierDigits: string;
  identifierChecksum: string;
  password: string;
  passwordMatch: string;
  consent: string;
};

function createRegisterSchema(v: ValidationCopy) {
  return z
    .object({
      firstName: z.string().min(1, v.firstName),
      lastName: z.string().min(1, v.lastName),
      email: z.string().email(v.email),
      phoneNumber: z.string().min(10, v.phoneNumber),
      identifier: z
        .string()
        .min(13, v.identifierLength)
        .max(13, v.identifierLength)
        .regex(/^\d{13}$/, v.identifierDigits)
        // W3-C: mod-11 checksum at the field, on step 1. Pre-W3 an invalid
        // 13-digit ID sailed through the whole wizard and only the backend
        // rejected it — as a generic banner on step 4, three steps from the
        // field. Same validator the backend uses (thai-formats.ts mirrors
        // apps/backend/shared/utilities.js), so client and server agree.
        .refine(isValidThaiNationalId, v.identifierChecksum),
      // Strong-password policy (owner directive 2026-06-11 "ระบบ password ต้องเข้ม").
      // Mirrors the backend utils/password-policy.js (the authoritative gate):
      // min 10 + lowercase + uppercase + digit + special. All rules share the
      // one v.password message so any failure tells the user the full policy.
      password: z
        .string()
        .min(10, v.password)
        .regex(/[a-z]/, v.password)
        .regex(/[A-Z]/, v.password)
        .regex(/\d/, v.password)
        .regex(/[^A-Za-z0-9]/, v.password),
      confirmPassword: z.string(),
      // COMP-006 (PDPA): explicit consent must be given before registration.
      acceptedConsent: z.boolean().refine((val) => val === true, { message: v.consent }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: v.passwordMatch,
      path: ['confirmPassword'],
    });
}

type RegisterFormValues = z.infer<ReturnType<typeof createRegisterSchema>>;

/* ── Step metadata ── */
type FieldName = keyof RegisterFormValues;

/**
 * Step order and the fields each one validates. The labels are NOT here:
 * they were, and because this constant is evaluated once at module scope
 * they stayed Thai whichever language was selected, so an English user
 * got English headings over a Thai stepper and Thai field placeholders.
 * Labels now come from COPY, below, and are read per render.
 */
const STEPS: { key: StepKey; fields: FieldName[] }[] = [
  { key: 'personal', fields: ['identifier', 'firstName', 'lastName'] },
  { key: 'contact', fields: ['email', 'phoneNumber'] },
  { key: 'password', fields: ['password', 'confirmPassword'] },
  { key: 'confirm', fields: [] },
];

type StepKey = 'personal' | 'contact' | 'password' | 'confirm';

const COPY = {
  th: {
    steps: {
      personal: 'ข้อมูลส่วนตัว',
      contact: 'ช่องทางติดต่อ',
      password: 'ตั้งรหัสผ่าน',
      confirm: 'ยืนยัน',
    },
    placeholders: { firstName: 'ชื่อจริง', lastName: 'นามสกุล' },
    labels: {
      identifier: 'เลขบัตรประชาชน 13 หลัก',
      firstName: 'ชื่อ',
      lastName: 'นามสกุล',
      email: 'อีเมล',
      phone: 'เบอร์โทรศัพท์',
      password: 'รหัสผ่าน',
      confirmPassword: 'ยืนยันรหัสผ่าน',
    },
    heroTitle: 'สมัครสมาชิกเพื่อเริ่มต้น\nยื่นขอรับรองมาตรฐาน',
    heroSub: 'ลงทะเบียนเพื่อเข้าถึงระบบยื่นคำขอ ติดตามสถานะ และจัดการใบรับรอง GACP',
    btnNext: 'ถัดไป',
    btnBack: 'ย้อนกลับ',
    btnSubmit: 'ยืนยันสมัครสมาชิก',
    backToLogin: '← กลับไปหน้าเข้าสู่ระบบ',
    haveAccount: 'มีบัญชีอยู่แล้ว?',
    login: 'เข้าสู่ระบบ',
    consentLabel: 'ฉันยอมรับเงื่อนไขการให้บริการและนโยบายความเป็นส่วนตัว (PDPA)',
    validation: {
      firstName: 'กรุณาระบุชื่อ',
      lastName: 'กรุณาระบุนามสกุล',
      email: 'รูปแบบอีเมลไม่ถูกต้อง',
      phoneNumber: 'เบอร์โทรศัพท์ต้องมีความยาวอย่างน้อย 10 หลัก',
      identifierLength: 'เลขบัตรประชาชนต้องมี 13 หลัก',
      identifierDigits: 'กรุณากรอกตัวเลข 13 หลักเท่านั้น',
      identifierChecksum: 'เลขบัตรประชาชนไม่ถูกต้อง กรุณาตรวจสอบตัวเลขให้ตรงกับบัตรของคุณ',
      password: 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร และมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ',
      passwordMatch: 'รหัสผ่านไม่ตรงกัน',
      consent: 'กรุณายอมรับเงื่อนไขและนโยบายก่อนสมัครสมาชิก',
    },
  },
  en: {
    steps: {
      personal: 'Personal details',
      contact: 'Contact details',
      password: 'Set a password',
      confirm: 'Confirm',
    },
    placeholders: { firstName: 'First name', lastName: 'Last name' },
    labels: {
      identifier: 'Citizen ID (13 digits)',
      firstName: 'First name',
      lastName: 'Last name',
      email: 'Email',
      phone: 'Phone number',
      password: 'Password',
      confirmPassword: 'Confirm password',
    },
    heroTitle: 'Register to get started\nwith GACP certification',
    heroSub: 'Sign up to submit applications, track status, and manage your GACP certificates',
    btnNext: 'Next',
    btnBack: 'Back',
    btnSubmit: 'Confirm Registration',
    backToLogin: '← Back to Login',
    haveAccount: 'Already have an account?',
    login: 'Login',
    consentLabel: 'I accept the Terms of Service and Privacy Policy (PDPA)',
    validation: {
      firstName: 'Please enter your first name',
      lastName: 'Please enter your last name',
      email: 'Invalid email format',
      phoneNumber: 'Phone number must be at least 10 digits',
      identifierLength: 'Citizen ID must be exactly 13 digits',
      identifierDigits: 'Citizen ID must contain digits only (13 characters)',
      identifierChecksum: 'Invalid citizen ID number. Please check it against your ID card.',
      password: 'Password must be at least 10 characters and include lowercase, uppercase, a number, and a special character',
      passwordMatch: 'Passwords do not match',
      consent: 'Please accept the terms and policy to continue',
    },
  },
};

export default function CitizenRegisterPage() {
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const copy = COPY[language === 'en' ? 'en' : 'th'];

  // Wave E.3-B: build the Zod schema with the active-language messages.
  // useMemo so the resolver identity is stable until language changes
  // (otherwise react-hook-form re-mounts validators on every render).
  const registerSchema = useMemo(
    () => createRegisterSchema(copy.validation),
    [copy.validation],
  );

  const [step, setStep] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState(false);

  const {
    control,
    handleSubmit,
    trigger,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '', lastName: '', email: '',
      phoneNumber: '', identifier: '', password: '', confirmPassword: '', acceptedConsent: false,
    },
    mode: 'onTouched',
  });

  /* ── Step navigation ── */
  const goNext = async () => {
    const fields = STEPS[step]?.fields ?? [];
    const isValid = fields.length > 0 ? await trigger(fields) : true;
    if (isValid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  /* ── Submit ── */
  const onSubmit = async (values: RegisterFormValues) => {
    setServerError('');
    try {
      const result = await AuthService.register({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        phoneNumber: values.phoneNumber,
        identifier: values.identifier,
        healthId: values.identifier,
        accountType: 'INDIVIDUAL',
        password: values.password,
        // COMP-006 (PDPA): explicit consent captured via the confirm-step checkbox.
        acceptedTermsOfService: values.acceptedConsent,
        acceptedPrivacyPolicy: values.acceptedConsent,
      });

      if (result.success) {
        setSuccess(true);
        setTimeout(() => router.push('/auth/health/login'), 3000);
      } else {
        setServerError(result.error || 'ไม่สามารถลงทะเบียนได้ กรุณาตรวจสอบข้อมูล');
      }
    } catch {
      setServerError('เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง');
    }
  };

  /* ── Success screen ── */
  if (success) {
    return (
      <div className="gov-auth-page items-center justify-center p-6 text-center">
        <div className="gov-auth-form-inner card-shadow rounded-[2rem] border border-leaf-soft bg-card p-10">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-leaf-soft text-leaf-onSoft">
            <Check size={40} strokeWidth={3} />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-foreground">ลงทะเบียนสำเร็จ!</h2>
          <p className="mb-8 text-muted-foreground">กำลังนำคุณไปยังหน้าเข้าสู่ระบบ...</p>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="gov-auth-progress-bar" />
          </div>
        </div>
      </div>
    );
  }

  const vals = getValues();

  return (
    <div className="gov-auth-page">
      {/* ── Mobile Green Header (< lg only) ── */}
      <div className="gov-auth-mobile-header">
        <div className="gov-auth-mobile-header-brand">
          <div className="gov-auth-mobile-header-brand-icon">
            <Leaf className="h-4 w-4 text-white" />
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
          <div className="rounded-xl bg-white/20 p-2">
            <Leaf className="h-6 w-6 text-white" />
          </div>
          <span className="text-xs font-black text-white/90">GACP THAILAND</span>
        </div>

        <div className="gov-auth-hero-content">
          <h1 className="gov-auth-hero-title whitespace-pre-line">{copy.heroTitle}</h1>
          <p className="gov-auth-hero-subtitle">{copy.heroSub}</p>
        </div>

        {/* Step progress indicators on hero */}
        <div className="space-y-3">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${i <= step ? 'bg-card text-primary' : 'bg-white/20 text-white/85'
                }`}>
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-sm font-medium ${i <= step ? 'text-white' : 'text-white/85'
                }`}>
                {copy.steps[s.key]}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Right Form Panel ── */}
      <section className="gov-auth-form-panel">
        <div className="gov-auth-form-scroll">
          <div className="gov-auth-form-inner py-8">
            {/* Back to login link */}
            <Link href="/auth/health/login" className="gov-auth-link mb-6 inline-flex items-center gap-1 text-sm">
              {copy.backToLogin}
            </Link>

            {/* Step title */}
            <h2 className="gov-auth-form-title">{STEPS[step] ? copy.steps[STEPS[step].key] : ''}</h2>
            <p className="gov-auth-form-subtitle">
              {language === 'en' ? `Step ${step + 1} of ${STEPS.length}` : `ขั้นตอนที่ ${step + 1} จาก ${STEPS.length}`}
            </p>

            {serverError && (
              <div className="gov-auth-alert gov-auth-alert-danger mb-6">
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* ── Step 1: ข้อมูลส่วนตัว ── */}
              {step === 0 && (
                <>
                  <div>
                    <label className="gov-auth-label" htmlFor="reg-identifier">{copy.labels.identifier}</label>
                    <div className="gov-auth-input-wrapper">
                      <User className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                      <Controller
                        name="identifier"
                        control={control}
                        render={({ field }) => (
                          <input {...field} id="reg-identifier" className="gov-auth-input" placeholder="x-xxxx-xxxxx-xx-x" maxLength={13} autoComplete="off" aria-invalid={!!errors.identifier} aria-describedby={errors.identifier ? 'reg-identifier-error' : undefined} />
                        )}
                      />
                    </div>
                    {errors.identifier && <p id="reg-identifier-error" className="mt-1 text-xs font-bold text-destructive">{errors.identifier.message}</p>}
                  </div>
                  <div>
                    <label className="gov-auth-label" htmlFor="reg-firstName">{copy.labels.firstName}</label>
                    <div className="gov-auth-input-wrapper">
                      <User className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                      <Controller
                        name="firstName"
                        control={control}
                        render={({ field }) => (
                          <input {...field} id="reg-firstName" className="gov-auth-input" placeholder={copy.placeholders.firstName} autoComplete="given-name" aria-invalid={!!errors.firstName} aria-describedby={errors.firstName ? 'reg-firstName-error' : undefined} />
                        )}
                      />
                    </div>
                    {errors.firstName && <p id="reg-firstName-error" className="mt-1 text-xs font-bold text-destructive">{errors.firstName.message}</p>}
                  </div>
                  <div>
                    <label className="gov-auth-label" htmlFor="reg-lastName">{copy.labels.lastName}</label>
                    <div className="gov-auth-input-wrapper">
                      <User className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                      <Controller
                        name="lastName"
                        control={control}
                        render={({ field }) => (
                          <input {...field} id="reg-lastName" className="gov-auth-input" placeholder={copy.placeholders.lastName} autoComplete="family-name" aria-invalid={!!errors.lastName} aria-describedby={errors.lastName ? 'reg-lastName-error' : undefined} />
                        )}
                      />
                    </div>
                    {errors.lastName && <p id="reg-lastName-error" className="mt-1 text-xs font-bold text-destructive">{errors.lastName.message}</p>}
                  </div>
                </>
              )}

              {/* ── Step 2: ช่องทางติดต่อ ── */}
              {step === 1 && (
                <>
                  <div>
                    <label className="gov-auth-label" htmlFor="reg-email">{copy.labels.email}</label>
                    <div className="gov-auth-input-wrapper">
                      <Mail className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                      <Controller
                        name="email"
                        control={control}
                        render={({ field }) => (
                          <input {...field} id="reg-email" type="email" className="gov-auth-input" placeholder="email@example.com" autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'reg-email-error' : undefined} />
                        )}
                      />
                    </div>
                    {errors.email && <p id="reg-email-error" className="mt-1 text-xs font-bold text-destructive">{errors.email.message}</p>}
                  </div>
                  <div>
                    <label className="gov-auth-label" htmlFor="reg-phone">{copy.labels.phone}</label>
                    <div className="gov-auth-input-wrapper">
                      <Phone className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                      <Controller
                        name="phoneNumber"
                        control={control}
                        render={({ field }) => (
                          <input {...field} id="reg-phone" type="tel" className="gov-auth-input" placeholder="08xxxxxxxx" maxLength={10} autoComplete="tel" aria-invalid={!!errors.phoneNumber} aria-describedby={errors.phoneNumber ? 'reg-phone-error' : undefined} />
                        )}
                      />
                    </div>
                    {errors.phoneNumber && <p id="reg-phone-error" className="mt-1 text-xs font-bold text-destructive">{errors.phoneNumber.message}</p>}
                  </div>
                </>
              )}

              {/* ── Step 3: ตั้งรหัสผ่าน ── */}
              {step === 2 && (
                <>
                  <div>
                    <label className="gov-auth-label" htmlFor="reg-password">{copy.labels.password}</label>
                    <div className="gov-auth-input-wrapper">
                      <Lock className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                      <Controller
                        name="password"
                        control={control}
                        render={({ field }) => (
                          <input {...field} id="reg-password" type={showPassword ? 'text' : 'password'} className="gov-auth-input" placeholder="••••••••" autoComplete="new-password" aria-invalid={!!errors.password} aria-describedby={errors.password ? 'reg-password-error' : undefined} />
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                        aria-pressed={showPassword}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                      >
                        {showPassword ? <EyeOff size={18} aria-hidden="true" focusable="false" /> : <Eye size={18} aria-hidden="true" focusable="false" />}
                      </button>
                    </div>
                    {errors.password && <p id="reg-password-error" className="mt-1 text-xs font-bold text-destructive">{errors.password.message}</p>}
                  </div>
                  <div>
                    <label className="gov-auth-label" htmlFor="reg-confirm-password">{copy.labels.confirmPassword}</label>
                    <div className="gov-auth-input-wrapper">
                      <Lock className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                      <Controller
                        name="confirmPassword"
                        control={control}
                        render={({ field }) => (
                          <input {...field} id="reg-confirm-password" type="password" className="gov-auth-input" placeholder="••••••••" autoComplete="new-password" aria-invalid={!!errors.confirmPassword} aria-describedby={errors.confirmPassword ? 'reg-confirm-password-error' : undefined} />
                        )}
                      />
                    </div>
                    {errors.confirmPassword && <p id="reg-confirm-password-error" className="mt-1 text-xs font-bold text-destructive">{errors.confirmPassword.message}</p>}
                  </div>
                </>
              )}

              {/* ── Step 4: ยืนยัน (Summary) ── */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">เลขบัตรประชาชน</span>
                      <span className="font-semibold">{vals.identifier}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">ชื่อ - นามสกุล</span>
                      <span className="font-semibold">{vals.firstName} {vals.lastName}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">อีเมล</span>
                      <span className="font-semibold">{vals.email}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">เบอร์โทร</span>
                      <span className="font-semibold">{vals.phoneNumber}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">รหัสผ่าน</span>
                      <span className="font-semibold">{'•'.repeat(vals.password.length)}</span>
                    </div>
                  </div>

                  {/* COMP-006 (PDPA): explicit consent — required before submit */}
                  <div>
                    <Controller
                      name="acceptedConsent"
                      control={control}
                      render={({ field }) => (
                        <label className="flex items-start gap-2 text-sm" htmlFor="reg-consent">
                          <input
                            id="reg-consent"
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            onBlur={field.onBlur}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
                            aria-invalid={!!errors.acceptedConsent}
                            aria-describedby={errors.acceptedConsent ? 'reg-consent-error' : undefined}
                          />
                          <span className="text-muted-foreground">{copy.consentLabel}</span>
                        </label>
                      )}
                    />
                    {errors.acceptedConsent && <p id="reg-consent-error" className="mt-1 text-xs font-bold text-destructive">{errors.acceptedConsent.message}</p>}
                  </div>
                </div>
              )}

              {/* ── Navigation buttons ── */}
              <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={goBack}
                    className="gov-auth-outline-btn flex flex-1 items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    aria-label={copy.btnBack}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" focusable="false" />
                    {copy.btnBack}
                  </button>
                )}

                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="gov-auth-primary-btn flex flex-1 items-center justify-center gap-2 transition-transform duration-150 hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    aria-label={copy.btnNext}
                  >
                    {copy.btnNext}
                    <ChevronRight className="h-4 w-4" aria-hidden="true" focusable="false" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="gov-auth-primary-btn flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    aria-label={copy.btnSubmit}
                    aria-busy={isSubmitting ? 'true' : 'false'}
                  >
                    {isSubmitting ? (language === 'en' ? 'Submitting...' : 'กำลังส่งข้อมูล...') : copy.btnSubmit}
                  </button>
                )}
              </div>
            </form>

            <div className="gov-auth-footer-row">
              <span>{copy.haveAccount}</span>
              <Link href="/auth/health/login" className="gov-auth-link font-bold">
                {copy.login}
              </Link>
            </div>

            <div className="gov-auth-secure-note">
              <ShieldCheck size={14} className="text-leaf-700" />
              <span>{language === 'en' ? 'Encrypted & secure' : 'ข้อมูลปลอดภัย เข้ารหัสตามมาตรฐาน'}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
