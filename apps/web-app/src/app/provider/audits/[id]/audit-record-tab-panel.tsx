'use client';

import { Badge } from '@/components/ui/primitives/badge';
import { SimpleGrid } from '@/components/ui/layout-utils';
import {
    IconAlertTriangle,
    IconCheck,
    IconClock,
    IconMapPin,
    IconVideo,
    IconExternalLink,
} from '@tabler/icons-react';
import { toDateText, type AuditorQueueItem } from './provider-audit-job-sheet-config';

interface AuditRecordTabPanelProps {
    queueItem: AuditorQueueItem | null;
    latestDecision?: Record<string, unknown>;
    allDecisions?: Array<Record<string, unknown>>;
    auditFollowup?: Record<string, unknown> | null;
}

function DecisionBadge({ decision }: { decision: string }) {
    const colors: Record<string, string> = {
        PASS: 'teal',
        MINOR: 'orange',
        MAJOR: 'red',
    };
    return <Badge color={colors[decision] || 'gray'}>{decision}</Badge>;
}

export function AuditRecordTabPanel({ queueItem, latestDecision, allDecisions, auditFollowup }: AuditRecordTabPanelProps) {
    const decisions = allDecisions || (latestDecision ? [latestDecision] : []);
    const findings = latestDecision?.findings as Array<Record<string, string>> | undefined;

    return (
        <div className="flex flex-col gap-4">
            {/* Row 1: Schedule + Latest Decision */}
            <SimpleGrid cols={2} spacing="md">
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                        <IconClock size={16} className="text-blue-600" aria-hidden="true" />
                        <p className="text-sm font-bold">รายละเอียดนัดหมาย</p>
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-slate-500">รูปแบบ</p>
                            <Badge color={queueItem?.inspectionMode === 'ONLINE_MEET' ? 'blue' : 'grape'} size="sm">
                                {queueItem?.inspectionMode === 'ONLINE_MEET' ? (
                                    <span className="flex items-center gap-1"><IconVideo size={10} aria-hidden="true" /> ออนไลน์</span>
                                ) : (
                                    <span className="flex items-center gap-1"><IconMapPin size={10} aria-hidden="true" /> หน้างาน</span>
                                )}
                            </Badge>
                        </div>
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">วันนัด</p><p className="text-sm">{toDateText(queueItem?.scheduledDate || null)}</p></div>
                        {queueItem?.meetingLink && (
                            <div className="flex items-center justify-between">
                                <p className="text-xs text-slate-500">ลิงก์ประชุม</p>
                                <a href={queueItem.meetingLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-blue-600">
                                    เข้าร่วม <IconExternalLink size={10} aria-hidden="true" />
                                </a>
                            </div>
                        )}
                        {queueItem?.location && (
                            <div className="flex items-center justify-between"><p className="text-xs text-slate-500">สถานที่</p><p className="text-sm">{queueItem.location}</p></div>
                        )}
                    </div>
                </div>

                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                        <IconCheck size={16} className="text-leaf-700" aria-hidden="true" />
                        <p className="text-sm font-bold">ผลการตรวจล่าสุด</p>
                    </div>
                    {latestDecision ? (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between">
                                <p className="text-xs text-slate-500">ผลตัดสิน</p>
                                <DecisionBadge decision={String(latestDecision.decision || '-')} />
                            </div>
                            <div className="flex items-center justify-between"><p className="text-xs text-slate-500">รหัสเหตุผล</p><p className="text-sm">{String(latestDecision.reasonCode || '-')}</p></div>
                            <div className="flex items-center justify-between"><p className="text-xs text-slate-500">บันทึกเมื่อ</p><p className="text-sm">{toDateText(String(latestDecision.decidedAt || ''))}</p></div>
                            <div className="flex items-center justify-between"><p className="text-xs text-slate-500">ตรวจโดย</p><p className="text-sm">{String(latestDecision.decidedBy || '-')}</p></div>
                            {Boolean(latestDecision.notes) && (
                                <>
                                    <hr className="my-1 h-px border-0 bg-slate-200/60" />
                                    <p className="text-xs text-slate-500">หมายเหตุ</p>
                                    <p className="rounded bg-slate-50 p-2 text-sm dark:bg-slate-900">{String(latestDecision.notes)}</p>
                                </>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500">ยังไม่มีการบันทึกผลตรวจ</p>
                    )}
                </div>
            </SimpleGrid>

            {/* Row 2: CAR Findings (Before/After comparison)
                X3-FIX-B M-4: CAR findings are corrective requests = destructive intent.
                Switched amber-on-white → rose/red tones per design semantics (M-4). */}
            {findings && findings.length > 0 && (
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                        <IconAlertTriangle size={16} className="text-rose-600" aria-hidden="true" />
                        <p className="text-sm font-bold">ข้อบกพร่อง (CAR Findings)</p>
                        <Badge color="red" size="sm">{findings.length} รายการ</Badge>
                    </div>
                    <div className="flex flex-col gap-3">
                        {findings.map((finding, idx) => (
                            <div key={idx} className="overflow-hidden rounded-lg border border-rose-200 dark:border-rose-800">
                                <div className="flex items-center justify-between bg-rose-50 px-3 py-2 dark:bg-rose-950/30">
                                    <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">ข้อที่ {finding.index || idx + 1}</p>
                                    {finding.category && <Badge color="red" size="xs">{finding.category}</Badge>}
                                </div>
                                <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
                                    {/* Before: Non-conformity */}
                                    <div className="border-r border-rose-100 p-3 dark:border-rose-900">
                                        <p className="mb-1 text-xs font-semibold text-rose-700"><span aria-hidden="true">🔴</span> ข้อบกพร่อง (Before)</p>
                                        <p className="text-sm">{finding.nonConformity || '-'}</p>
                                    </div>
                                    {/* After: Corrective Action */}
                                    <div className="p-3">
                                        <p className="mb-1 text-xs font-semibold text-leaf-700"><span aria-hidden="true">🟢</span> แนวทางแก้ไข (After)</p>
                                        <p className="text-sm">{finding.correctiveAction || '-'}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Row 3: Followup Status */}
            {auditFollowup && (
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                        <IconClock size={16} className="text-blue-600" aria-hidden="true" />
                        <p className="text-sm font-bold">สถานะติดตามแก้ไข (Follow-up)</p>
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-slate-500">ประเภท</p>
                            <Badge color={String(auditFollowup.type) === 'MAJOR' ? 'red' : 'orange'} size="sm">
                                {String(auditFollowup.type || '-')}
                            </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-slate-500">สถานะ</p>
                            <Badge color={String(auditFollowup.status) === 'COMPLETED' ? 'teal' : 'blue'} size="sm">
                                {String(auditFollowup.status || '-')}
                            </Badge>
                        </div>
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">ร้องขอเมื่อ</p><p className="text-sm">{toDateText(String(auditFollowup.requestedAt || ''))}</p></div>
                    </div>
                </div>
            )}

            {/* Row 4: All Decision History (timeline of all past decisions) */}
            {decisions.length > 1 && (
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <p className="mb-3 text-sm font-bold"><span aria-hidden="true">📜</span> ประวัติการตัดสินทั้งหมด ({decisions.length} ครั้ง)</p>
                    <div className="flex flex-col gap-2">
                        {decisions.map((d, idx) => (
                            <div key={idx} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold dark:bg-slate-800">
                                    #{idx + 1}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <DecisionBadge decision={String(d.decision || '-')} />
                                        <p className="text-xs text-slate-500">{toDateText(String(d.decidedAt || ''))}</p>
                                    </div>
                                    {Boolean(d.notes) && <p className="mt-1 truncate text-xs text-slate-600">{String(d.notes)}</p>}
                                </div>
                                <p className="flex-shrink-0 text-xs text-slate-400">{String(d.decidedBy || '-')}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
