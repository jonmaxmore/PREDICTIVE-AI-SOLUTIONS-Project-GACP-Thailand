'use client';

import { useRef } from 'react';

type DocumentViewerProps = {
  readonly contentPath: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly openLabel: string;
  readonly closeLabel: string;
  readonly unsupportedLabel: string;
  readonly downloadLabel: string;
};

// เปิดดูเอกสารในหน้า (ไม่บังคับดาวน์โหลด) PDF ผ่าน iframe ภาพผ่าน img ชนิดอื่นให้ดาวน์โหลด
export function DocumentViewer({
  contentPath,
  fileName,
  mimeType,
  openLabel,
  closeLabel,
  unsupportedLabel,
  downloadLabel,
}: DocumentViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';

  return (
    <>
      <button
        type="button"
        className="text-xs font-semibold text-leaf hover:underline"
        onClick={() => dialogRef.current?.showModal()}
      >
        {openLabel}
      </button>
      <dialog
        ref={dialogRef}
        className="m-auto w-[min(96vw,1000px)] rounded-lg border border-border bg-navy p-0 text-white shadow-card backdrop:bg-black/60"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') dialogRef.current?.close();
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="truncate font-semibold">{fileName}</span>
          <span className="flex items-center gap-2">
            <a
              href={contentPath}
              className="rounded-md border border-white/40 px-3 py-1 text-xs"
              download={fileName}
            >
              {downloadLabel}
            </a>
            <button
              type="button"
              className="rounded-md bg-white px-3 py-1 text-xs font-bold text-navy"
              onClick={() => dialogRef.current?.close()}
            >
              {closeLabel}
            </button>
          </span>
        </div>
        <div className="flex max-h-[80vh] min-h-[60vh] items-center justify-center bg-[#13284a] p-4">
          {isPdf ? (
            <iframe
              title={fileName}
              src={contentPath}
              className="h-[78vh] w-full rounded bg-white"
            />
          ) : isImage ? (
            // biome-ignore lint/performance/noImgElement: เอกสารของผู้ใช้ไม่ควรผ่าน image optimizer ของ Next
            <img
              src={contentPath}
              alt={fileName}
              className="max-h-[78vh] max-w-full rounded bg-white object-contain"
            />
          ) : (
            <p className="text-sm text-white/80">{unsupportedLabel}</p>
          )}
        </div>
      </dialog>
    </>
  );
}
