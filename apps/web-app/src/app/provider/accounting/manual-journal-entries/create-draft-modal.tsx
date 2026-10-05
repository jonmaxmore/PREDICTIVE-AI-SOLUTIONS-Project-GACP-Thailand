'use client';

import { useMemo, useState } from 'react';
import { IconAlertTriangle, IconNotebook, IconPlus, IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/ui/primitives/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/primitives/dialog';
import { formatTHB, todayIso } from '@/lib/services/accounting-service';
import {
    ManualJournalEntryService,
    type ManualJournalEntryDraftLineInput,
} from '@/lib/services/finance-orphans-service';
import { CoaAccountPicker } from './coa-account-picker';

/**
 * Create-Draft Modal — Manual Journal Entry. R1-C, 2026-05-17.
 *
 * Form requirements (per RFC R1-C acceptance):
 *   - description: required, free-form
 *   - postingDate: required ISO date (defaults to today)
 *   - reason: required, ≥ 10 chars (matches service-layer validator)
 *   - lines[]: dynamic table, ≥ 2 rows, each with accountCode + exactly
 *     one of debit/credit > 0
 *   - balance: sum(debits) === sum(credits) within 0.01 THB; refuse to
 *     submit otherwise with "เดบิตและเครดิตต้องเท่ากัน"
 *
 * Error surface:
 *   - UNBALANCED_ENTRY / UNKNOWN_ACCOUNT_CODE / VALIDATION_ERROR from the
 *     backend → inline banner with the Thai message.
 *
 * Reuses the project Dialog primitive and the canonical CoA picker.
 */

type LineRow = {
    /** Locally-unique row id — never sent to the backend. */
    rowId: string;
    accountCode: string;
    accountName: string;
    debit: string;   // kept as string for stable controlled-input behaviour
    credit: string;
};

interface CreateDraftModalProps {
    open: boolean;
    onClose: () => void;
    /** Called after a successful POST so the parent can re-fetch. */
    onCreated: () => void;
}

function newRow(): LineRow {
    return {
        rowId: Math.random().toString(36).slice(2, 10),
        accountCode: '',
        accountName: '',
        debit: '',
        credit: '',
    };
}

function toNum(s: string): number {
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export function CreateDraftModal({ open, onClose, onCreated }: CreateDraftModalProps) {
    const [description, setDescription] = useState<string>('');
    const [postingDate, setPostingDate] = useState<string>(todayIso());
    const [reason, setReason] = useState<string>('');
    const [rows, setRows] = useState<LineRow[]>(() => [newRow(), newRow()]);
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const totals = useMemo(() => {
        const totalDebit = round2(rows.reduce((acc, r) => acc + toNum(r.debit), 0));
        const totalCredit = round2(rows.reduce((acc, r) => acc + toNum(r.credit), 0));
        // RFC R1-C contracts 0.01 THB tolerance; backend uses same band.
        const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
        return { totalDebit, totalCredit, isBalanced };
    }, [rows]);

    const reset = () => {
        setDescription('');
        setPostingDate(todayIso());
        setReason('');
        setRows([newRow(), newRow()]);
        setError(null);
        setSubmitting(false);
    };

    const handleClose = () => {
        if (submitting) return;
        reset();
        onClose();
    };

    const updateRow = (rowId: string, patch: Partial<LineRow>) => {
        setRows((prev) =>
            prev.map((r) => {
                if (r.rowId !== rowId) return r;
                const next = { ...r, ...patch };
                // Enforce "exactly one of debit/credit per row" client-side
                // by clearing the opposite field when the user types into
                // either one. The server enforces too — this is just a UX
                // assist so they can't end up with both filled by mistake.
                if (patch.debit !== undefined && toNum(patch.debit) > 0) {
                    next.credit = '';
                }
                if (patch.credit !== undefined && toNum(patch.credit) > 0) {
                    next.debit = '';
                }
                return next;
            }),
        );
    };

    const addRow = () => setRows((prev) => [...prev, newRow()]);
    const removeRow = (rowId: string) => {
        setRows((prev) => (prev.length <= 2 ? prev : prev.filter((r) => r.rowId !== rowId)));
    };

    const validate = (): string | null => {
        if (!description.trim()) return 'กรุณาระบุคำอธิบาย (description)';
        if (!postingDate) return 'กรุณาเลือกวันที่บันทึกบัญชี (postingDate)';
        if (reason.trim().length < 10) return 'เหตุผลต้องมีความยาวอย่างน้อย 10 ตัวอักษร';
        if (rows.length < 2) return 'รายการบัญชีต้องมีอย่างน้อย 2 บรรทัด (เดบิต + เครดิต)';
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (!r) {
                continue;
            }
            if (!r.accountCode.trim()) {
                return `บรรทัดที่ ${i + 1}: กรุณาเลือกรหัสบัญชี`;
            }
            const dr = toNum(r.debit);
            const cr = toNum(r.credit);
            if (dr < 0 || cr < 0) {
                return `บรรทัดที่ ${i + 1}: จำนวนเงินต้องไม่เป็นค่าลบ`;
            }
            if (dr === 0 && cr === 0) {
                return `บรรทัดที่ ${i + 1}: ต้องระบุเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง`;
            }
            if (dr > 0 && cr > 0) {
                return `บรรทัดที่ ${i + 1}: ระบุเดบิตและเครดิตพร้อมกันไม่ได้`;
            }
        }
        if (!totals.isBalanced) return 'เดบิตและเครดิตต้องเท่ากัน';
        return null;
    };

    const handleSubmit = async () => {
        const v = validate();
        if (v) {
            setError(v);
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const lines: ManualJournalEntryDraftLineInput[] = rows.map((r, idx) => ({
                lineNumber: idx + 1,
                accountCode: r.accountCode.trim(),
                debit: toNum(r.debit),
                credit: toNum(r.credit),
            }));
            await ManualJournalEntryService.createDraft({
                description: description.trim(),
                postingDate,
                reason: reason.trim(),
                lines,
            });
            reset();
            onCreated();
            onClose();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'ไม่สามารถสร้างร่าง JE ได้ กรุณาลองอีกครั้ง';
            setError(msg);
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => (!o ? handleClose() : undefined)}>
            <DialogContent className="w-[min(100%-1.5rem,920px)] max-w-[920px] border-none p-0 shadow-lg">
                {/* X4-FIX-D H-7 — raw bg-emerald-700 → semantic bg-primary token. */}
                <DialogHeader className="rounded-t-lg bg-primary p-5 text-primary-foreground">
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                        <IconNotebook size={22} />
                        สร้างร่างใบสำคัญทั่วไป (Manual Journal Entry)
                    </DialogTitle>
                    <p className="mt-1 text-xs text-primary-foreground/80">
                        ใช้สำหรับรายการที่ไม่ผ่านการชำระอัตโนมัติ ค่าธรรมเนียมธนาคาร, FX gain/loss,
                        การแก้ไขปรับปรุง ตามมาตรฐาน TFRS for NPAEs ch.2
                    </p>
                </DialogHeader>

                <div className="max-h-[70vh] space-y-5 overflow-y-auto p-6">
                    {/* Header fields */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="md:col-span-2">
                            <label
                                htmlFor="mje-desc"
                                className="mb-1 block text-xs font-bold text-muted-foreground"
                            >
                                คำอธิบาย <span className="text-rose-600">*</span>
                            </label>
                            <input
                                id="mje-desc"
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                disabled={submitting}
                                placeholder="เช่น บันทึกค่าธรรมเนียมโอนเงินธนาคารกรุงไทย"
                                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted"
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (X4-FIX-D H-11).
                                autoFocus
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                                คำอธิบายจะถูกบันทึกในสมุดรายวันเป็น
                                <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">
                                    [MANUAL] {description || '...'}
                                </code>
                            </p>
                        </div>
                        <div>
                            <label
                                htmlFor="mje-date"
                                className="mb-1 block text-xs font-bold text-muted-foreground"
                            >
                                วันที่บันทึกบัญชี <span className="text-rose-600">*</span>
                            </label>
                            <input
                                id="mje-date"
                                type="date"
                                value={postingDate}
                                onChange={(e) => setPostingDate(e.target.value)}
                                disabled={submitting}
                                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted"
                            />
                        </div>
                        <div>
                            <label
                                htmlFor="mje-reason"
                                className="mb-1 block text-xs font-bold text-muted-foreground"
                            >
                                เหตุผล (Reason) <span className="text-rose-600">*</span>
                                <span className="ml-1 font-normal text-muted-foreground">
                                    ≥ 10 ตัวอักษร
                                </span>
                            </label>
                            <input
                                id="mje-reason"
                                type="text"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                disabled={submitting}
                                placeholder="ระบุเหตุผลเพื่อการตรวจสอบ"
                                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted"
                            />
                        </div>
                    </div>

                    {/* Lines table */}
                    <div className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm font-bold text-foreground">
                                รายการบัญชี
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                    (ต้องมีอย่างน้อย 2 บรรทัด, ผลรวมเดบิตและเครดิตต้องเท่ากัน)
                                </span>
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={addRow}
                                disabled={submitting}
                                className="rounded-lg"
                            >
                                <IconPlus size={14} className="mr-1" />
                                เพิ่มบรรทัด
                            </Button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full table-auto text-sm">
                                <thead className="bg-muted/40">
                                    <tr className="border-b border-border">
                                        <th className="px-2 py-2 text-left text-xs font-bold text-muted-foreground" style={{ width: '4%' }}>#</th>
                                        <th className="px-2 py-2 text-left text-xs font-bold text-muted-foreground">รหัส/ชื่อบัญชี</th>
                                        <th className="px-2 py-2 text-right text-xs font-bold text-muted-foreground" style={{ width: '18%' }}>เดบิต (THB)</th>
                                        <th className="px-2 py-2 text-right text-xs font-bold text-muted-foreground" style={{ width: '18%' }}>เครดิต (THB)</th>
                                        <th className="px-2 py-2 text-center text-xs font-bold text-muted-foreground" style={{ width: '6%' }}></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {rows.map((row, idx) => (
                                        <tr key={row.rowId}>
                                            <td className="px-2 py-2 text-sm text-muted-foreground">
                                                {idx + 1}
                                            </td>
                                            <td className="px-2 py-2">
                                                <CoaAccountPicker
                                                    id={`mje-line-${row.rowId}`}
                                                    value={row.accountCode}
                                                    onChange={({ accountCode, accountName }) =>
                                                        updateRow(row.rowId, { accountCode, accountName })
                                                    }
                                                    disabled={submitting}
                                                />
                                            </td>
                                            <td className="px-2 py-2">
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    step="0.01"
                                                    min={0}
                                                    value={row.debit}
                                                    onChange={(e) =>
                                                        updateRow(row.rowId, { debit: e.target.value })
                                                    }
                                                    disabled={submitting}
                                                    placeholder="0.00"
                                                    aria-label={`เดบิต แถวที่ ${idx + 1}`}
                                                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted"
                                                />
                                            </td>
                                            <td className="px-2 py-2">
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    step="0.01"
                                                    min={0}
                                                    value={row.credit}
                                                    onChange={(e) =>
                                                        updateRow(row.rowId, { credit: e.target.value })
                                                    }
                                                    disabled={submitting}
                                                    placeholder="0.00"
                                                    aria-label={`เครดิต แถวที่ ${idx + 1}`}
                                                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted"
                                                />
                                            </td>
                                            <td className="px-2 py-2 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => removeRow(row.rowId)}
                                                    disabled={submitting || rows.length <= 2}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-30"
                                                    aria-label={`ลบบรรทัดที่ ${idx + 1}`}
                                                    title="ลบบรรทัดนี้"
                                                >
                                                    <IconTrash size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="border-t border-border bg-muted/40">
                                    <tr>
                                        <td colSpan={2} className="px-2 py-3 text-right text-sm font-bold text-foreground">
                                            ยอดรวม
                                        </td>
                                        <td className="px-2 py-3 text-right text-sm font-bold tabular-nums text-foreground">
                                            {formatTHB(totals.totalDebit, false)}
                                        </td>
                                        <td className="px-2 py-3 text-right text-sm font-bold tabular-nums text-foreground">
                                            {formatTHB(totals.totalCredit, false)}
                                        </td>
                                        <td className="px-2 py-3"></td>
                                    </tr>
                                    <tr>
                                        <td colSpan={5} className="px-2 pb-3">
                                            {totals.isBalanced ? (
                                                <div className="rounded-lg border border-leaf-300 bg-leaf-soft px-3 py-2 text-xs font-semibold text-leaf-onSoft">
                                                    เดบิตและเครดิตสมดุล (Dr = Cr ={' '}
                                                    {formatTHB(totals.totalDebit)})
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                                                    <IconAlertTriangle size={14} />
                                                    เดบิตและเครดิตต้องเท่ากัน ขาดดุล{' '}
                                                    {formatTHB(
                                                        Math.abs(totals.totalDebit - totals.totalCredit),
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {error ? (
                        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                            <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    ) : null}
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-border bg-muted/40 p-4 sm:flex-row sm:justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleClose}
                        disabled={submitting}
                        className="rounded-lg"
                    >
                        ยกเลิก
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={submitting || !totals.isBalanced}
                        className="rounded-lg"
                    >
                        {submitting ? 'กำลังบันทึก...' : 'บันทึกร่าง JE'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default CreateDraftModal;
