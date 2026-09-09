'use client';

import { useRef } from 'react';
import { useFormStatus } from 'react-dom';

type UploadFieldProps = {
  readonly accept: string;
  readonly chooseLabel: string;
  readonly dropHint: string;
  readonly limitsLabel: string;
  readonly uploadingLabel: string;
  readonly capture?: boolean;
};

// ช่องเลือกไฟล์ที่ส่งฟอร์มทันทีเมื่อเลือก (ท่ออัปโหลดเดียว) รองรับลากไฟล์มาวางและถ่ายภาพจากมือถือ
export function UploadField({
  accept,
  chooseLabel,
  dropHint,
  limitsLabel,
  uploadingLabel,
  capture,
}: UploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { pending } = useFormStatus();

  const onDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const input = inputRef.current;
    if (!input || event.dataTransfer.files.length === 0) return;
    input.files = event.dataTransfer.files;
    input.form?.requestSubmit();
  };

  return (
    <label
      className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-md border border-dashed border-[#d9c58a] bg-surface px-4 py-3 hover:bg-paper"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <span>
        <span className="block text-sm font-semibold text-ink-soft">
          {pending ? uploadingLabel : dropHint}
        </span>
        <span className="block text-xs text-quiet">{limitsLabel}</span>
      </span>
      <span className="inline-flex h-9 items-center rounded-md bg-leaf px-4 text-sm font-bold text-white shadow-button">
        {chooseLabel}
      </span>
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept={accept}
        className="sr-only"
        disabled={pending}
        capture={capture ? 'environment' : undefined}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      />
    </label>
  );
}
