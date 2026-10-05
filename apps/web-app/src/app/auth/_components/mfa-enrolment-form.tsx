'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldPlus, Copy, Check } from 'lucide-react';

import { apiClient } from '@/lib/api/api-client';
import { providerApiPaths } from '@/lib/services/provider-api';

/**
 * MfaEnrolmentForm — หน้าลงทะเบียนเครื่องยืนยันตัวตน สำหรับบัญชีที่ระบบบังคับให้มี 2FA
 * แต่ยังไม่เคยตั้ง (หลังบ้านตอบ `mfa_setup_required` + `setup_token`)
 *
 * ── ทำไมมี ────────────────────────────────────────────────────────────────
 *
 * กิ่งนี้ไม่เคยมีหน้าจอรองรับ · หลังบ้านตรวจรหัสผ่านผ่านแล้ว ยื่นตั๋ว setup_token มาให้
 * แต่ฝั่งหน้าจอไม่รู้จักคำตอบนี้ จึงไหลไปจบที่ "ไม่ได้รับ Token จากระบบ" — เจ้าหน้าที่ที่
 * กรอกรหัส **ถูก** จะเห็นหน้าล็อกอินค้างอยู่ ไม่มีทางรู้ว่าต้องทำอะไรต่อ และถ้าเขาคิดว่า
 * ตัวเองพิมพ์ผิดแล้วลองซ้ำ บัญชีจะถูกล็อก 15 นาที
 *
 * ผลจริงบน demo/staging ซึ่งตั้ง REQUIRE_MFA_FOR_PRIVILEGED=true: **ไม่มีเจ้าหน้าที่
 * คนไหนเข้าระบบได้เลยสักคน** เจอตอนเดินประตูจริง 2026-09-12
 *
 * กิ่งพี่น้องของมัน (`mfa_required` สำหรับคนที่ตั้งแล้ว) ถูกปิดไปก่อนหน้านี้ พร้อมคอมเมนต์
 * ว่า "closes the audit gap where mfa_required came back with no FE screen" —
 * ปิดไว้กิ่งเดียว อีกกิ่งเปิดค้าง
 *
 * ── ทำไมจบด้วย "เข้าสู่ระบบอีกครั้ง" ไม่ใช่พาเข้าไปเลย ─────────────────────
 *
 * `POST /api/mfa/verify-setup` เปิด 2FA และคืน backup codes แต่ **ไม่คืน session**
 * ตามสัญญาของมัน · การแกล้งพาเข้าไปเลยจะต้องเก็บรหัสผ่านไว้ในหน้าจอเพื่อยิงล็อกอินซ้ำ
 * ซึ่งแย่กว่าการบอกความจริงหนึ่งประโยค · รอบถัดไปผู้ใช้จะได้ `mfa_required` ซึ่ง
 * MfaChallengeForm รองรับอยู่แล้ว
 */
export type MfaEnrolmentFormProps = {
    /** ตั๋ว purpose='mfa_setup' จากคำตอบของการล็อกอิน */
    setupToken: string;
    /** เรียกเมื่อผู้ใช้กดกลับไปหน้าเข้าสู่ระบบหลังลงทะเบียนเสร็จ */
    onDone: () => void;
};

type SetupData = { secret: string; qrCodeUri: string };

const COPY = {
    title: 'ตั้งค่ายืนยันตัวตนสองชั้น',
    subtitle: 'บัญชีเจ้าหน้าที่ต้องผูกกับเครื่องยืนยันตัวตนก่อนเข้าใช้งานครั้งแรก',
    step1: 'เปิดแอปยืนยันตัวตน (เช่น Google Authenticator หรือ Microsoft Authenticator) แล้วเพิ่มบัญชีด้วยรหัสนี้',
    secretLabel: 'รหัสลับสำหรับตั้งค่า',
    copied: 'คัดลอกแล้ว',
    copy: 'คัดลอก',
    step2: 'กรอกรหัส 6 หลักที่แอปแสดงอยู่ เพื่อยืนยันว่าผูกเครื่องสำเร็จ',
    codeLabel: 'รหัสจากแอป',
    submit: 'ยืนยันและเปิดใช้งาน',
    submitting: 'กำลังตรวจสอบ...',
    loading: 'กำลังเตรียมรหัสลับ...',
    setupFailed: 'ระบบเตรียมรหัสลับไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
    invalidCode: 'รหัสไม่ถูกต้อง กรุณาตรวจว่าเวลาบนเครื่องตรงกับเวลาจริง แล้วลองรหัสล่าสุดอีกครั้ง',
    doneTitle: 'เปิดใช้งานเรียบร้อย',
    doneBody: 'เก็บรหัสสำรองด้านล่างไว้ในที่ปลอดภัย ระบบจะไม่แสดงอีก หากทำเครื่องยืนยันตัวตนหาย รหัสเหล่านี้คือทางเดียวที่จะเข้าระบบได้',
    backupLabel: 'รหัสสำรอง',
    backToLogin: 'กลับไปเข้าสู่ระบบ',
    loginAgainNote: 'ระบบจะขอรหัสจากแอปอีกครั้งตอนเข้าสู่ระบบ',
};

export default function MfaEnrolmentForm({ setupToken, onDone }: MfaEnrolmentFormProps) {
    const [setup, setSetup] = useState<SetupData | null>(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

    const auth = useCallback(
        () => ({ Authorization: `Bearer ${setupToken}` }),
        [setupToken],
    );

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const result = await apiClient.post<SetupData>(providerApiPaths.mfaSetup, {}, { headers: auth() });
            if (cancelled) { return; }
            if (result.success && result.data?.secret) {
                setSetup(result.data);
            } else {
                setError(COPY.setupFailed);
            }
        })();
        return () => { cancelled = true; };
    }, [auth]);

    async function handleVerify(e: React.FormEvent) {
        e.preventDefault();
        if (code.length !== 6) { return; }
        setBusy(true);
        setError(null);
        const result = await apiClient.post<{ backupCodes?: string[] }>(
            // /api/mfa is where the backend mounts the router (routes/api/index.js); the old
            // identity-prefixed path was never mounted and 404'd (security re-review 2026-09-26).
            providerApiPaths.mfaVerifySetup, { code }, { headers: auth() },
        );
        setBusy(false);
        if (result.success) {
            setBackupCodes(result.data?.backupCodes ?? []);
            return;
        }
        setError(COPY.invalidCode);
    }

    if (backupCodes) {
        return (
            <div className="space-y-5">
                <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-leaf-soft text-leaf-onSoft">
                        <Check size={22} strokeWidth={3} />
                    </span>
                    <div>
                        <h2 className="text-lg font-bold text-foreground">{COPY.doneTitle}</h2>
                        <p className="text-sm text-muted-foreground">{COPY.loginAgainNote}</p>
                    </div>
                </div>
                <p className="text-sm text-foreground">{COPY.doneBody}</p>
                <div>
                    <p className="mb-2 text-sm font-semibold text-foreground">{COPY.backupLabel}</p>
                    <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3">
                        {backupCodes.map((c) => (
                            <li key={c} className="font-mono text-sm tabular-nums text-foreground">{c}</li>
                        ))}
                    </ul>
                </div>
                <button
                    type="button"
                    onClick={onDone}
                    className="min-h-[48px] w-full rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
                >
                    {COPY.backToLogin}
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={handleVerify} className="space-y-5">
            <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-leaf-soft text-leaf-onSoft">
                    <ShieldPlus size={22} />
                </span>
                <div>
                    <h2 className="text-lg font-bold text-foreground">{COPY.title}</h2>
                    <p className="text-sm text-muted-foreground">{COPY.subtitle}</p>
                </div>
            </div>

            <div>
                <p className="mb-2 text-sm text-foreground">{COPY.step1}</p>
                {setup ? (
                    <div className="flex items-center gap-2">
                        <code
                            data-testid="mfa-setup-secret"
                            className="flex-1 break-all rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm text-foreground"
                        >
                            {setup.secret}
                        </code>
                        <button
                            type="button"
                            aria-label={COPY.copy}
                            onClick={() => {
                                void navigator.clipboard?.writeText(setup.secret);
                                setCopied(true);
                            }}
                            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border"
                        >
                            {copied ? <Check size={18} /> : <Copy size={18} />}
                        </button>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">{COPY.loading}</p>
                )}
                {copied && <p className="mt-1 text-xs text-leaf-700">{COPY.copied}</p>}
            </div>

            <div>
                <label htmlFor="mfa-setup-code" className="mb-1 block text-sm font-semibold text-foreground">
                    {COPY.codeLabel}
                </label>
                <p className="mb-2 text-sm text-muted-foreground">{COPY.step2}</p>
                <input
                    id="mfa-setup-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="min-h-[48px] w-full rounded-lg border border-border px-3 text-center font-mono text-xl tracking-[0.4em]"
                />
            </div>

            {error && (
                <div role="alert" aria-live="polite" className="rounded border border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={busy || code.length !== 6 || !setup}
                className="min-h-[48px] w-full rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
            >
                {busy ? COPY.submitting : COPY.submit}
            </button>
        </form>
    );
}
