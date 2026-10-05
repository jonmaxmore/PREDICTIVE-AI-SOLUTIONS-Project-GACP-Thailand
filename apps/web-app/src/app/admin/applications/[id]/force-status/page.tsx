'use client';

export const dynamic = 'force-dynamic';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, ShieldCheck, Undo2, Loader2 } from 'lucide-react';

import { AdminPageShell, ForceStatusModal } from '@/components/admin';
import { SummaryCard, StatusBadge } from '@/components/finance';
import { apiClient } from '@/lib/api/api-client';
import { AdminB28Service } from '@/lib/services/admin-service-b28';
import { getStatusLabel } from '@/lib/constants/workflow-states';
import { cn } from '@/lib/utils';

/**
 * /admin/applications/[id]/force-status — Iter 28 emergency override.
 *
 * Renders a context page showing the current application status, a
 * danger banner, and a single CTA that opens the ForceStatusModal.
 * The route lives under /admin so the same auth-gating as
 * /admin/dashboard kicks in (ADMIN role on the backend gates the
 * actual mutation).
 *
 * The page intentionally keeps a small surface — the heavy lifting
 * (validation, double-confirm, audit logging) lives in the modal +
 * server.
 */

interface ApplicationSummary {
    id: string;
    applicationNumber?: string;
    status: string;
    applicantName?: string;
    plantType?: string;
    submittedAt?: string;
    updatedAt?: string;
}

export default function ForceStatusPage() {
    const params = useParams();
    const router = useRouter();
    const applicationId = String(params?.id || '');

    const [app, setApp] = React.useState<ApplicationSummary | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [modalOpen, setModalOpen] = React.useState(false);
    const [revertOpen, setRevertOpen] = React.useState(false);
    const [confirmation, setConfirmation] = React.useState<{
        status: string;
        when: string;
    } | null>(null);

    const load = React.useCallback(async () => {
        if (!applicationId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await apiClient.get<ApplicationSummary>(
                `/provider/applications/${applicationId}`,
            );
            if (res.success && res.data) {
                setApp(res.data);
            } else {
                setError(res.error || 'ไม่พบคำขอที่ระบุ');
            }
        } catch {
            setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setLoading(false);
        }
    }, [applicationId]);

    React.useEffect(() => {
        void load();
    }, [load]);

    return (
        <AdminPageShell
            eyebrow="ผู้ดูแลระบบ · เปลี่ยนสถานะฉุกเฉิน"
            title="เปลี่ยนสถานะคำขอแบบฉุกเฉิน"
            subtitle={`รหัสคำขอ: ${applicationId}`}
            actions={[
                {
                    label: 'กลับไปดูคำขอ',
                    variant: 'outline',
                    href: `/provider/applications/${applicationId}`,
                    icon: <ArrowLeft className="h-4 w-4" aria-hidden="true" />,
                },
                {
                    label: 'เปิดการเปลี่ยนสถานะ',
                    variant: 'primary',
                    onClick: () => setModalOpen(true),
                    icon: <ShieldAlert className="h-4 w-4" aria-hidden="true" />,
                    disabled: !app && !loading,
                },
                {
                    label: 'ย้อนกลับการเปลี่ยนแปลงล่าสุด',
                    variant: 'outline',
                    onClick: () => setRevertOpen(true),
                    icon: <Undo2 className="h-4 w-4" aria-hidden="true" />,
                    disabled: !app && !loading,
                    description: 'ยกเลิก transition ล่าสุดของคำขอนี้',
                },
            ]}
        >
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
                <p className="flex items-center gap-2 font-bold">
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    หน้านี้สำหรับผู้ดูแลระบบเท่านั้น
                </p>
                <p className="mt-1">
                    การเปลี่ยนสถานะที่นี่ข้ามขั้นตอน Workflow ปกติทั้งหมด
                    ระบบจะบันทึก audit trail (ผู้ดำเนินการ + วันเวลา + เหตุผล)
                    ถาวรและไม่สามารถย้อนกลับได้
                </p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                    กำลังโหลดข้อมูลคำขอ...
                </div>
            ) : error ? (
                <div
                    role="alert"
                    className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800"
                >
                    {error}
                    <div className="mt-2">
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="text-sm font-semibold underline"
                        >
                            ลองอีกครั้ง
                        </button>
                    </div>
                </div>
            ) : app ? (
                <SummaryCard
                    org={app.applicantName || 'ไม่ระบุผู้ยื่นคำขอ'}
                    contextPill={app.applicationNumber || applicationId.slice(0, 12)}
                    totals={[
                        {
                            label: 'สถานะปัจจุบัน',
                            value: app.status ? getStatusLabel(app.status) : 'ไม่ทราบสถานะ',
                            emphasis: 'primary',
                        },
                        {
                            label: 'ประเภทพืช',
                            value: app.plantType || '-',
                        },
                    ]}
                    meta={[
                        {
                            label: 'ยื่นเมื่อ',
                            value: app.submittedAt
                                ? new Date(app.submittedAt).toLocaleString('th-TH')
                                : '-',
                        },
                        {
                            label: 'อัปเดตล่าสุด',
                            value: app.updatedAt
                                ? new Date(app.updatedAt).toLocaleString('th-TH')
                                : '-',
                        },
                    ]}
                />
            ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                    ไม่พบข้อมูลคำขอ
                </div>
            )}

            {confirmation ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-2 rounded-xl border border-leaf-300 bg-leaf-soft p-4 text-sm text-primary-900"
                >
                    <ShieldCheck className="mt-0.5 h-4 w-4" aria-hidden="true" />
                    <div>
                        <p className="font-bold">
                            เปลี่ยนสถานะสำเร็จเป็น{' '}
                            <StatusBadge status={confirmation.status} label={getStatusLabel(confirmation.status)} />
                        </p>
                        <p className="mt-1 text-xs">
                            บันทึกใน audit log เมื่อ {confirmation.when}
                        </p>
                        <div className="mt-2 flex gap-3 text-xs">
                            <Link
                                href={`/provider/applications/${applicationId}`}
                                className="font-semibold underline"
                            >
                                ดูคำขอ
                            </Link>
                            <Link
                                href="/admin/audit-log"
                                className="font-semibold underline"
                            >
                                ดู audit log
                            </Link>
                        </div>
                    </div>
                </div>
            ) : null}

            {app ? (
                <ForceStatusModal
                    applicationId={applicationId}
                    currentStatus={app.status}
                    open={modalOpen}
                    onClose={() => setModalOpen(false)}
                    onSuccess={(newStatus) => {
                        setConfirmation({
                            status: newStatus,
                            when: new Date().toLocaleString('th-TH'),
                        });
                        void load();
                        // Keep the user on the page so they can see the
                        // confirmation banner; the modal already closed.
                        router.refresh();
                    }}
                />
            ) : null}

            {app ? (
                <RevertLastTransitionModal
                    applicationId={applicationId}
                    currentStatus={app.status}
                    open={revertOpen}
                    onClose={() => setRevertOpen(false)}
                    onSuccess={(previousStatus) => {
                        setConfirmation({
                            status: previousStatus,
                            when: new Date().toLocaleString('th-TH'),
                        });
                        void load();
                        router.refresh();
                    }}
                />
            ) : null}
        </AdminPageShell>
    );
}

/**
 * RevertLastTransitionModal — V5-D UX-B2 inline modal for the
 * `POST /api/admin/applications/:id/revert-last-transition` endpoint.
 *
 * Kept inline because it's only used on this page and shares the
 * page's destructive-action tone. Reason ≥ 10 chars per backend
 * gate.
 */
interface RevertLastTransitionModalProps {
    applicationId: string;
    currentStatus: string;
    open: boolean;
    onClose: () => void;
    onSuccess?: (previousStatus: string) => void;
    submitHandler?: (
        applicationId: string,
        reason: string,
    ) => Promise<{
        success: boolean;
        message?: string;
        data?: { previousStatus: string };
    }>;
}

function RevertLastTransitionModal({
    applicationId,
    currentStatus,
    open,
    onClose,
    onSuccess,
    submitHandler,
}: RevertLastTransitionModalProps) {
    const [reason, setReason] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!open) {
            setReason('');
            setErrorMsg(null);
            setSubmitting(false);
        }
    }, [open]);

    if (!open) return null;

    const reasonTooShort = reason.trim().length < 10;
    const canSubmit = !reasonTooShort && !submitting;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setErrorMsg(null);
        try {
            const handler =
                submitHandler ??
                ((id: string, r: string) =>
                    AdminB28Service.revertLastTransition(id, r));
            const res = await handler(applicationId, reason.trim());
            if (res.success) {
                onSuccess?.(res.data?.previousStatus || currentStatus);
                onClose();
            } else {
                setErrorMsg(res.message || 'ไม่สามารถย้อนกลับการเปลี่ยนแปลงได้');
            }
        } catch {
            setErrorMsg('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        // X6-B: W5-C `<button>` backdrop + `<div role="dialog">` split.
        // Mirrors X5-FIX-B H-9 pattern (ChangeRoleModal /
        // UserDisableModal). Closes both click-events-have-key-events and
        // no-noninteractive-element-interactions warnings; preserves
        // click-outside-to-close via native button keyboard activation.
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4">
            <button
                type="button"
                aria-label="ปิดหน้าต่าง"
                className="absolute inset-0 cursor-default bg-slate-900/60"
                onClick={onClose}
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="revert-last-transition-title"
                className="relative flex max-h-[100vh] w-full flex-col overflow-hidden bg-white shadow-2xl md:max-h-[90vh] md:w-full md:max-w-md md:rounded-2xl"
            >
                <header className="border-b border-amber-200 bg-amber-50 px-5 py-4">
                    <h2
                        id="revert-last-transition-title"
                        className="flex items-center gap-2 text-base font-bold text-amber-900"
                    >
                        <Undo2 className="h-5 w-5" aria-hidden="true" />
                        ย้อนกลับการเปลี่ยนแปลงล่าสุด
                    </h2>
                    <p className="mt-1 text-xs text-amber-800">
                        ลบ workflow transition ล่าสุดและคืนสถานะกลับเป็นสถานะก่อนหน้า
                    </p>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <div>
                        <p className="text-xs font-bold text-slate-800">คำขอ</p>
                        <p className="mt-1 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                            {applicationId}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                            สถานะปัจจุบัน:{' '}
                            <span className="font-semibold">{getStatusLabel(currentStatus)}</span>
                        </p>
                    </div>

                    <div>
                        <label
                            htmlFor="revert-reason"
                            className="mb-1 block text-xs font-bold text-slate-800"
                        >
                            เหตุผลในการย้อนกลับ <span className="text-rose-600">*</span>
                        </label>
                        <textarea
                            id="revert-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            placeholder="เช่น Force-status ที่ผ่านมาเกิดความผิดพลาด ต้องคืนสถานะเดิม (อย่างน้อย 10 ตัวอักษร)"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                            aria-required="true"
                            data-testid="revert-reason"
                        />
                        <p className="mt-1 text-[11px] text-slate-500">
                            ระบุอย่างน้อย 10 ตัวอักษร บันทึกใน audit log
                        </p>
                    </div>

                    {errorMsg ? (
                        <div
                            role="alert"
                            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
                        >
                            {errorMsg}
                        </div>
                    ) : null}
                </div>

                <footer className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 md:flex-row md:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        ยกเลิก
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        data-testid="revert-submit"
                        className={cn(
                            'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold text-white',
                            canSubmit
                                ? 'bg-amber-600 hover:bg-amber-700'
                                : 'cursor-not-allowed bg-amber-300',
                        )}
                    >
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                            <Undo2 className="h-4 w-4" aria-hidden="true" />
                        )}
                        ยืนยันย้อนกลับ
                    </button>
                </footer>
            </div>
        </div>
    );
}
