'use client';

import type { ReactNode } from 'react';

// ปุ่มส่งฟอร์มที่ถามยืนยันก่อน (ใช้กับการลบไฟล์และลบรายการพันธุ์)
export function ConfirmSubmitButton({
  confirmText,
  className,
  children,
}: {
  readonly confirmText: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(confirmText)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
