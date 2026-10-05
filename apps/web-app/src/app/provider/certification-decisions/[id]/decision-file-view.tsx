'use client';

/**
 * แฟ้มคำขอสำหรับผู้อนุมัติใบรับรอง — อ่านอย่างเดียว
 *
 * ผู้ตัดสินให้การรับรองต้องเห็นสิ่งที่การตัดสินวางอยู่บนมันก่อนกดอนุมัติ: เอกสารที่ยื่น ผลตรวจ
 * รายข้อ ภาพถ่ายพร้อมที่มา (ลายนิ้วมือไฟล์ พิกัด เวลา ภาพซ้ำ) การเช็คอิน GPS สรุปของผู้ตรวจ
 * และประวัติการแก้ไขข้อบกพร่อง · หน้านี้ไม่มีฟอร์มและไม่เขียนอะไร — การอนุมัติ/ส่งกลับอยู่ที่หน้ารายการ
 *
 * แสดงตามจริง: ค่าที่ไม่เคยถูกบันทึกเขียนว่า "ไม่ได้บันทึก" ไม่ใช่ช่องว่างข้างเครื่องหมายถูก
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { DocumentViewerModal, type DocumentViewerFile } from '@/components/feature/document-viewer-modal';
import { formatThaiDate } from '@/lib/format/thai-date';
import type { DecisionFile, DecisionFilePhoto } from './decision-file-types';

const VERDICT_TH: Record<string, string> = {
    ACCEPTED: 'รับแล้ว',
    REQUESTED: 'ขอเพิ่ม',
};

const RESPONSE_TH: Record<string, string> = {
    PASS: 'ผ่าน',
    FAIL: 'ไม่ผ่าน',
    NA: 'ไม่เกี่ยวข้อง',
};

const DECISION_TH: Record<string, string> = {
    PASS: 'ผ่าน',
    MINOR: 'ต้องแก้ไข (ข้อบกพร่องเล็กน้อย)',
    MAJOR: 'ต้องแก้ไข (ข้อบกพร่องสำคัญ)',
    FAIL: 'ต้องแก้ไข',
    REJECT: 'ไม่ผ่าน',
};

const FLAG_TH: Record<string, string> = {
    NEAR_DUPLICATE: 'ภาพซ้ำหรือคล้ายกันมาก',
    PLACE_BEYOND_TOLERANCE: 'ห่างจากฟาร์มเกินเกณฑ์',
    PLACE_NOT_RECORDED: 'ไม่ได้บันทึกตำแหน่งเทียบฟาร์ม',
    PLACE_FARM_LOCATION_UNKNOWN: 'ฟาร์มไม่มีพิกัดในทะเบียน จึงเทียบตำแหน่งไม่ได้',
    TIME_NOT_RECORDED: 'ไม่ได้บันทึกช่วงเวลาถ่าย',
    TIME_OUTSIDE_WINDOW: 'ถ่ายนอกช่วงเวลาตรวจ',
    APPEARANCE_NOT_RECORDED: 'ไม่ได้บันทึกลักษณะภาพ',
};

function flagLabel(flag: string): string {
    return FLAG_TH[flag] || (flag.startsWith('TIME_') ? 'เทียบช่วงเวลาถ่ายไม่ได้' : flag);
}

const fmt = (iso: string | null | undefined) => (iso ? formatThaiDate(iso) : 'ไม่ได้บันทึก');
const coord = (n: number | null | undefined) => (typeof n === 'number' ? n.toFixed(6) : 'ไม่ได้บันทึก');

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
    return (
        <section data-testid={testId} className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-bold text-foreground">{title}</h2>
            {children}
        </section>
    );
}

export function DecisionFileView({ file }: { file: DecisionFile }) {
    const [viewing, setViewing] = useState<DocumentViewerFile | null>(null);
    const { application, documents, onsite, inspectorSummary, carHistory } = file;
    const gps = onsite.gps;
    const answered = onsite.checklist.filter((c) => c.response !== null).length;

    const photoTone = (p: DecisionFilePhoto) => (p.flags.length > 0 ? 'warning' : 'success');

    return (
        <div className="space-y-4">
            <Section title="คำขอ" testId="decision-file-application">
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">เลขที่คำขอ</dt><dd className="font-semibold">{application.applicationNumber}</dd></div>
                    <div><dt className="text-muted-foreground">ผู้ยื่นคำขอ</dt><dd className="font-semibold">{application.applicantName}</dd></div>
                    <div><dt className="text-muted-foreground">ยื่นเมื่อ</dt><dd>{fmt(application.submittedAt)}</dd></div>
                    <div><dt className="text-muted-foreground">ที่ตั้งแปลง</dt><dd>{application.farmAddress || 'ไม่ได้บันทึก'}</dd></div>
                </dl>
            </Section>

            {!onsite.evidenceGate.sufficient && (
                <div role="alert" data-testid="decision-file-evidence-warning" className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
                    <p className="font-bold text-foreground">หลักฐานการตรวจแปลงยังไม่พอสำหรับออกใบรับรอง</p>
                    <p className="mt-1 text-foreground">{onsite.evidenceGate.messageTh || 'ระบบตรวจหลักฐานไม่ผ่าน'}</p>
                    <p className="mt-1 text-muted-foreground">หากกดอนุมัติ ระบบจะปฏิเสธการออกใบรับรอง ควรส่งกลับให้ผู้ตรวจ</p>
                </div>
            )}

            <Section title="เอกสารที่ยื่น" testId="decision-file-documents">
                <ul className="divide-y divide-border/60">
                    {documents.map((d) => (
                        <li key={d.slotId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                            <div>
                                <span className="font-medium">{d.labelTH}</span>
                                {d.required && <span className="ml-2 text-xs text-muted-foreground">จำเป็น</span>}
                                <div className="text-xs text-muted-foreground">
                                    {d.satisfied ? (d.fileName || 'แนบแล้ว') : 'ยังไม่ได้แนบ'}
                                    {d.reviewReason ? ` · ${d.reviewReason}` : ''}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge tone={d.verdict === 'ACCEPTED' ? 'success' : 'warning'}>
                                    {d.verdict ? (VERDICT_TH[d.verdict] || d.verdict) : 'ยังไม่ได้ตรวจ'}
                                </Badge>
                                {d.fileUrl && (
                                    <Button size="sm" variant="outline" onClick={() => setViewing({ url: d.fileUrl as string, name: d.fileName || d.labelTH })}>
                                        ดูเอกสาร
                                    </Button>
                                )}
                            </div>
                        </li>
                    ))}
                    {documents.length === 0 && <li className="py-2 text-sm text-muted-foreground">ไม่มีรายการเอกสาร</li>}
                </ul>
            </Section>

            <Section title={`ผลตรวจแปลงรายข้อ (ตอบแล้ว ${answered} จาก ${onsite.checklist.length} ข้อ)`} testId="decision-file-checklist">
                <ul className="divide-y divide-border/60">
                    {onsite.checklist.map((c) => (
                        <li key={c.itemCode} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                            <div className="min-w-0">
                                <span className="tabular-nums text-muted-foreground">{c.itemCode}</span>{' '}
                                <span className="font-medium">{c.prompt}</span>
                                {c.isCritical && <span className="ml-2 text-xs text-muted-foreground">ข้อสำคัญ</span>}
                                {c.notes && <div className="text-xs text-foreground">บันทึกผู้ตรวจ: {c.notes}</div>}
                            </div>
                            <Badge tone={c.response === 'FAIL' ? 'danger' : c.response === null ? 'warning' : 'success'}>
                                {c.response === null ? 'ยังไม่ได้ตอบ' : (RESPONSE_TH[c.response] || c.response)}
                            </Badge>
                        </li>
                    ))}
                </ul>
            </Section>

            <Section title={`ภาพถ่ายหลักฐาน (${onsite.photos.length} ภาพ)`} testId="decision-file-photos">
                {onsite.needsAttention > 0 && (
                    <p className="mb-2 text-sm text-foreground">มี {onsite.needsAttention} ภาพที่มีข้อสังเกต ดูรายละเอียดตามภาพด้านล่าง</p>
                )}
                <ul className="space-y-3">
                    {onsite.photos.map((p) => (
                        <li key={p.photoId} className="rounded-lg border border-border p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium">{p.caption || 'ภาพหลักฐาน'}</span>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone={photoTone(p)}>{p.flags.length > 0 ? `ข้อสังเกต ${p.flags.length} ข้อ` : 'ไม่พบข้อสังเกต'}</Badge>
                                    {p.fileUrl && (
                                        <Button size="sm" variant="outline" onClick={() => setViewing({ url: p.fileUrl as string, name: p.fileName || 'ภาพหลักฐาน' })}>
                                            ดูภาพ
                                        </Button>
                                    )}
                                </div>
                            </div>
                            <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                                <div>ลายนิ้วมือไฟล์ (SHA-256): <span className="font-mono">{p.fileHash.slice(0, 12)}</span></div>
                                <div>พิกัด: {coord(p.gps.latitude)}, {coord(p.gps.longitude)}</div>
                                <div>ถ่ายเมื่อ: {fmt(p.capturedAt)}</div>
                                <div>
                                    ห่างจากฟาร์ม: {p.place.distanceMeters === null ? 'ไม่ได้บันทึก' : `${Math.round(p.place.distanceMeters)} เมตร`}
                                    {' '}(เกณฑ์ {p.place.toleranceMeters} เมตร)
                                </div>
                            </dl>
                            {p.flags.length > 0 && (
                                <ul className="mt-2 list-disc pl-5 text-xs text-foreground">
                                    {p.flags.map((f) => <li key={f}>{flagLabel(f)}</li>)}
                                </ul>
                            )}
                        </li>
                    ))}
                    {onsite.photos.length === 0 && <li className="text-sm text-muted-foreground">ไม่มีภาพถ่ายหลักฐาน</li>}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">เวลาถ่ายเป็นค่าที่เครื่องผู้ตรวจส่งมา ระบบยังพิสูจน์ไม่ได้ว่าเป็นเวลาที่กดชัตเตอร์จริง</p>
            </Section>

            <Section title="การเช็คอิน GPS ของผู้ตรวจ" testId="decision-file-gps">
                {gps.checkIn ? (
                    <div className="space-y-1 text-sm">
                        <p>เช็คอินเมื่อ {fmt(gps.checkIn.at)} ที่พิกัด {coord(gps.checkIn.latitude)}, {coord(gps.checkIn.longitude)}</p>
                        {gps.unknownFarmLocation ? (
                            <p className="text-foreground">ฟาร์มไม่มีพิกัดในทะเบียน จึงเทียบระยะไม่ได้</p>
                        ) : (
                            <p>
                                ห่างจากฟาร์ม {Math.round(gps.distanceMeters ?? 0)} เมตร (เกณฑ์ {gps.toleranceMeters} เมตร) ·{' '}
                                <Badge tone={gps.withinTolerance ? 'success' : 'danger'}>{gps.withinTolerance ? 'อยู่ในเกณฑ์' : 'เกินเกณฑ์'}</Badge>
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-foreground">ไม่พบบันทึกการเช็คอิน GPS ของผู้ตรวจ</p>
                )}
            </Section>

            <Section title="สรุปของผู้ตรวจ" testId="decision-file-summary">
                <div className="space-y-1 text-sm">
                    <p>ผู้ตรวจ: {inspectorSummary.inspectorName || 'ไม่ได้บันทึก'}</p>
                    <p>ผลการตรวจ: {inspectorSummary.decision ? (DECISION_TH[inspectorSummary.decision] || inspectorSummary.decision) : 'ไม่ได้บันทึก'} · {fmt(inspectorSummary.decidedAt)}</p>
                    <p className="whitespace-pre-wrap">{inspectorSummary.notes || 'ผู้ตรวจไม่ได้เขียนสรุป'}</p>
                </div>
            </Section>

            <Section title="ประวัติการแก้ไขข้อบกพร่อง" testId="decision-file-car-history">
                {carHistory.decisions.length === 0 && carHistory.applicantDocuments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">ไม่เคยมีการขอให้แก้ไขข้อบกพร่อง</p>
                ) : (
                    <div className="space-y-3 text-sm">
                        {carHistory.decisions.map((d, i) => (
                            <div key={`${d.decidedAt}-${i}`} className="rounded-lg border border-border p-3">
                                <p className="font-medium">{DECISION_TH[d.decision] || d.decision} · {fmt(d.decidedAt)}</p>
                                {d.notes && <p className="whitespace-pre-wrap">{d.notes}</p>}
                                {d.findings.length > 0 && (
                                    <ul className="mt-1 list-disc pl-5">
                                        {d.findings.map((f, j) => (
                                            <li key={j}>{f.nonConformity}{f.correctiveAction ? ` — แนวทางแก้ไข: ${f.correctiveAction}` : ''}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                        {carHistory.rounds.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {carHistory.rounds.map((r) => `รอบที่ ${r.roundNo} กำหนดส่ง ${fmt(r.dueAt)}`).join(' · ')}
                            </p>
                        )}
                        {carHistory.applicantDocuments.length > 0 && (
                            <div>
                                <p className="font-medium">หลักฐานที่ผู้ยื่นส่งแก้ไข</p>
                                <ul className="list-disc pl-5">
                                    {carHistory.applicantDocuments.map((d, i) => (
                                        <li key={`${d.path}-${i}`}>
                                            {d.path ? (
                                                <button type="button" className="text-info underline" onClick={() => setViewing({ url: d.path as string, name: d.name || 'หลักฐานการแก้ไข' })}>
                                                    {d.name || 'ไฟล์แนบ'}
                                                </button>
                                            ) : (d.name || 'ไฟล์แนบ')}
                                            {' '}· {fmt(d.uploadedAt)}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </Section>

            <DocumentViewerModal file={viewing} onClose={() => setViewing(null)} />
        </div>
    );
}
