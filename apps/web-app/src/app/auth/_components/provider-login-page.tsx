'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
    User,
    Lock,
    Info,
    Eye,
    EyeOff,
      Globe,
    ArrowRight
} from 'lucide-react';
import { AuthService } from '@/lib/services/auth-service';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatHealthId } from '@/utils/format-health-id';
import { PROVIDER_DASHBOARD_ROUTE } from '@/lib/constants/auth-routes';
import {
    ACCOUNT_INACTIVE_MESSAGE_EN,
    ACCOUNT_INACTIVE_MESSAGE_TH,
} from '@/lib/api/account-inactive';
import MfaChallengeForm from './mfa-challenge-form';
import MfaEnrolmentForm from './mfa-enrolment-form';
import { useAccountInactiveNotice } from './use-account-inactive-notice';

const COPY = {
    th: {
        brandTitle: 'GACP Officer Portal',
        brandSub: 'ระบบรับรองมาตรฐาน GACP สมุนไพร',
        title: 'เข้าสู่ระบบเจ้าหน้าที่',
        subtitle: 'สำหรับเจ้าหน้าที่ที่ได้รับมอบหมายเท่านั้น',
        providerIdLabel: 'เลขประจำตัวเจ้าหน้าที่ (13 หลัก)',
        providerIdHint: 'ใช้เลขประจำตัวเจ้าหน้าที่ 13 หลักที่ได้รับจากระบบ',
        providerIdPlaceholder: 'x-xxxx-xxxxx-xx-x',
        passwordLabel: 'รหัสผ่าน',
        passwordPlaceholder: 'กรอกรหัสผ่าน',
        warning: 'กรุณาใช้เลขประจำตัว 13 หลักและรหัสผ่านที่ได้รับจากระบบ',
        signIn: 'เข้าสู่ระบบเจ้าหน้าที่',
        signingIn: 'กำลังเข้าสู่ระบบ...',
        enterProviderId: 'กรุณากรอก Provider ID (13 หลัก)',
        invalidProviderId: 'Provider ID ต้องมีตัวเลข 13 หลักเท่านั้น',
        contactAdmin: 'หากต้องการสร้างบัญชีหรือรีเซ็ตรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ',
        backToMain: 'กลับหน้าหลัก',
        connectError: 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง',
        switchLang: 'EN',
        heroTitle: 'ระบบจัดการสำหรับ\nเจ้าหน้าที่ GACP',
        heroSub: 'ตรวจสอบคำขอ จัดการใบรับรอง และควบคุมกระบวนการรับรองมาตรฐาน GACP ให้เป็นไปตามระเบียบกรมฯ',
        accountInactive: ACCOUNT_INACTIVE_MESSAGE_TH,
    },
    en: {
        brandTitle: 'GACP Officer Portal',
        brandSub: '\u0e01\u0e23\u0e21\u0e01\u0e32\u0e23\u0e41\u0e1e\u0e17\u0e22\u0e4c\u0e41\u0e1c\u0e19\u0e44\u0e17\u0e22\u0e41\u0e25\u0e30\u0e01\u0e32\u0e23\u0e41\u0e1e\u0e17\u0e22\u0e4c\u0e17\u0e32\u0e07\u0e40\u0e25\u0e37\u0e2d\u0e01',
        title: 'Officer Sign In',
        subtitle: 'For authorized Provider only',
        providerIdLabel: 'Provider ID (13 digits)',
        providerIdHint: 'Use your 13-digit officer ID issued by the system.',
        providerIdPlaceholder: 'x-xxxx-xxxxx-xx-x',
        passwordLabel: 'Password',
        passwordPlaceholder: 'Enter password',
        warning: 'Use your 13-digit provider ID and assigned password.',
        signIn: 'Sign In as Officer',
        signingIn: 'Signing in...',
        enterProviderId: 'Please enter Provider ID (13 digits)',
        invalidProviderId: 'Provider ID must be exactly 13 digits',
        contactAdmin: 'For account creation or reset, contact system administrator.',
        backToMain: 'Back to main page',
        connectError: 'System connection error. Please retry.',
        switchLang: 'TH',
        heroTitle: 'GACP Officer\nManagement Portal',
        heroSub: 'Review applications, manage certifications, and control the GACP process.',
        accountInactive: ACCOUNT_INACTIVE_MESSAGE_EN,
    },
} as const;

export default function PROVIDERLoginPage() {
    const { language, setLanguage } = useLanguage();
    const copy = COPY[language === 'en' ? 'en' : 'th'];
    // This browser was just signed out because the account is suspended or deleted.
    const signedOutInactive = useAccountInactiveNotice();

    const [providerId, setProviderId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    // When provider login returns a 2FA challenge, swap to the OTP form.
    const [mfaSession, setMfaSession] = useState('');
    const [mfaSetupToken, setMfaSetupToken] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        if (!providerId.trim()) {
            setError(copy.enterProviderId);
            setIsLoading(false);
            return;
        }

        const cleanProviderId = providerId.replace(/-/g, '').trim();
        if (!/^\d{13}$/.test(cleanProviderId)) {
            setError(copy.invalidProviderId);
            setIsLoading(false);
            return;
        }

        try {
            const result = await AuthService.login({
                providerId: cleanProviderId,
                password,
            });

            if (result.success) {
                window.location.href = PROVIDER_DASHBOARD_ROUTE;
                return;
            }

            if (result.mfaRequired && result.mfaSession) {
                setMfaSession(result.mfaSession);
                setIsLoading(false);
                return;
            }

            // บัญชีที่ระบบบังคับให้มี 2FA แต่ยังไม่เคยตั้ง — รหัสผ่านถูกแล้ว ขาดแค่ผูกเครื่อง
            // ก่อนมีกิ่งนี้ ผู้ใช้ตกไปที่ setError ด้วยข้อความว่าง แล้วเห็นหน้าเดิมค้างอยู่
            if (result.mfaSetupRequired && result.setupToken) {
                setMfaSetupToken(result.setupToken);
                setIsLoading(false);
                return;
            }

            setError(result.error || copy.connectError);
            setIsLoading(false);
            return;
        } catch {
            setError(copy.connectError);
            setIsLoading(false);
        }
    };

    return (
        <div className="gov-auth-page">
            {/* ── Left: Hero ── */}
            <section className="gov-auth-hero bg-[linear-gradient(160deg,#062d1a_0%,#004d2a_100%)]">
                <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-white p-1.5">
                        <Image src="/images/dtam-seal.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
                    </div>
                    <div>
                        <p className="text-xs font-black text-white/90">{copy.brandTitle}</p>
                        <p className="text-xs font-bold uppercase tracking-tight text-white/80">{copy.brandSub}</p>
                    </div>
                </div>

                <div className="gov-auth-hero-content">
                    <h1 className="gov-auth-hero-title whitespace-pre-line">{copy.heroTitle}</h1>
                    <p className="gov-auth-hero-subtitle">{copy.heroSub}</p>
                </div>

                <div className="flex flex-col items-start gap-3 text-xs font-bold text-white/80 sm:flex-row sm:items-center sm:gap-4">
                    <span>Officer Access</span>
                    <div className="h-1 w-1 rounded-full bg-white/20" />
                    <span>Secure Gateway</span>
                </div>
            </section>

            {/* ── Right: Form ── */}
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

                        {mfaSetupToken ? (
                            <MfaEnrolmentForm
                                setupToken={mfaSetupToken}
                                onDone={() => { setMfaSetupToken(''); setPassword(''); }}
                            />
                        ) : mfaSession ? (
                            <MfaChallengeForm
                                lang={language === 'en' ? 'en' : 'th'}
                                mfaSession={mfaSession}
                                onSuccess={() => { window.location.href = PROVIDER_DASHBOARD_ROUTE; }}
                            />
                        ) : (
                        <>
                        <h2 className="gov-auth-form-title">{copy.title}</h2>
                        <p className="gov-auth-form-subtitle">{copy.subtitle}</p>

                        {signedOutInactive && !error ? (
                            <div className="gov-auth-alert gov-auth-alert-danger mb-6" role="alert">
                                <span>{copy.accountInactive}</span>
                            </div>
                        ) : null}

                        {error ? (
                            <div className="gov-auth-alert gov-auth-alert-danger animate-shake mb-6" role="alert">
                                <span>{error}</span>
                            </div>
                        ) : null}

                        {/* method="post" — กันเคสกดก่อน hydrate: native GET submit เคยพารหัสผ่านขึ้น query string ลง access log (Deep QA 2026-09-07) */}
            <form method="post" onSubmit={handleSubmit} className="space-y-5" noValidate>
                            <div>
                                <label htmlFor="provider-id" className="gov-auth-label">{copy.providerIdLabel}</label>
                                <div className="gov-auth-input-wrapper">
                                    <User className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                                    <input
                                        id="provider-id"
                                        name="provider-id"
                                        autoComplete="username"
                                        className="gov-auth-input"
                                        placeholder={copy.providerIdPlaceholder}
                                        inputMode="numeric"
                                        value={providerId}
                                        onChange={(e) => {
                                            setProviderId(formatHealthId(e.currentTarget.value));
                                            if (error) setError('');
                                        }}
                                        required
                                    />
                                </div>
                                <p className="mt-1.5 text-[10px] font-bold text-zinc-400">{copy.providerIdHint}</p>
                            </div>

                            <div>
                                <label htmlFor="provider-password" className="gov-auth-label">{copy.passwordLabel}</label>
                                <div className="gov-auth-input-wrapper">
                                    <Lock className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                                    <input
                                        id="provider-password"
                                        type={showPassword ? 'text' : 'password'}
                                        name="provider-password"
                                        autoComplete="current-password"
                                        className="gov-auth-input pr-12"
                                        placeholder={copy.passwordPlaceholder}
                                        value={password}
                                        onChange={(e) => {
                                            setPassword(e.currentTarget.value);
                                            if (error) setError('');
                                        }}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((prev) => !prev)}
                                        aria-label={showPassword ? (language === 'en' ? 'Hide password' : 'ซ่อนรหัสผ่าน') : (language === 'en' ? 'Show password' : 'แสดงรหัสผ่าน')}
                                        aria-pressed={showPassword}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                                    >
                                        {showPassword ? <EyeOff size={18} aria-hidden="true" focusable="false" /> : <Eye size={18} aria-hidden="true" focusable="false" />}
                                    </button>
                                </div>
                            </div>

                            <button type="submit" className="gov-auth-primary-btn !bg-gov-auth-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" disabled={isLoading} aria-busy={isLoading ? 'true' : 'false'}>
                                {isLoading ? copy.signingIn : copy.signIn}
                            </button>
                        </form>
                        </>
                        )}

                        {/* Static credential guidance — a calm info note, not an
                            alert (the red error box above handles real failures). */}
                        <div className="mt-6 rounded-xl border border-border bg-muted/50 p-3 sm:mt-8 sm:p-4">
                            <div className="flex gap-3">
                                <Info size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" focusable="false" />
                                <p className="text-[11px] font-medium leading-relaxed text-muted-foreground">{copy.warning}</p>
                            </div>
                        </div>

                        <div className="gov-auth-footer-row mt-8">
                            <Link href="/" className="gov-auth-link text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                                <ArrowRight className="mr-1 inline h-4 w-4 rotate-180" aria-hidden="true" focusable="false" /> {copy.backToMain}
                            </Link>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
