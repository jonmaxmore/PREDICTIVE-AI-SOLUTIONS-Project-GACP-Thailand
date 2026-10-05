'use client';

import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { ThemeIcon } from '@/components/ui/icon-buttons';
import { Modal } from '@/components/ui/overlays';
import { Textarea } from '@/components/ui/textarea';
import { IconCheck, IconPhoto, IconPlus, IconTrash, IconUpload, IconX } from "@tabler/icons-react";
import { type AuditDecision, type AuditEvidenceFile } from './provider-audit-job-sheet-config';

export interface CARFinding {
    nonConformity: string;
    correctiveAction: string;
    category: string;
}

interface AuditDecisionModalProps {
    opened: boolean;
    decision: AuditDecision;
    decisionNotes: string;
    evidenceFiles: AuditEvidenceFile[];
    findings: CARFinding[];
    isCompressing: boolean;
    isSubmitting: boolean;
    onClose: () => void;
    onDecisionNotesChange: (value: string) => void;
    onEvidenceUpload: (files: File[]) => void;
    onRemoveEvidence: (id: string) => void;
    onFindingsChange: (findings: CARFinding[]) => void;
    formatBytes: (bytes: number) => string;
    onSubmit: () => void;
}

export function AuditDecisionModal({
    opened,
    decision,
    decisionNotes,
    evidenceFiles,
    findings,
    isCompressing,
    isSubmitting,
    onClose,
    onDecisionNotesChange,
    onEvidenceUpload,
    onRemoveEvidence,
    onFindingsChange,
    formatBytes,
    onSubmit,
}: AuditDecisionModalProps) {
    const isCAR = decision === 'MINOR' || decision === 'MAJOR';
    const isReject = decision === 'REJECT';

    const addFinding = () => {
        onFindingsChange([...findings, { nonConformity: '', correctiveAction: '', category: '' }]);
    };

    const updateFinding = (index: number, field: keyof CARFinding, value: string) => {
        const updated = findings.map((f, i) =>
            i === index ? { ...f, [field]: value } : f
        );
        onFindingsChange(updated);
    };

    const removeFinding = (index: number) => {
        onFindingsChange(findings.filter((_, i) => i !== index));
    };

    return (
        <Modal opened={opened} onClose={onClose} title={`ส่งผลการตรวจ: ${decision}`} centered size="lg">
            <div className="flex flex-col">
                {/* ── Structured CAR Findings ── */}
                {isCAR && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/30 dark:bg-amber-950/20">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-bold text-foreground">
                                    สิ่งที่ไม่เป็นไปตามข้อกำหนด (CAR)
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    ระบุจุดที่ผิดและสิ่งที่ต้องแก้ไข
                                </p>
                            </div>
                            <Button size="sm" variant="outline" onClick={addFinding} className="rounded-lg">
                                <IconPlus size={14} className="mr-1" aria-hidden="true" />
                                เพิ่มรายการ
                            </Button>
                        </div>
                        {findings.length === 0 && (
                            <p className="py-4 text-center text-sm italic text-muted-foreground">
                                กดปุ่ม &quot;เพิ่มรายการ&quot; เพื่อเพิ่ม CAR
                            </p>
                        )}
                        <div className="space-y-3">
                            {findings.map((finding, idx) => (
                                <div key={idx} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                                    <div className="mb-2 flex items-center justify-between">
                                        <Badge variant="secondary" className="rounded-md text-xs">
                                            ข้อ {idx + 1}
                                        </Badge>
                                        {/* X3-FIX-C H-10: 28×28 → 44×44 to meet WCAG 2.5.5 tap target. */}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => removeFinding(idx)}
                                            className="h-11 min-h-[44px] w-11 min-w-[44px] p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                                            aria-label="ลบรายการ"
                                        >
                                            <IconTrash size={14} aria-hidden="true" />
                                        </Button>
                                    </div>
                                    <div className="space-y-2">
                                        <Textarea
                                            label="จุดที่ผิด (Non-Conformity)"
                                            placeholder="ระบุข้อบกพร่องที่พบ เช่น ไม่มีการบันทึกการใช้สารเคมี"
                                            value={finding.nonConformity}
                                            onChange={(e) => updateFinding(idx, 'nonConformity', e.currentTarget.value)}
                                            // X3-FIX-C H-11: autoFocus first CAR finding so auditor can
                                            // immediately type without tab-hunting.
                                            // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (see X2-FIX-A M-13).
                                            autoFocus={idx === 0}
                                        />
                                        <Textarea
                                            label="สิ่งที่ต้องแก้ไข (Corrective Action)"
                                            placeholder="ระบุการแก้ไข เช่น จัดทำบันทึกการใช้สารเคมีและส่งภายใน 5 วันทำการ"
                                            value={finding.correctiveAction}
                                            onChange={(e) => updateFinding(idx, 'correctiveAction', e.currentTarget.value)}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {isReject && (
                    <div className="mb-4 rounded-lg border border-red-300 bg-red-50/70 p-4 dark:border-red-900/40 dark:bg-red-950/20" role="alert">
                        <p className="text-sm font-bold text-red-700 dark:text-red-300">
                            ⛔ การปฏิเสธเป็นการสิ้นสุด (REJECTED)
                        </p>
                        <p className="mt-1 text-xs text-red-700/90 dark:text-red-300/90">
                            คำขอจะถูกปฏิเสธถาวรและไม่สามารถแก้ไขต่อได้ ผู้ขอต้องยื่นคำขอใหม่ กรุณาระบุเหตุผลให้ชัดเจนด้านล่าง
                        </p>
                    </div>
                )}

                <Textarea
                    label={isReject ? "เหตุผลการปฏิเสธ (จำเป็น)" : "บันทึกผลการตัดสิน"}
                    placeholder="ระบุรายละเอียดผลการตัดสิน"
                    value={decisionNotes}
                    onChange={(event) => onDecisionNotesChange(event.currentTarget.value)}
                    // X3-FIX-C H-11: in PASS mode there is no CAR section, so the decision-notes
                    // Textarea is the first interactive field — focus it on open. In CAR mode the
                    // first finding's nonConformity Textarea takes focus instead (see above).
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (see X2-FIX-A M-13).
                    autoFocus={!isCAR}
                />

                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold">ภาพถ่ายหลักฐาน</p>
                        <Badge color="teal">{evidenceFiles.length} ไฟล์</Badge>
                    </div>
                    <p className="mb-4 text-xs text-slate-500">อัปโหลดภาพถ่ายภาคสนาม ระบบจะบีบอัดภาพความละเอียดสูงโดยอัตโนมัติเพื่อประหยัด bandwidth ก่อนส่งขึ้น server</p>

                    <div className="relative">
                        <Button
                            leftSection={<IconUpload size={16} aria-hidden="true" />}
                            loading={isCompressing}
                        >
                            <label htmlFor="evidence-upload" className="cursor-pointer">
                                เลือกภาพ
                            </label>
                            <input
                                id="evidence-upload"
                                type="file"
                                className="sr-only"
                                title="เลือกภาพหลักฐาน"
                                aria-label="เลือกภาพหลักฐาน"
                                multiple
                                accept="image/*"
                                onChange={(event) => {
                                    if (event.target.files) {
                                        onEvidenceUpload(Array.from(event.target.files));
                                        event.target.value = '';
                                    }
                                }}
                            />
                        </Button>
                    </div>

                    {evidenceFiles.length > 0 && (
                        <div className="mt-4 flex flex-col gap-2">
                            {evidenceFiles.map((evidence) => (
                                <div className="rounded-lg bg-card p-2 shadow-sm" key={evidence.id}>
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex min-w-0 flex-1 items-center gap-3">
                                            <ThemeIcon color="blue" size="md"><IconPhoto size={14} aria-hidden="true" /></ThemeIcon>
                                            <div className="min-w-0 flex-1 overflow-hidden">
                                                <p className="truncate text-sm font-medium">{evidence.file.name}</p>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-xs text-slate-500 line-through">{formatBytes(evidence.originalSize)}</p>
                                                    <p className="text-xs font-semibold">{formatBytes(evidence.compressedSize)}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <Button size="sm" color="red" variant="subtle" onClick={() => onRemoveEvidence(evidence.id)}>ลบ</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                    <Button variant="default" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button>
                    <Button
                        color={decision === "PASS" ? "teal" : decision === "MINOR" ? "orange" : decision === "MAJOR" ? "red" : "dark"}
                        onClick={onSubmit}
                        loading={isSubmitting}
                        disabled={isReject && !decisionNotes.trim()}
                        leftSection={decision === "PASS" ? <IconCheck size={16} aria-hidden="true" /> : <IconX size={16} aria-hidden="true" />}
                    >
                        ยืนยัน {decision}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

