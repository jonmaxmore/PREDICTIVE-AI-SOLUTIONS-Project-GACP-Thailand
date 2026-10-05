'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Download,
  ShieldCheck,
  Trash2,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  ArrowRight,
} from 'lucide-react';

import { apiClient } from '@/lib/api/api-client';
import { AuthService } from '@/lib/services/auth-service';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives/card';
import { notifications } from '@/lib/notifications';
import { SummaryHeader } from '@/components/feature';

const DELETE_CONFIRM_TEXT = 'ลบบัญชี';

export default function HealthPrivacyPage() {
  const router = useRouter();

  // Export-flow state
  const [exporting, setExporting] = useState(false);

  // Delete-flow state
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // The endpoint returns a JSON blob with Content-Disposition: attachment.
      // apiClient.getBlob handles the auth header so the cookie-protected
      // endpoint accepts the request even on browsers that don't auto-send
      // the auth_token cookie cross-origin.
      const blob = await apiClient.getBlob('/auth/health/me/export');
      if (!blob) {
        throw new Error('Empty response from server');
      }
      const filename = `gacp-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      notifications.show({
        title: 'ดาวน์โหลดสำเร็จ',
        message: `บันทึกเป็นไฟล์ ${filename} แล้ว`,
        color: 'green',
      });
    } catch (err) {
      notifications.show({
        title: 'ดาวน์โหลดไม่สำเร็จ',
        message: err instanceof Error ? err.message : 'กรุณาลองใหม่อีกครั้ง',
        color: 'red',
      });
    } finally {
      setExporting(false);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (deleteConfirm !== DELETE_CONFIRM_TEXT) {
      notifications.show({
        title: 'ข้อความยืนยันไม่ถูกต้อง',
        message: `กรุณาพิมพ์ "${DELETE_CONFIRM_TEXT}" ตามตัวอักษรเพื่อยืนยัน`,
        color: 'red',
      });
      return;
    }
    if (!deletePassword) {
      notifications.show({
        title: 'ต้องการรหัสผ่าน',
        message: 'กรุณาใส่รหัสผ่านปัจจุบันเพื่อยืนยันว่าเป็นคุณ',
        color: 'red',
      });
      return;
    }

    setDeleting(true);
    try {
      const res = await apiClient.delete('/auth/health/me/delete', {
        body: { password: deletePassword, reason: deleteReason || undefined },
      });
      if (!res.success) {
        throw new Error(res.error || 'Delete failed');
      }
      notifications.show({
        title: 'ส่งคำขอลบบัญชีแล้ว',
        message: 'ระบบจะออกจากระบบและแสดงหน้าเข้าสู่ระบบให้คุณ',
        color: 'orange',
      });
      // Local cleanup — backend already cleared cookies.
      try {
        await AuthService.logout();
      } catch {
        /* fall through to redirect anyway */
      }
      // Brief pause so the toast is readable before navigation.
      setTimeout(() => router.replace('/auth/health/login?deleted=1'), 1500);
    } catch (err) {
      notifications.show({
        title: 'ลบบัญชีไม่สำเร็จ',
        message: err instanceof Error ? err.message : 'กรุณาลองใหม่อีกครั้ง',
        color: 'red',
      });
      setDeleting(false);
    }
  }, [deleteConfirm, deletePassword, deleteReason, router]);

  return (
    // Wave E.2-B (batch 9): SummaryHeader replaces inline back-button
    // + h1 + p row. Back button moves into actions slot using ghost
    // variant + ChevronLeft icon, matching the convention used on
    // other detail/sub pages.
    // B1 (audit 2026-06-10): DashboardLayout already provides the page <main>, so
    // this inner <main> was invalid landmark nesting. Swap to <div>.
    // Full-width carpet-sweep (2026-06-10): dropped mx-auto + max-w-2xl so the
    // page fills the screen on PC (owner directive — every in-app page full-width).
    <div className="w-full space-y-6 p-4 pb-20 md:p-6 md:pb-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · ความเป็นส่วนตัว"
        title="ความเป็นส่วนตัว (PDPA)"
        description="สิทธิตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562"
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl"
            onClick={() => router.push('/health/profile')}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            กลับ
          </Button>
        }
      />

      {/* Section: Export */}
      <Card className="rounded-2xl border-border bg-card">
        <CardHeader className="border-b border-border/50 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Download className="h-4 w-4 text-primary" />
            ดาวน์โหลดข้อมูลของคุณ (มาตรา 30)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            สำเนาข้อมูลส่วนบุคคลทั้งหมดที่ระบบเก็บไว้เกี่ยวกับคุณ รวมถึงโปรไฟล์ คำขอ
            ฟาร์ม ใบรับรอง ใบแจ้งหนี้ และประวัติการแจ้งเตือน ส่งออกเป็นไฟล์ JSON
            มาตรฐาน
          </p>
          <p className="text-xs text-muted-foreground">
            ข้อมูลที่ดาวน์โหลดได้จะไม่รวมรหัสผ่านหรือข้อมูล MFA
            (ไม่ต้องการให้ผู้รับไฟล์เข้าระบบแทนคุณได้)
          </p>
          <Button
            onClick={() => void handleExport()}
            disabled={exporting}
            className="rounded-xl"
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            ดาวน์โหลดเป็น JSON
          </Button>
        </CardContent>
      </Card>

      {/* Section: Erasure callout — R4-D
          New 2-step flow at /health/account/erasure. The legacy
          single-step delete UI below stays in service this iter
          (R6 scope to deprecate); the two surfaces coexist so users
          can pick the safer path while we migrate the rest of the
          flows over. */}
      <Card className="rounded-2xl border-primary/30 bg-card">
        <CardHeader className="border-b border-primary/20 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-primary">
            <ShieldCheck className="h-4 w-4" />
            วิธีใหม่ (2 ขั้นตอน แนะนำ)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm text-muted-foreground">
            ปลอดภัยขึ้น ส่งคำขอแล้วยืนยันด้วยลิงก์อีเมล (มาตรา 32 PDPA){' '}
            ระบบจะแสดงผลกระทบที่ชัดเจนก่อนยืนยัน
            พร้อมหน้าต่างยืนยัน 24 ชั่วโมงเพื่อป้องกันการคลิกผิดพลาด
          </p>
          <Link
            href="/health/account/erasure"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            ไปที่ขั้นตอนใหม่
            <ArrowRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>

      {/* Section: Delete account — วิธีเดิม (1 ขั้นตอน) */}
      <Card className="rounded-2xl border-destructive/30 bg-card">
        <CardHeader className="border-b border-destructive/20 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-destructive">
            <Trash2 className="h-4 w-4" />
            วิธีเดิม (1 ขั้นตอน) ลบบัญชีของฉัน (มาตรา 33)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-bold">ก่อนตัดสินใจลบบัญชี</p>
              <ul className="list-disc space-y-1 pl-4 text-xs">
                <li>
                  หากคุณมี <strong>ใบรับรอง GACP ที่ออกแล้ว</strong>{' '}
                  ระบบจะเก็บประวัติคำขอตามกฎหมาย (5
                  ปีหลังจากใบรับรองหมดอายุ) เพื่อรองรับการตรวจสอบของกรมการแพทย์แผนไทย
                </li>
                <li>
                  ข้อมูลส่วนบุคคล (ชื่อ อีเมล เบอร์โทร) จะถูกซ่อนจากการค้นหาทันที
                </li>
                {/* เคยเขียนว่า "หลังจากผ่าน 30 วันแรก จะกู้คืนไม่ได้" ซึ่งอ่านได้ว่าภายใน 30 วันกู้ได้
                    ไม่มี route ใดคืนบัญชีที่ลบแล้ว และมติ operator 2026-09-17 "เราไม่มีการกู้บัญชี" */}
                <li>
                  ลบแล้ว<strong>จะกู้คืนบัญชีไม่ได้</strong> เพราะระบบไม่มีการกู้บัญชี
                </li>
                <li>
                  หากระบบทำเครื่องหมาย <code>legal hold</code>{' '}
                  ไว้กับบัญชีของคุณ การลบจะถูกปฏิเสธ
                  ติดต่อเจ้าหน้าที่ DTAM
                </li>
              </ul>
            </div>
          </div>

          {!showDeleteForm ? (
            <Button
              variant="destructive"
              onClick={() => setShowDeleteForm(true)}
              className="rounded-xl"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              เริ่มขั้นตอนลบบัญชี
            </Button>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="delete-password" className="mb-1 block text-sm font-medium text-foreground">
                  รหัสผ่านปัจจุบัน <span className="text-destructive">*</span>
                </label>
                <Input
                  id="delete-password"
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="ใส่รหัสผ่านเพื่อยืนยันว่าเป็นคุณ"
                  disabled={deleting}
                  autoComplete="current-password"
                />
              </div>

              <div>
                <label htmlFor="delete-reason" className="mb-1 block text-sm font-medium text-foreground">
                  เหตุผล (ไม่บังคับ)
                </label>
                <Input
                  id="delete-reason"
                  type="text"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="เช่น ไม่ใช้ระบบแล้ว"
                  maxLength={500}
                  disabled={deleting}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  ข้อมูลนี้ใช้เพื่อปรับปรุงระบบเท่านั้น ไม่ส่งผลต่อการลบ
                </p>
              </div>

              <div>
                <label htmlFor="delete-confirm" className="mb-1 block text-sm font-medium text-foreground">
                  พิมพ์{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                    {DELETE_CONFIRM_TEXT}
                  </code>{' '}
                  เพื่อยืนยัน <span className="text-destructive">*</span>
                </label>
                <Input
                  id="delete-confirm"
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={DELETE_CONFIRM_TEXT}
                  disabled={deleting}
                  autoComplete="off"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteForm(false);
                    setDeletePassword('');
                    setDeleteReason('');
                    setDeleteConfirm('');
                  }}
                  disabled={deleting}
                  className="rounded-xl"
                >
                  ยกเลิก
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  disabled={
                    deleting
                    || !deletePassword
                    || deleteConfirm !== DELETE_CONFIRM_TEXT
                  }
                  className="rounded-xl"
                >
                  {deleting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  ยืนยันลบบัญชี
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer note */}
      <Card className="rounded-2xl border-border bg-muted/30">
        <CardContent className="space-y-2 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            อ้างอิงทางกฎหมาย
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA) มาตรา 30
            ให้สิทธิเจ้าของข้อมูลขอเข้าถึงและรับสำเนาข้อมูลส่วนบุคคล มาตรา 33
            ให้สิทธิขอให้ลบหรือทำลายข้อมูล หรือทำให้ข้อมูลส่วนบุคคลไม่สามารถระบุตัวบุคคลได้
            สำหรับคำถามเกี่ยวกับการคุ้มครองข้อมูลส่วนบุคคล{' '}
            ติดต่อเจ้าหน้าที่ DTAM
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
