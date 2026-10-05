'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { SummaryHeader } from '@/components/feature';

export default function HealthDocumentsPage() {
  const router = useRouter();
  const [documentId, setDocumentId] = useState('');
  const [error, setError] = useState('');
  const normalizedId = useMemo(() => documentId.trim(), [documentId]);

  const openDocument = () => {
    if (!normalizedId) {
      setError('กรุณากรอกรหัสเอกสาร');
      return;
    }
    setError('');
    router.push(`/health/documents/${encodeURIComponent(normalizedId)}`);
  };

  return (
    // Wave E.2-B: SummaryHeader replaces the inline title + description +
    // "Health Portal" badge that lived inside the form card. The badge
    // is now redundant (eyebrow conveys the same context). The form
    // card below is now visually distinct from the header — clearer
    // scanability for users searching by document ID.
    // Full-width (2026-06-10): owner directive — fill the screen on PC. DashboardLayout's
    // <main> supplies the gutter; the list spans the full viewport width.
    <div className="w-full space-y-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · ศูนย์เอกสาร"
        title="ศูนย์เอกสาร"
        description="เปิดไฟล์ประกอบตามรหัสเอกสาร หรือกลับไปดูบันทึกคำขอของคุณ"
      />

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder="รหัสเอกสาร"
            value={documentId}
            onChange={(event) => setDocumentId(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                openDocument();
              }
            }}
          />
          <Button onClick={openDocument}>เปิดเอกสาร</Button>
        </div>

        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/health/applications"
          className="rounded-xl border border-border bg-card p-5 no-underline transition hover:border-primary/40 hover:shadow-sm"
        >
          <p className="text-sm font-medium text-foreground">คำขอของฉัน</p>
          <p className="mt-1 text-sm text-muted-foreground">
            ตรวจสอบสถานะการยื่นและไฟล์แนบในแต่ละคำขอ
          </p>
        </Link>
        <Link
          href="/health/payments"
          className="rounded-xl border border-border bg-card p-5 no-underline transition hover:border-primary/40 hover:shadow-sm"
        >
          <p className="text-sm font-medium text-foreground">ประวัติการชำระเงิน</p>
          <p className="mt-1 text-sm text-muted-foreground">
            ตรวจสอบเลขที่ใบแจ้งหนี้ก่อนเปิดเอกสารที่เกี่ยวข้อง
          </p>
        </Link>
      </div>
    </div>
  );
}
