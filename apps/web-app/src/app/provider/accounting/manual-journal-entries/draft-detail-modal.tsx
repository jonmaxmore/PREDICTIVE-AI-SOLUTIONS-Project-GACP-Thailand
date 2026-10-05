'use client';

import { useState } from 'react';
import {
    IconAlertTriangle,
    IconCheck,
    IconNotebook,
    IconShieldX,
    IconUpload,
    IconX,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/primitives/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/primitives/dialog';
import { StatusBadge } from '@/components/finance';
import { useAuth } from '@/lib/services/auth-provider';
import { normalizeRole, CANONICAL_ROLES } from '@/lib/constants/canonical-roles';
import { formatTHB, formatThaiDate } from '@/lib/services/accounting-service';
import {
    ManualJournalEntryService,
    type ManualJournalEntryDraft,
    type ManualJournalEntryDraftLine,
} from '@/lib/services/finance-orphans-service';

/**
 * Draft Detail Modal — read-only line view + ADMIN-only state transitions
 * for Manual Journal Entry drafts. R1-C, 2026-05-17.
 *
 * Action gates (per RFC R1-C acceptance):
 *   - approveManualEntry / postManualEntry / rejectManualEntry are
 *     gated on `useAuth().user?.role === 'system_admin_dtam'` (frontend mirror of
 *     the backend ADMIN_ONLY route guard).
 *   - Non-admins see the buttons disabled with the tooltip
 * "เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้น".
 *
 * Error surfaces (mapped from backend HTTP responses):
 *   - 403 SELF_APPROVAL_FORBIDDEN → "ผู้สร้าง draft ไม่สามารถอนุมัติ
 *     draft ของตนเองได้ (TFRS NPAEs ch.2)"
 *   - 400 UNBALANCED_ENTRY / UNKNOWN_ACCOUNT_CODE → inline message
 *
 * After a successful action the parent's onRefresh is called and the
 * modal closes (the draft row's status changes upstream).
 */

interface DraftDetailModalProps {
    draft: ManualJournalEntryDraft | null;
    onClose: () => void;
    onRefresh: () => void;
}

type ActionKind = 'approve' | 'post' | 'reject';

const SELF_APPROVAL_THAI =
    'ผู้สร้าง draft ไม่สามารถอนุมัติ draft ของตนเองได้ (TFRS NPAEs ch.2)';
const ADMIN_ONLY_TOOLTIP = 'เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้น';

function toNum(v: unknown): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function mapErrorToThai(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err || '');
    if (!raw) return 'ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง';
    const upper = raw.toUpperCase();
    if (upper.includes('SELF_APPROVAL_FORBIDDEN')) return SELF_APPROVAL_THAI;
    if (upper.includes('UNBALANCED_ENTRY')) {
        return 'รายการบัญชีไม่สมดุล (เดบิต ≠ เครดิต) ' + raw;
    }
    if (upper.includes('UNKNOWN_ACCOUNT_CODE')) {
        return 'รหัสบัญชีไม่อยู่ในผังบัญชีมาตรฐาน ' + raw;
    }
    if (upper.includes('INVALID_STATE')) {
        return 'สถานะของร่างนี้ไม่อนุญาตให้ดำเนินการ ' + raw;
    }
    if (upper.includes('PERIOD_CLOSED')) {
        return 'งวดบัญชีถูกปิดแล้ว ไม่สามารถลงรายการได้ ' + raw;
    }
    return raw;
}

export function DraftDetailModal({ draft, onClose, onRefresh }: DraftDetailModalProps) {
    const { user } = useAuth();
    const isAdmin = normalizeRole(user?.role) === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;
    const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [rejectMode, setRejectMode] = useState<boolean>(false);
    const [rejectReason, setRejectReason] = useState<string>('');

    if (!draft) return null;

    const status = draft.status;
    const canApprove = isAdmin && status === 'DRAFT';
    const canPost = isAdmin && status === 'APPROVED';
    const canReject = isAdmin && (status === 'DRAFT' || status === 'APPROVED');

    const lines: ManualJournalEntryDraftLine[] = Array.isArray(draft.linesJson)
        ? draft.linesJson
        : [];

    const resetState = () => {
        setError(null);
        setPendingAction(null);
        setRejectMode(false);
        setRejectReason('');
    };

    const handleClose = () => {
        if (pendingAction) return;
        resetState();
        onClose();
    };

    const runAction = async (action: ActionKind) => {
        setPendingAction(action);
        setError(null);
        try {
            if (action === 'approve') {
                await ManualJournalEntryService.approveDraft(draft.id);
            } else if (action === 'post') {
                await ManualJournalEntryService.postDraft(draft.id);
            } else if (action === 'reject') {
                if (rejectReason.trim().length < 10) {
                    setError('เหตุผลในการปฏิเสธต้องมีความยาวอย่างน้อย 10 ตัวอักษร');
                    setPendingAction(null);
                    return;
                }
                await ManualJournalEntryService.rejectDraft(draft.id, {
                    reason: rejectReason.trim(),
                });
            }
            resetState();
            onRefresh();
            onClose();
        } catch (err) {
            setError(mapErrorToThai(err));
            setPendingAction(null);
        }
    };

    const totalDebit = toNum(draft.totalDebit);
    const totalCredit = toNum(draft.totalCredit);

    return (
        <Dialog open={!!draft} onOpenChange={(o) => (!o ? handleClose() : undefined)}>
            <DialogContent className="w-[min(100%-1.5rem,880px)] max-w-[880px] border-none p-0 shadow-lg">
                <DialogHeader className="rounded-t-lg bg-slate-900 p-5 text-white">
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                        <IconNotebook size={22} />
                        ใบสำคัญทั่วไป (Manual Journal Entry)
                    </DialogTitle>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="font-mono text-sm font-bold text-slate-100">
                            {draft.draftNumber}
                        </span>
                        <StatusBadge status={status} />
                        <span className="text-xs text-slate-300">
                            บันทึก ณ {formatThaiDate(draft.postingDate)}
                        </span>
                    </div>
                </DialogHeader>

                <div className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
                    {/* Top summary panel */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="rounded-xl border border-border bg-muted/40 p-3">
                            <p className="text-[10px] font-bold text-muted-foreground">
                                คำอธิบาย
                            </p>
                            <p className="mt-1 text-sm font-semibold text-foreground">
                                {draft.description}
                            </p>
                        </div>
                        <div className="rounded-xl border border-border bg-muted/40 p-3">
                            <p className="text-[10px] font-bold text-muted-foreground">
                                เหตุผล (Reason)
                            </p>
                            <p className="mt-1 text-sm text-foreground">{draft.reason}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-muted/40 p-3">
                            <p className="text-[10px] font-bold text-muted-foreground">
                                ผู้สร้าง
                            </p>
                            <p className="mt-1 font-mono text-xs text-foreground">
                                {draft.createdBy || '-'}
                            </p>
                            {draft.approvedBy ? (
                                <>
                                    <p className="mt-2 text-[10px] font-bold text-muted-foreground">
                                        ผู้อนุมัติ
                                    </p>
                                    <p className="mt-1 font-mono text-xs text-foreground">
                                        {draft.approvedBy}
                                    </p>
                                </>
                            ) : null}
                        </div>
                    </div>

                    {/* Lines table */}
                    <div className="overflow-hidden rounded-lg border border-border bg-card">
                        <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-bold text-foreground">
                            รายการบัญชี ({lines.length} บรรทัด)
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full table-auto text-sm">
                                <thead className="bg-muted/40">
                                    <tr className="border-b border-border">
                                        <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">#</th>
                                        <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">รหัสบัญชี</th>
                                        <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">ชื่อบัญชี</th>
                                        <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">เดบิต</th>
                                        <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">เครดิต</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {lines.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                                                ไม่มีรายการบัญชี
                                            </td>
                                        </tr>
                                    ) : (
                                        lines.map((line, idx) => (
                                            <tr key={`${line.lineNumber}-${idx}`}>
                                                <td className="px-3 py-2 text-sm text-muted-foreground">
                                                    {line.lineNumber ?? idx + 1}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-xs font-semibold text-foreground">
                                                    {line.accountCode}
                                                </td>
                                                <td className="px-3 py-2 text-sm text-foreground">
                                                    {line.accountName || '-'}
                                                </td>
                                                <td className="px-3 py-2 text-right text-sm tabular-nums text-foreground">
                                                    {toNum(line.debit) > 0
                                                        ? formatTHB(toNum(line.debit), false)
                                                        : '-'}
                                                </td>
                                                <td className="px-3 py-2 text-right text-sm tabular-nums text-foreground">
                                                    {toNum(line.credit) > 0
                                                        ? formatTHB(toNum(line.credit), false)
                                                        : '-'}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                                <tfoot className="border-t border-border bg-muted/40">
                                    <tr>
                                        <td colSpan={3} className="px-3 py-3 text-right text-sm font-bold text-foreground">
                                            ยอดรวม
                                        </td>
                                        <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-foreground">
                                            {formatTHB(totalDebit, false)}
                                        </td>
                                        <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-foreground">
                                            {formatTHB(totalCredit, false)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* Audit metadata for terminal states */}
                    {status === 'POSTED' && draft.postedJournalEntryId ? (
                        <div className="rounded-xl border border-leaf-300 bg-leaf-soft p-3 text-sm text-leaf-onSoft">
                            ลงบัญชีแล้ว → JournalEntry ID:{' '}
                            <code className="font-mono text-xs">{draft.postedJournalEntryId}</code>
                            {draft.postedAt ? (
                                <span className="ml-2 text-xs">
                                    ({formatThaiDate(draft.postedAt)})
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                    {status === 'REJECTED' ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                            <p className="font-bold">ถูกปฏิเสธ</p>
                            {draft.rejectionReason ? (
                                <p className="mt-1">เหตุผล: {draft.rejectionReason}</p>
                            ) : null}
                            {draft.rejectedBy ? (
                                <p className="mt-1 font-mono text-xs">โดย: {draft.rejectedBy}</p>
                            ) : null}
                        </div>
                    ) : null}

                    {/* Error surface */}
                    {error ? (
                        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                            <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    ) : null}

                    {/* Reject reason — only when reject mode active */}
                    {rejectMode ? (
                        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                            <label
                                htmlFor="mje-reject-reason"
                                className="mb-1 block text-xs font-bold text-amber-900"
                            >
                                เหตุผลการปฏิเสธ <span className="text-rose-600">*</span>
                                <span className="ml-1 font-normal text-amber-800">
                                    ≥ 10 ตัวอักษร
                                </span>
                            </label>
                            <textarea
                                id="mje-reject-reason"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                rows={3}
                                disabled={pendingAction !== null}
                                placeholder="ระบุเหตุผลให้ผู้สร้างทราบ"
                                className="w-full rounded-lg border border-amber-300 bg-card p-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-muted"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setRejectMode(false);
                                        setRejectReason('');
                                        setError(null);
                                    }}
                                    disabled={pendingAction !== null}
                                    className="rounded-lg"
                                >
                                    ยกเลิก
                                </Button>
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => runAction('reject')}
                                    // X4-FIX-D H-9 — JE reject-confirm is the actual irreversible
                                    // action. 44px per WCAG 2.5.5.
                                    disabled={
                                        pendingAction !== null
                                        || rejectReason.trim().length < 10
                                    }
                                    className="min-h-[44px] min-w-[44px] rounded-lg"
                                >
                                    {pendingAction === 'reject'
                                        ? 'กำลังบันทึก...'
                                        : 'ยืนยันการปฏิเสธ'}
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Action footer — the approve/post/reject buttons render only for
                    ADMIN, the one role the backend lets decide (ADMIN_ONLY). Every
                    other viewer — both finance roles included — sees the notice
                    instead of disabled buttons (operator 2026-09-27: a write button
                    renders only for a role that may press it). */}
                <div className="flex flex-col-reverse gap-2 border-t border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleClose}
                        disabled={pendingAction !== null}
                        className="rounded-lg"
                    >
                        ปิด
                    </Button>
                    {!rejectMode && !isAdmin && (status === 'DRAFT' || status === 'APPROVED') ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <IconShieldX size={12} />
                            {ADMIN_ONLY_TOOLTIP}
                        </span>
                    ) : null}
                    {!rejectMode && isAdmin ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {/* Approve — DRAFT → APPROVED */}
                            <span
                                className="inline-flex"
                            >
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={() => runAction('approve')}
                                    disabled={!canApprove || pendingAction !== null}
                                    // X4-FIX-D H-9 — JE approve is irreversible from DRAFT
                                    // (DRAFT → APPROVED locks the next step). 44px per WCAG 2.5.5.
                                    className="min-h-[44px] min-w-[44px] rounded-lg"
                                >
                                    <IconCheck size={16} className="mr-1" />
                                    {pendingAction === 'approve' ? 'กำลังอนุมัติ...' : 'อนุมัติ'}
                                </Button>
                            </span>
                            {/* Post — APPROVED → POSTED */}
                            <span
                                className="inline-flex"
                            >
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={() => runAction('post')}
                                    disabled={!canPost || pendingAction !== null}
                                    // X4-FIX-D H-9 — JE post is irreversible (APPROVED → POSTED
                                    // writes the JournalEntry to the books). 44px per WCAG 2.5.5.
                                    className="min-h-[44px] min-w-[44px] rounded-lg"
                                >
                                    <IconUpload size={16} className="mr-1" />
                                    {pendingAction === 'post' ? 'กำลังลงบัญชี...' : 'ลงบัญชี (Post)'}
                                </Button>
                            </span>
                            {/* Reject — DRAFT/APPROVED → REJECTED */}
                            <span
                                className="inline-flex"
                            >
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        setRejectMode(true);
                                        setError(null);
                                    }}
                                    disabled={!canReject || pendingAction !== null}
                                    // X4-FIX-D H-9 — JE reject is irreversible (locks the draft
                                    // into REJECTED). 44px per WCAG 2.5.5.
                                    className="min-h-[44px] min-w-[44px] rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                                >
                                    <IconX size={16} className="mr-1" />
                                    ปฏิเสธ
                                </Button>
                            </span>
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default DraftDetailModal;
