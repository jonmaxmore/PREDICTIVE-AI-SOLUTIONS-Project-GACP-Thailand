'use client';

import { useState } from 'react';
import { ShieldCheck, KeyRound } from 'lucide-react';

import { apiClient } from '@/lib/api/api-client';
import { AuthService } from '@/lib/services/auth-service';
import type { SessionData } from '@/lib/services/auth-service.types';

/**
 * MfaChallengeForm — the TOTP entry step shown after a login that returned
 * mfa_required + an mfa_session. The code comes from the user's authenticator app
 * (or a backup code): TOTP is the only second factor since 2026-09-15 (operator:
 * no email in the system). On success the backend returns { token, user } and we
 * complete the session via AuthService.saveSession.
 *
 * Closes the audit gap where mfa_required came back with no FE screen → a
 * 2FA-enrolled account could not complete login.
 */
export type MfaChallengeFormProps = {
    /** The JWT mfa_session from the login response. */
    mfaSession: string;
    /** Called after the session is saved (page decides where to navigate). */
    onSuccess: () => void;
    /** UI language (defaults to Thai). */
    lang?: 'th' | 'en';
};

const COPY = {
    th: {
        title: 'ยืนยันตัวตนสองชั้น (2FA)',
        subtitle: 'กรุณากรอกรหัสยืนยันเพื่อเข้าสู่ระบบ',
        codeLabel: 'รหัสยืนยัน',
        backupLabel: 'ใช้รหัสสำรอง (backup code) แทน',
        codePlaceholder: '000000',
        backupPlaceholder: 'XXXX-XXXX',
        submit: 'ยืนยัน',
        submitting: 'กำลังตรวจสอบ...',
        invalid: 'รหัสไม่ถูกต้อง กรุณาลองใหม่',
        conn: 'เกิดข้อผิดพลาดในการเชื่อมต่อ',
        hint: 'เปิดแอป authenticator ในโทรศัพท์ของคุณเพื่อดูรหัส 6 หลัก',
    },
    en: {
        title: 'Two-Factor Verification (2FA)',
        subtitle: 'Enter your verification code to continue',
        codeLabel: 'Verification code',
        backupLabel: 'Use a backup code instead',
        codePlaceholder: '000000',
        backupPlaceholder: 'XXXX-XXXX',
        submit: 'Verify',
        submitting: 'Verifying...',
        invalid: 'Invalid code, please try again',
        conn: 'Connection error',
        hint: 'Open the authenticator app on your phone to see the 6-digit code',
    },
};

export default function MfaChallengeForm({ mfaSession, onSuccess, lang = 'th' }: MfaChallengeFormProps) {
    const copy = COPY[lang === 'en' ? 'en' : 'th'];
    const [code, setCode] = useState('');
    const [isBackupCode, setIsBackupCode] = useState(false);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const onChangeCode = (raw: string) => {
        // Numeric-only for a 6-digit OTP/TOTP; backup codes keep their format.
        setCode(isBackupCode ? raw.toUpperCase() : raw.replace(/\D/g, '').slice(0, 6));
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || submitting) { return; }
        setError('');
        setSubmitting(true);
        try {
            const res = await apiClient.post<{ token?: string; user?: unknown }>('/api/mfa/verify', {
                mfa_session: mfaSession,
                code: code.trim(),
                isBackupCode,
            });

            if (res.success && res.data?.token) {
                await AuthService.saveSession({ token: res.data.token, user: res.data.user } as SessionData);
                onSuccess();
                return;
            }

            setError(res.error || copy.invalid);
        } catch {
            setError(copy.conn);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div>
            <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-leaf-700" aria-hidden="true" focusable="false" />
                <h2 className="gov-auth-form-title mb-0">{copy.title}</h2>
            </div>
            <p className="gov-auth-form-subtitle">{copy.subtitle}</p>

            {error && (
                <div className="gov-auth-alert gov-auth-alert-danger animate-shake mb-6" role="alert">
                    {error}
                </div>
            )}

            {/* method="post" — กันเคสกดก่อน hydrate: native GET submit เคยพารหัสผ่านขึ้น query string ลง access log (Deep QA 2026-09-07) */}
            <form method="post" onSubmit={submit} className="space-y-5">
                <div>
                    <label htmlFor="mfa-code" className="gov-auth-label">{copy.codeLabel}</label>
                    <div className="gov-auth-input-wrapper">
                        <KeyRound className="gov-auth-input-icon" size={18} aria-hidden="true" focusable="false" />
                        <input
                            id="mfa-code"
                            value={code}
                            onChange={(e) => onChangeCode(e.target.value)}
                            className="gov-auth-input tracking-[0.4em]"
                            placeholder={isBackupCode ? copy.backupPlaceholder : copy.codePlaceholder}
                            inputMode={isBackupCode ? 'text' : 'numeric'}
                            autoComplete="one-time-code"
                            maxLength={isBackupCode ? 9 : 6}
                            aria-label={copy.codeLabel}
                        />
                    </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={isBackupCode}
                        onChange={(e) => { setIsBackupCode(e.target.checked); setCode(''); }}
                        className="h-4 w-4 rounded border-input"
                    />
                    {copy.backupLabel}
                </label>

                <button
                    type="submit"
                    disabled={submitting || !code.trim()}
                    className="gov-auth-primary-btn transition-transform duration-150 hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={copy.submit}
                >
                    {submitting ? copy.submitting : copy.submit}
                </button>
            </form>

            <p className="mt-4 text-xs text-muted-foreground">{copy.hint}</p>
        </div>
    );
}
