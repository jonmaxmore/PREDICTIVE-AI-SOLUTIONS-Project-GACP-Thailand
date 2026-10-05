'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';

import { AuthService } from '@/lib/services/auth-service';
import { useAuth } from '@/lib/services/auth-provider';
import {
    PdpaErasureService,
    type ErasureSummary,
} from '@/lib/services/pdpa-erasure-service';
import { Button } from '@/components/ui/primitives/button';
import { notifications } from '@/lib/notifications';
import { SummaryHeader } from '@/components/feature';

import {
    AwaitingStep,
    ConfirmStep,
    LegalFooter,
    RequestStep,
    ReviewStep,
    SuccessStep,
} from './steps';

/**
 * 5-state UI machine for the PDPA ม.32 right-to-forget flow:
 * review → request → awaiting → confirm → success. The URL
 * ?requestId=...&token=... lands users in `confirm` from the in-app
 * notification's click-through link.
 * Mirrors docs/security/pdpa-erasure-2026-05-16.md L54-94. R6-C split
 * step Cards / awaiting / success / footer into 6 sibling components
 * under `./steps/` (R4 review M-2). State + handlers stay here;
 * subcomponents are pure props-driven presentational.
 */
type Step = 'review' | 'request' | 'awaiting' | 'confirm' | 'success';

const LOGOUT_COUNTDOWN_SECS = 30;

export default function ClientView() {
    const router = useRouter();
    const search = useSearchParams();
    const { user, isLoading: authLoading } = useAuth();

    const urlRequestId = search.get('requestId') || '';
    const urlToken = search.get('token') || '';
    const hasUrlPrefill = Boolean(urlRequestId && urlToken);

    const [step, setStep] = useState<Step>(hasUrlPrefill ? 'confirm' : 'review');
    const [reason, setReason] = useState<string>('');
    const [requestId, setRequestId] = useState<string>(urlRequestId);
    const [token, setToken] = useState<string>(urlToken);
    const [expiresAt, setExpiresAt] = useState<string>('');
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [summary, setSummary] = useState<ErasureSummary | null>(null);
    const [countdown, setCountdown] = useState<number>(LOGOUT_COUNTDOWN_SECS);

    // Auth gate — HEALTH self-service. Redirect to login if no user
    // session. We wait for the AuthProvider initial load to settle so
    // a hydration flicker does not redirect a logged-in user.
    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            router.replace('/auth/health/login');
        }
    }, [authLoading, user, router]);

    // Success-state logout countdown. The user's session is no longer
    // valid against the new anonymised record; we sign them out and
    // bounce home so the next request does not 401 mid-page.
    useEffect(() => {
        if (step !== 'success') return;
        if (countdown <= 0) {
            void (async () => {
                try {
                    await AuthService.logout();
                } catch {
                    /* fall through — redirect anyway */
                }
                router.replace('/');
            })();
            return;
        }
        const timer = setTimeout(() => setCountdown((n) => n - 1), 1000);
        return () => clearTimeout(timer);
    }, [step, countdown, router]);

    const handleSubmitRequest = useCallback(async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
            const res = await PdpaErasureService.requestErasure({ reason });
            if (!res.success || !res.data) {
                notifications.show({
                    color: 'red',
                    title: 'เกิดข้อผิดพลาด',
                    message: res.error || 'ส่งคำขอลบบัญชีไม่สำเร็จ',
                });
                return;
            }
            setRequestId(res.data.requestId);
            setExpiresAt(res.data.expiresAt);
            // Test-mode hatch: if the backend echoed the token (NODE_ENV=test),
            // pre-fill it so E2E flows can advance without the SMTP fixture.
            if (res.data._testToken) {
                setToken(res.data._testToken);
            }
            setStep('awaiting');
            notifications.show({
                color: 'green',
                title: 'ส่งคำขอแล้ว',
                message: 'กรุณาตรวจสอบการแจ้งเตือนในระบบและกดลิงก์ยืนยันภายใน 24 ชั่วโมง',
            });
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'เกิดข้อผิดพลาด',
                message: err instanceof Error ? err.message : 'ส่งคำขอลบบัญชีไม่สำเร็จ',
            });
        } finally {
            setSubmitting(false);
        }
    }, [reason, submitting]);

    const handleConfirm = useCallback(async () => {
        if (submitting) return;
        if (!requestId || !token) {
            notifications.show({
                color: 'red',
                title: 'ข้อมูลไม่ครบ',
                message: 'กรุณาระบุทั้งหมายเลขคำขอและรหัสยืนยัน',
            });
            return;
        }
        setSubmitting(true);
        try {
            const res = await PdpaErasureService.confirmErasure({ requestId, token });
            if (!res.success || !res.data) {
                notifications.show({
                    color: 'red',
                    title: 'ยืนยันคำขอไม่สำเร็จ',
                    message: res.error || 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุแล้ว',
                });
                return;
            }
            setSummary(res.data);
            setStep('success');
            notifications.show({
                color: 'orange',
                title: 'ลบบัญชีสำเร็จ',
                message: 'ระบบจะออกจากระบบในอีก 30 วินาที',
            });
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'ยืนยันคำขอไม่สำเร็จ',
                message: err instanceof Error ? err.message : 'รหัสยืนยันไม่ถูกต้อง',
            });
        } finally {
            setSubmitting(false);
        }
    }, [requestId, token, submitting]);

    const handleCancel = useCallback(async () => {
        if (submitting) return;
        if (!requestId) {
            notifications.show({
                color: 'red',
                title: 'ไม่มีคำขอที่จะยกเลิก',
                message: 'กรุณาส่งคำขอลบบัญชีก่อน',
            });
            return;
        }
        setSubmitting(true);
        try {
            const res = await PdpaErasureService.cancelErasure(requestId);
            if (!res.success) {
                notifications.show({
                    color: 'red',
                    title: 'ยกเลิกคำขอไม่สำเร็จ',
                    message: res.error || 'ไม่สามารถยกเลิกได้',
                });
                return;
            }
            notifications.show({
                color: 'green',
                title: 'ยกเลิกคำขอเรียบร้อย',
                message: 'คำขอลบบัญชีถูกยกเลิกแล้ว บัญชีของคุณยังใช้งานได้ตามปกติ',
            });
            // Reset to step 1 — the user can begin again if they wish.
            setReason('');
            setRequestId('');
            setToken('');
            setExpiresAt('');
            setStep('review');
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'ยกเลิกคำขอไม่สำเร็จ',
                message: err instanceof Error ? err.message : 'ไม่สามารถยกเลิกได้',
            });
        } finally {
            setSubmitting(false);
        }
    }, [requestId, submitting]);

    const preservedTables = useMemo<ReadonlyArray<string>>(() => (
        summary?.preserved ?? [
            'Invoice',
            'CreditNote',
            'DebitNote',
            'JournalEntry',
            'JournalLine',
            'PaymentTransaction',
            'AuditLog',
            'Certificate (anonymised, row kept)',
        ]
    ), [summary]);

    // Avoid rendering anything sensitive while auth is still bootstrapping.
    if (authLoading) {
        return (
            <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลังโหลด...
            </div>
        );
    }

    if (!user) {
        // Effect above already triggered the redirect — render a stub so
        // the page does not flash sensitive content during the bounce.
        return null;
    }

    return (
        <>
            <SummaryHeader
                eyebrow="ผู้ขอรับรอง · ลบบัญชี (PDPA ม.32)"
                title="ลบบัญชีของฉัน (2 ขั้นตอน)"
                description="สิทธิการลบข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 มาตรา 32 มีขั้นตอนยืนยันด้วยลิงก์ในการแจ้งเตือนของระบบเพื่อความปลอดภัย"
                actions={
                    <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => router.push('/health/profile/privacy')}
                    >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        กลับ
                    </Button>
                }
            />

            {step === 'review' ? (
                <ReviewStep
                    onContinue={() => setStep('request')}
                    onBack={() => router.push('/health/profile/privacy')}
                />
            ) : null}

            {step === 'request' ? (
                <RequestStep
                    reason={reason}
                    onChangeReason={setReason}
                    onSubmit={() => void handleSubmitRequest()}
                    onBack={() => setStep('review')}
                    submitting={submitting}
                />
            ) : null}

            {step === 'awaiting' ? (
                <AwaitingStep
                    requestId={requestId}
                    expiresAt={expiresAt}
                    onCancel={() => void handleCancel()}
                    onGotoConfirm={() => setStep('confirm')}
                    submitting={submitting}
                />
            ) : null}

            {step === 'confirm' ? (
                <ConfirmStep
                    requestId={requestId}
                    token={token}
                    onChangeRequestId={setRequestId}
                    onChangeToken={setToken}
                    onConfirm={() => void handleConfirm()}
                    onCancel={() => void handleCancel()}
                    submitting={submitting}
                    hasUrlPrefill={hasUrlPrefill}
                />
            ) : null}

            {step === 'success' && summary ? (
                <SuccessStep
                    summary={summary}
                    preservedTables={preservedTables}
                    countdown={countdown}
                />
            ) : null}

            <LegalFooter />
        </>
    );
}
