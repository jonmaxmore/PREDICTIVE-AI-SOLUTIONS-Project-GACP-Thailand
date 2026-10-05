'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { SimpleGrid } from '@/components/ui/layout-utils';
import {
    IconExternalLink,
    IconFileText,
    IconPhoto,
    IconZoomIn,
    IconZoomOut,
    IconRotateClockwise,
    IconX,
    IconMessageCircle,
} from '@tabler/icons-react';
import { getApplicantName, toDateText, type ApplicationData } from './provider-audit-job-sheet-config';
import { useSignedFileUrl } from '@/lib/hooks/use-signed-file-url';
import { safeSrc, safeUrl } from '@/lib/safe-url';

interface AuditApplicationTabPanelProps {
    application: ApplicationData;
    formData: Record<string, unknown>;
    attachments: Array<{ key: string; label: string; url: string | null }>;
}

export function AuditApplicationTabPanel({ application, formData, attachments }: AuditApplicationTabPanelProps) {
    const [selectedDoc, setSelectedDoc] = useState<{ key: string; label: string; url: string } | null>(null);

    // W1-2 — application documents are served from the gated `/uploads` mount,
    // and an <iframe>/<img>/<a download> cannot attach an Authorization header.
    // Mint a short-lived signed URL for the document the reviewer opened, bound
    // to that one object.
    const {
        url: docViewUrl,
        loading: docUrlLoading,
        error: docUrlError,
    } = useSignedFileUrl(selectedDoc?.url);
    const [zoom, setZoom] = useState(100);
    const [rotation, setRotation] = useState(0);
    const [stepComments, setStepComments] = useState<Record<string, string>>({});

    const isPdf = selectedDoc?.url?.toLowerCase().endsWith('.pdf');
    const isImage = selectedDoc?.url && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(selectedDoc.url);

    const handleCommentChange = (key: string, value: string) => {
        setStepComments(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Applicant + Summary cards */}
            <SimpleGrid cols={2} spacing="md">
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <p className="mb-3 text-sm font-bold">ข้อมูลผู้ยื่นคำขอ</p>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">ชื่อ-สกุล</p><p className="text-sm font-medium">{getApplicantName(application)}</p></div>
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">อีเมล</p><p className="text-sm">{(application.health || application.applicant)?.email || "-"}</p></div>
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">โทรศัพท์</p><p className="text-sm">{(application.health || application.applicant)?.phone || "-"}</p></div>
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">วันที่สมัคร</p><p className="text-sm">{toDateText(application.createdAt)}</p></div>
                    </div>
                </div>
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <p className="mb-3 text-sm font-bold">สรุปคำขอ</p>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">พืช</p><p className="text-sm font-medium">{String(formData.plantName || formData.plantId || "-")}</p></div>
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">ประเภทพื้นที่</p><p className="text-sm">{String(formData.areaType || "-")}</p></div>
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">จังหวัด</p><p className="text-sm">{String(formData.province || formData.locationProvince || "-")}</p></div>
                        <div className="flex items-center justify-between"><p className="text-xs text-slate-500">อัปเดตล่าสุด</p><p className="text-sm">{toDateText(application.updatedAt)}</p></div>
                    </div>
                </div>
            </SimpleGrid>

            {/* Split-view: Left = Attachments list with comments, Right = Document viewer */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" style={{ minHeight: selectedDoc ? '600px' : 'auto' }}>
                {/* LEFT: Document list with per-step comments */}
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <p className="mb-3 text-sm font-bold"><span aria-hidden="true">📋</span> เอกสารประกอบ (คลิกเพื่อดู)</p>
                    <div className="flex flex-col gap-2">
                        {attachments.map((att) => (
                            <div
                                key={att.key}
                                className={`rounded-lg border p-3 transition-all ${
                                    selectedDoc?.key === att.key
                                        ? 'border-primary bg-primary/5 dark:bg-primary/15'
                                        : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                                }`}
                            >
                                <div className="mb-1 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {att.url ? (
                                            <IconFileText size={16} className="text-leaf-700" aria-hidden="true" />
                                        ) : (
                                            <IconPhoto size={16} className="text-slate-400" aria-hidden="true" />
                                        )}
                                        <p className="text-sm font-medium">{att.label}</p>
                                    </div>
                                    {/* X2-FIX-C / M-12 (P-NEW-2) — bump
                                        doc-viewer action buttons up to a
                                        44×44 px touch target (WCAG 2.5.5).
                                        Pre-X2 the Button primitive's xs size
                                        rendered 28-px h-7; we now use sm
                                        + min-h-[44px] min-w-[44px] which
                                        matches the dashboard queue action
                                        button pattern at
                                        provider/dashboard/page.tsx:302. */}
                                    <div className="flex items-center gap-1">
                                        {att.url ? (
                                            <>
                                                <Button
                                                    size="sm"
                                                    variant={selectedDoc?.key === att.key ? 'filled' : 'light'}
                                                    color="teal"
                                                    className="min-h-[44px] min-w-[44px]"
                                                    data-testid={`doc-viewer-preview-${att.key}`}
                                                    onClick={() => {
                                                        setSelectedDoc({ key: att.key, label: att.label, url: att.url! });
                                                        setZoom(100);
                                                        setRotation(0);
                                                    }}
                                                >
                                                    ดูเอกสาร
                                                </Button>
                                                {/* ที่อยู่ที่เปิดแล้วรันโค้ดได้ ไม่ควรมีปุ่มให้กด — ซ่อนทั้งปุ่ม
                                                    ดีกว่าปล่อยลิงก์ตายที่ดูเหมือนใช้ได้ */}
                                                {safeUrl(att.url) ? (
                                                <Button
                                                    size="sm"
                                                    variant="subtle"
                                                    component="a"
                                                    href={safeUrl(att.url) as string}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="min-h-[44px] min-w-[44px]"
                                                    data-testid={`doc-viewer-open-${att.key}`}
                                                    rightSection={<IconExternalLink size={10} aria-hidden="true" />}
                                                >
                                                    เปิดใหม่
                                                </Button>
                                                ) : null}
                                            </>
                                        ) : (
                                            <Badge color="gray" size="sm">ไม่มีเอกสาร</Badge>
                                        )}
                                    </div>
                                </div>
                                {/* Per-step comment input
                                 *
                                 * X3-FIX-D / H-9 (2026-05-18) — VISUAL-BUG FIX.
                                 * The per-document comment textarea was previously
                                 * editable but stored input ONLY in local React state
                                 * (`stepComments` at line 29), so any text typed here
                                 * would be silently lost on tab change or page close.
                                 * The visual affordance implied persistence; the
                                 * actual behaviour did not. Auditors were at risk of
                                 * losing CAR-finding notes they thought were saved.
                                 *
                                 * Until backend persistence lands (X3.5 — needs schema
                                 * change for `formData.auditorComments[doc.key]` plus a
                                 * new POST endpoint; deferred per X3 meeting L-11), the
                                 * Textarea is rendered DISABLED with a Thai tooltip
                                 * explaining the pending state. This prevents the
                                 * data-loss expectation and surfaces the unimplemented
                                 * feature honestly.
                                 *
                                 * `value` is still wired to local state so the
                                 * controlled-component pattern is preserved if a future
                                 * agent re-enables the field — they only need to drop
                                 * the `disabled` flag and add the persistence call.
                                 */}
                                <div className="mt-2">
                                    <div className="mb-1 flex items-center gap-1">
                                        <IconMessageCircle size={12} className="text-slate-400" aria-hidden="true" />
                                        <p className="text-xs text-slate-500">หมายเหตุ Auditor</p>
                                    </div>
                                    <textarea
                                        className="w-full cursor-not-allowed resize-none rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                                        rows={2}
                                        placeholder="บันทึกข้อสังเกตสำหรับเอกสารนี้..."
                                        value={stepComments[att.key] || ''}
                                        onChange={(e) => handleCommentChange(att.key, e.target.value)}
                                        disabled
                                        aria-disabled="true"
                                        title="บันทึกหมายเหตุต่อเอกสารยังไม่พร้อมใช้งาน (X3.5)"
                                        data-testid={`doc-comment-textarea-${att.key}`}
                                    />
                                    <p
                                        className="mt-1 text-[11px] italic text-slate-400"
                                        data-testid={`doc-comment-helper-${att.key}`}
                                    >
                                        บันทึกหมายเหตุต่อเอกสารยังไม่พร้อมใช้งาน (X3.5)
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* RIGHT: Document viewer (PDF / Image) */}
                <div className="flex flex-col rounded-lg bg-card p-4 shadow-sm">
                    {selectedDoc ? (
                        <>
                            {/* X2-FIX-C / M-12 (P-NEW-2) — toolbar zoom /
                                rotate / close icon buttons bumped from xs
                                (28×28) to sm + min-h-[44px] min-w-[44px]
                                to satisfy WCAG 2.5.5 touch-target on
                                iPad-class tablets where DOC_REVIEWER /
                                AUDITOR commonly review docs. data-testid
                                hooks pin the regression guard at
                                __tests__/audit-doc-viewer-buttons-tap-target.test.tsx. */}
                            <div className="mb-3 flex items-center justify-between">
                                <p className="truncate text-sm font-bold">{selectedDoc.label}</p>
                                <div className="flex items-center gap-1">
                                    <Button
                                        size="sm"
                                        variant="subtle"
                                        className="min-h-[44px] min-w-[44px]"
                                        data-testid="doc-viewer-zoom-out"
                                        onClick={() => setZoom(z => Math.max(50, z - 25))}
                                        aria-label="ย่อ"
                                    >
                                        <IconZoomOut size={14} aria-hidden="true" />
                                    </Button>
                                    <Badge color="gray" size="sm">{zoom}%</Badge>
                                    <Button
                                        size="sm"
                                        variant="subtle"
                                        className="min-h-[44px] min-w-[44px]"
                                        data-testid="doc-viewer-zoom-in"
                                        onClick={() => setZoom(z => Math.min(200, z + 25))}
                                        aria-label="ขยาย"
                                    >
                                        <IconZoomIn size={14} aria-hidden="true" />
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="subtle"
                                        className="min-h-[44px] min-w-[44px]"
                                        data-testid="doc-viewer-rotate"
                                        onClick={() => setRotation(r => (r + 90) % 360)}
                                        aria-label="หมุน"
                                    >
                                        <IconRotateClockwise size={14} aria-hidden="true" />
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="subtle"
                                        color="red"
                                        className="min-h-[44px] min-w-[44px]"
                                        data-testid="doc-viewer-close"
                                        onClick={() => setSelectedDoc(null)}
                                        aria-label="ปิดเอกสาร"
                                    >
                                        <IconX size={14} aria-hidden="true" />
                                    </Button>
                                </div>
                            </div>
                            <div className="min-h-[500px] flex-1 overflow-auto rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
                                {/* W1-2 — the signed URL is minted asynchronously, so the
                                    viewer has three honest states instead of a blank frame. */}
                                {docUrlError ? (
                                    <div className="flex h-full items-center justify-center p-4">
                                        <p role="alert" data-testid="audit-doc-error" className="text-sm text-red-600 dark:text-red-400">
                                            {docUrlError}
                                        </p>
                                    </div>
                                ) : docUrlLoading || !docViewUrl ? (
                                    <div className="flex h-full items-center justify-center p-4">
                                        <p className="text-sm text-slate-500">กำลังเปิดเอกสาร</p>
                                    </div>
                                ) : isPdf ? (
                                    <iframe
                                        src={safeSrc(docViewUrl)}
                                        className="h-full min-h-[500px] w-full"
                                        title={selectedDoc.label}
                                        style={{ transform: `scale(${zoom / 100}) rotate(${rotation}deg)`, transformOrigin: 'top left' }}
                                    />
                                ) : isImage ? (
                                    <div className="flex h-full items-center justify-center p-4">
                                        {/*
                                         * Document previewer shows arbitrary user-uploaded
                                         * URLs from many storage backends (S3, Azure Blob,
                                         * legacy local paths). next/image requires every
                                         * remote host to be enumerated in
                                         * next.config.ts > images.remotePatterns; here we
                                         * deliberately keep the raw <img> to stay backend-
                                         * agnostic. LCP impact is bounded (preview pane
                                         * only opens on click; not above-the-fold).
                                         */}
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={safeSrc(docViewUrl)}
                                            alt={selectedDoc.label}
                                            className="max-w-full object-contain"
                                            style={{
                                                transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                                                transition: 'transform 0.2s ease',
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <div className="flex h-full items-center justify-center">
                                        <div className="text-center">
                                            <IconFileText size={48} className="mx-auto mb-2 text-slate-400" aria-hidden="true" />
                                            <p className="text-sm text-slate-500">ไม่สามารถแสดงตัวอย่างได้</p>
                                            {safeUrl(docViewUrl) ? (
                                                <Button
                                                    component="a"
                                                    href={safeUrl(docViewUrl) as string}
                                                    target="_blank"
                                                    size="sm"
                                                    className="mt-2"
                                                >
                                                    ดาวน์โหลดเอกสาร
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex min-h-[300px] flex-1 items-center justify-center">
                            <div className="text-center">
                                <IconFileText size={48} className="mx-auto mb-2 text-slate-300" aria-hidden="true" />
                                <p className="text-sm text-slate-500">เลือกเอกสารจากรายการด้านซ้าย</p>
                                <p className="text-xs text-slate-400">คลิก &quot;ดูเอกสาร&quot; เพื่อแสดงในหน้าจอนี้</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
