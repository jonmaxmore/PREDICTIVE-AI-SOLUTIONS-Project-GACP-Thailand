'use client';

/**
 * เปลี่ยนรหัสผ่านของตัวเอง (เจ้าหน้าที่) — มติ operator 2026-09-26 "ปิด + เพิ่มเปลี่ยนรหัสของตัวเองให้เจ้าหน้าที่"
 *
 * หน้าจัดการเจ้าหน้าที่ตั้งรหัสผ่านให้คนอื่นไม่ได้แล้ว (ไม่มีการกู้บัญชี มติ 2026-09-17) การ์ดนี้จึงเป็นทางเดียว
 * ที่รหัสผ่านของเจ้าหน้าที่เปลี่ยนได้หลังสร้างบัญชี ต้องรู้รหัสผ่านปัจจุบันเสมอ
 * backend: POST /api/auth/provider/change-password (เกณฑ์ความแข็งแรงเดียวกับตอนสมัคร/สร้างบัญชี)
 * เปลี่ยนสำเร็จแล้ว backend ตัดทุก session ของบัญชีนี้รวมเครื่องที่ใช้อยู่ การ์ดจึงพาออกจากระบบไปหน้าเข้าสู่ระบบ
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, AlertTriangle, Loader2 } from 'lucide-react';

import { apiClient } from '@/lib/api/api-client';
import { AuthService } from '@/lib/services/auth-service';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';

export const PROVIDER_CHANGE_PASSWORD_PATH = '/auth/provider/change-password';

export default function ChangePasswordCard() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('กรุณากรอกให้ครบทั้งสามช่อง');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน กรุณากรอกใหม่');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.post<unknown>(PROVIDER_CHANGE_PASSWORD_PATH, {
        oldPassword: currentPassword,
        newPassword,
      });
      if (!res.success) {
        setError(res.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      setDone(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // Every session of this account was revoked, this one included.
      await AuthService.logout();
      router.push('/auth/provider/login');
    } catch {
      setError('เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card data-testid="change-own-password" className="rounded-lg border-border bg-card shadow-none">
      <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          เปลี่ยนรหัสผ่าน
        </CardTitle>
      </CardHeader>
      {/* sm:pt-6: the primitive's own sm:pt-0 survives a bare p-6 and glues the text to the divider */}
      <CardContent className="space-y-4 p-6 sm:pt-6">
        <p className="text-sm text-muted-foreground">
          ต้องใช้รหัสผ่านปัจจุบันทุกครั้ง ระบบไม่มีการกู้บัญชี และผู้ดูแลตั้งรหัสผ่านให้คุณไม่ได้
          เมื่อเปลี่ยนแล้ว ทุกอุปกรณ์จะออกจากระบบ ให้เข้าสู่ระบบใหม่ด้วยรหัสผ่านใหม่
        </p>
        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            label="รหัสผ่านปัจจุบัน"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            required
          />
          <Input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            label="รหัสผ่านใหม่"
            description="อย่างน้อย 10 ตัวอักษร มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ"
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            required
          />
          <Input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            label="ยืนยันรหัสผ่านใหม่"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            required
          />
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {done && (
            <p role="status" className="text-sm text-foreground">
              เปลี่ยนรหัสผ่านแล้ว กำลังพาไปหน้าเข้าสู่ระบบ
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            เปลี่ยนรหัสผ่าน
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
