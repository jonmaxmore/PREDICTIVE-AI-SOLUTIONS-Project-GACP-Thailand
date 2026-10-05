'use client';

import React from 'react';
import { apiClient } from '@/lib/api/api-client';
import { openDocumentPreview } from '@/lib/services/preview-document';
import { checkUploadInBrowser } from '@/lib/services/client-upload-check';
import { MAX_UPLOAD_BYTES } from '@gacp/validation/upload-rules';
import { cn } from '@/lib/utils';
import { Icons } from '@/components/ui/icons';

interface InlineDocumentUploadProps {
    id: string;
    label: string;
    labelEn?: string | undefined;
    required?: boolean | undefined;
    accept?: string | undefined;
    maxSizeMB?: number | undefined;
    hint?: string | undefined;
    value?: string | undefined;
    onChange?: (file: File | null, url: string | null) => void;
    error?: string | undefined;
    disabled?: boolean | undefined;
    stepKey?: string | undefined;
    draftId?: string | undefined;
    applicationId?: string | undefined;
}

export function InlineDocumentUpload({
    id,
    label,
    labelEn,
    required = false,
    accept = '.pdf,image/*',
    // F-G4-08 — the platform ceiling, so a slot rendered by this component and a
    // slot rendered by step 8 do not advertise two different limits.
    maxSizeMB = MAX_UPLOAD_BYTES / (1024 * 1024),
    hint,
    value,
    onChange,
    error,
    disabled = false,
    stepKey = 'farm_info',
    draftId,
    applicationId,
}: InlineDocumentUploadProps) {
    const [file, setFile] = React.useState<File | null>(null);
    const [uploading, setUploading] = React.useState(false);
    const [previewError, setPreviewError] = React.useState<string | null>(null);
    // F-G4-08 — this component used to drop a refused file in silence: an
    // oversized file called onChange(null, null) and nothing on screen changed,
    // so the farmer saw a slot that simply would not fill and was told no reason.
    const [fileError, setFileError] = React.useState<string | null>(null);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const uploaded = Boolean(value);
    const hasLocalSelection = Boolean(file);
    const shownError = fileError || error;

    const fileStatusLabel = hasLocalSelection ? file?.name : uploaded ? 'มีไฟล์แนบแล้ว' : 'ยังไม่ได้อัปโหลดไฟล์';
    const fileMetaLabel = hint || `รองรับ ${accept} (ขนาดสูงสุด ${maxSizeMB} MB)`;

    const handleFileChange = async (payload: File | null) => {
        setFile(payload);
        setFileError(null);

        if (!payload) {
            onChange?.(null, null);
            return;
        }

        // F-G4-08 — the same three layers the server applies, from the same
        // module, so this slot cannot hold a different standard from step 8's.
        const verdict = await checkUploadInBrowser(payload, { slotId: id });
        if (!verdict.ok && verdict.message) {
            setFileError(verdict.message);
            onChange?.(null, null);
            return;
        }

        if (payload.size > maxSizeMB * 1024 * 1024) {
            setFileError(`ไฟล์ "${payload.name}" ใหญ่เกิน ${maxSizeMB} MB คุณสามารถบีบอัดไฟล์ หรือสแกนใหม่ที่ความละเอียดต่ำลง แล้วอัปโหลดอีกครั้ง`);
            onChange?.(null, null);
            return;
        }

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', payload);
            formData.append('slotId', id);
            formData.append('stepKey', stepKey);
            if (draftId) {
                formData.append('draftId', draftId);
            }
            if (applicationId) {
                formData.append('applicationId', applicationId);
            }

            const response = await apiClient.post<{ fileUrl?: string }>('/applications/draft-documents', formData);
            if (response.success && response.data?.fileUrl) {
                onChange?.(payload, response.data.fileUrl);
            } else {
                setFileError(response.error || 'อัปโหลดไม่สำเร็จ คุณสามารถลองใหม่อีกครั้ง');
                onChange?.(null, null);
            }
        } catch {
            setFileError('อัปโหลดไม่สำเร็จ คุณสามารถตรวจสอบการเชื่อมต่อ แล้วลองใหม่อีกครั้ง');
            onChange?.(null, null);
        } finally {
            setUploading(false);
        }
    };

    const handleRemove = () => {
        if (uploading) return;
        if (inputRef.current) {
            inputRef.current.value = '';
        }
        setFile(null);
        setFileError(null);
        onChange?.(null, null);
    };

    return (
        <article
            className={cn(
                'form-block rounded-lg border border-border bg-card px-4 py-3 shadow-none',
                uploaded && 'border-leaf-300 bg-leaf-soft/40',
                shownError && 'border-rose-300 bg-rose-50/40',
            )}
        >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{label}</p>
                        {uploaded ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-leaf-700 text-white">
                                <Icons.Check size={12} />
                            </span>
                        ) : null}
                    </div>
                    {labelEn ? <p className="text-xs text-muted-foreground">{labelEn}</p> : null}
                    <p className="text-xs text-muted-foreground">{fileMetaLabel}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span
                        className={cn(
                            'status-chip rounded-lg',
                            required ? 'bg-rose-100 text-rose-700 ring-rose-200' : 'bg-slate-100 text-foreground ring-slate-300',
                        )}
                    >
                        {required ? 'บังคับ' : 'เพิ่มเติม'}
                    </span>

                    {uploading ? (
                        <span className="status-chip rounded-lg bg-sky-100 text-sky-700 ring-sky-200">กำลังอัปโหลด...</span>
                    ) : uploaded ? (
                        <span className="status-chip rounded-lg bg-leaf-soft text-leaf-onSoft ring-leaf-600">อัปโหลดแล้ว</span>
                    ) : null}

                    {shownError ? <span className="status-chip rounded-lg bg-rose-100 text-rose-700 ring-rose-200">{shownError}</span> : null}
                </div>
            </div>

            <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                    <p className={cn('truncate text-sm font-medium', shownError ? 'text-rose-700' : 'text-foreground')}>
                        {fileStatusLabel}
                    </p>
                    {!shownError ? <p className="text-xs text-muted-foreground">หากเลือกไฟล์ใหม่ ระบบจะใช้ไฟล์ล่าสุดแทน</p> : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <label
                        className={cn(
                            'inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-leaf-700 bg-leaf-700 px-3 text-xs font-semibold text-white transition',
                            disabled || uploading ? 'cursor-not-allowed opacity-70' : 'hover:bg-leaf-800',
                        )}
                    >
                        <Icons.Upload size={14} />
                        {uploaded ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}
                        <input
                            ref={inputRef}
                            type="file"
                            className="hidden"
                            accept={accept}
                            disabled={disabled || uploading}
                            onChange={(event) => {
                                const nextFile = event.target.files && event.target.files.length > 0 ? event.target.files[0] ?? null : null;
                                void handleFileChange(nextFile);
                            }}
                        />
                    </label>

                    {value ? (
                        <button
                            type="button"
                            className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground transition hover:bg-slate-50"
                            onClick={() => {
                                // BUG A: /uploads/* ships Content-Disposition:attachment.
                                // Fetch as a blob and open the object URL inline so the
                                // preview renders (security headers preserved).
                                setPreviewError(null);
                                void openDocumentPreview(value).catch(() =>
                                    setPreviewError('ไม่สามารถเปิดดูไฟล์ได้ กรุณาลองใหม่'),
                                );
                            }}
                        >
                            เปิดดูไฟล์
                        </button>
                    ) : null}

                    {previewError ? (
                        <span className="status-chip rounded-lg bg-rose-100 text-rose-700 ring-rose-200">{previewError}</span>
                    ) : null}

                    {(file || value) ? (
                        <button
                            type="button"
                            className="inline-flex h-9 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                            onClick={handleRemove}
                        >
                            ลบออก
                        </button>
                    ) : null}
                </div>
            </div>
        </article>
    );
}

export default InlineDocumentUpload;
