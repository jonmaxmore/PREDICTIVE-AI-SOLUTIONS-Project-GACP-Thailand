'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '@/components/ui/icons';
import { apiClient } from '@/lib/api/api-client';
import { openDocumentPreview } from '@/lib/services/preview-document';
import { checkUploadInBrowser } from '@/lib/services/client-upload-check';
import { cn } from '@/lib/utils';

interface DocumentUploaderProps {
  label: string;
  description?: string;
  required?: boolean;
  accept?: string;
  slotId?: string;
  stepKey?: string;
  draftId?: string;
  applicationId?: string;
  initialFileName?: string;
  initialUrl?: string;
  initialUploaded?: boolean;
  onUpload: (file: File | null, url?: string) => void;
}

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
};

const resolveFileUrl = (url?: string | null): string | null => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return url;
};

export function DocumentUploader({
  label,
  description,
  required = false,
  accept = '.pdf',
  slotId,
  stepKey = 'plant-selection',
  draftId,
  applicationId,
  initialFileName,
  initialUrl,
  initialUploaded,
  onUpload,
}: DocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [persistedUrl, setPersistedUrl] = useState<string | null>(resolveFileUrl(initialUrl));
  const [uploaded, setUploaded] = useState(Boolean(initialUploaded));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    setFileName(initialFileName || null);
    setPersistedUrl(resolveFileUrl(initialUrl));
    setUploaded(Boolean(initialUploaded || initialUrl));
  }, [initialFileName, initialUploaded, initialUrl]);

  const statusLabel = useMemo(() => {
    if (uploading) return 'กำลังอัปโหลดเอกสาร...';
    if (uploadError) return uploadError;
    if (uploaded && persistedUrl) {
      return file ? `อัปโหลดแล้ว (${formatFileSize(file.size)})` : 'อัปโหลดแล้ว';
    }
    if (file && !persistedUrl) return 'กำลังจัดเตรียมไฟล์...';
    return 'ยังไม่ได้อัปโหลดไฟล์';
  }, [file, persistedUrl, uploadError, uploaded, uploading]);

  const handleChange = async (nextFile: File | null) => {
    setFile(nextFile);
    setUploadError(null);

    if (!nextFile) {
      setFileName(null);
      setPersistedUrl(null);
      setUploaded(false);
      onUpload(null);
      return;
    }

    setFileName(nextFile.name);

    // F-G4-08 — these are the ภท.11 / ภท.09 / ภท.10 slots the 70-byte pixel was
    // measured going into. Same rules, same module, as every other slot and as
    // the server.
    const verdict = await checkUploadInBrowser(nextFile, { slotId: slotId || label });
    if (!verdict.ok && verdict.message) {
      setUploadError(verdict.message);
      setPersistedUrl(null);
      setUploaded(false);
      onUpload(null);
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', nextFile);
      formData.append('slotId', slotId || label);
      formData.append('stepKey', stepKey);
      if (draftId) formData.append('draftId', draftId);
      if (applicationId) formData.append('applicationId', applicationId);

      const response = await apiClient.post<{ fileUrl?: string }>('/applications/draft-documents', formData);
      if (!response.success || !response.data?.fileUrl) {
        // The server's refusal already names the cause and the next action.
        const message = response.error || 'ไม่สามารถอัปโหลดเอกสารได้ คุณสามารถลองใหม่อีกครั้ง';
        setUploadError(message);
        setPersistedUrl(null);
        setUploaded(false);
        onUpload(null);
        return;
      }

      const url = resolveFileUrl(response.data.fileUrl);
      setPersistedUrl(url);
      setUploaded(Boolean(url));
      onUpload(nextFile, url || undefined);
    } catch {
      setUploadError('อัปโหลดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      setPersistedUrl(null);
      setUploaded(false);
      onUpload(null);
    } finally {
      setUploading(false);
    }
  };

  const clearFile = () => {
    if (uploading) return;
    setFile(null);
    setFileName(null);
    setPersistedUrl(null);
    setUploadError(null);
    setUploaded(false);
    if (inputRef.current) inputRef.current.value = '';
    onUpload(null);
  };

  const statusToneClass = uploadError
    ? 'bg-rose-100 text-rose-700'
    : uploaded
      ? 'bg-leaf-soft text-leaf-onSoft'
      : 'bg-slate-200 text-foreground';

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-none sm:p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <span
            className={cn(
              'inline-flex rounded-lg border px-2 py-0.5 text-[11px] font-semibold',
              required ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-border bg-card text-foreground',
            )}
          >
            {required ? 'จำเป็น' : 'ทางเลือก'}
          </span>
        </div>
        {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>

      <div className="mt-3 space-y-2.5 border-t border-border pt-3">
        <label
          className={cn(
            'group flex min-h-[72px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-3 transition',
            'hover:border-slate-400 hover:bg-slate-50',
            uploading && 'cursor-wait opacity-70',
          )}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {fileName || 'เลือกไฟล์เอกสารเพื่ออัปโหลด'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">รองรับ {accept || '.pdf'} และบันทึกไฟล์เข้าเอกสารร่างคำขอทันที</p>
          </div>

          <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-leaf-800 bg-leaf-700 px-3 text-xs font-semibold text-white">
            <Icons.Upload size={14} />
            {uploaded ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}
          </span>

          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={accept}
            disabled={uploading}
            onChange={(event) => {
              const nextFile = event.target.files && event.target.files.length > 0 ? event.target.files[0] ?? null : null;
              void handleChange(nextFile);
            }}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('inline-flex rounded-lg border px-2.5 py-1 text-xs font-semibold', statusToneClass, uploadError ? 'border-rose-200' : uploaded ? 'border-leaf-300' : 'border-border')}>
            {statusLabel}
          </span>

          {persistedUrl ? (
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg border border-slate-800 bg-slate-800 px-3 text-xs font-semibold text-white transition hover:bg-slate-700"
              onClick={() => {
                // BUG A: /uploads/* ships Content-Disposition:attachment, so a raw
                // window.open downloads instead of previewing. Fetch as a blob and
                // open the object URL inline (preserves the security headers).
                void openDocumentPreview(persistedUrl).catch(() =>
                  setUploadError('ไม่สามารถเปิดดูไฟล์ได้ กรุณาลองใหม่'),
                );
              }}
            >
              เปิดไฟล์
            </button>
          ) : null}

          {(fileName || persistedUrl) ? (
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground transition hover:bg-slate-50"
              onClick={clearFile}
            >
              ลบไฟล์
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default DocumentUploader;


