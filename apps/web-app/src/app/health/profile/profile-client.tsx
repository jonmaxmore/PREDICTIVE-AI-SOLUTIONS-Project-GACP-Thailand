"use client";

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  User,
  Mail,
  Phone,
  ShieldCheck,
  MapPin,
  LogOut,
  Lock,
  Bell,
  ChevronRight,
  Pencil,
  Save,
  X,
  Wrench,
  ShieldAlert,
} from 'lucide-react';

import { AuthService, AuthUser } from '@/lib/services/auth-service';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { Input } from '@/components/ui/primitives/input';
import { Button } from '@/components/ui/primitives/button';
import { SummaryHeader } from '@/components/feature';

export function ProfileClientView() {
  const router = useRouter();
  // W5-C: stable ids for label/input association (WCAG 1.3.1 + 3.3.2).
  const firstNameId = useId();
  const lastNameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const addressId = useId();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    address: '',
  });

  useEffect(() => {
    const data = AuthService.getUser();
    if (!data) {
      router.replace('/auth/health/login');
      return;
    }
    setUser(data);
    setFormData({
      firstName: data.firstName || '',
      lastName: data.lastName || '',
      email: data.email || '',
      phoneNumber: data.phoneNumber || '',
      address: (data as Record<string, unknown>)?.address as string || '',
    });
    setLoading(false);
  }, [router]);

  const handleLogout = () => {
    AuthService.logout();
    router.replace('/auth/health/login');
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const result = await AuthService.updateProfile(formData);
      if (result.success && result.data) {
        setUser(result.data);
        setIsEditing(false);
      }
    } catch {
      /* silently fail — user stays in edit mode */
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (user) {
      setFormData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        phoneNumber: user.phoneNumber || '',
        address: (user as Record<string, unknown>)?.address as string || '',
      });
    }
    setIsEditing(false);
  };

  if (loading) return <PageSkeleton type="form" />;

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
    : 'มกราคม 2569';

  return (
    // Wave E.2-B (batch 9): SummaryHeader replaces inline h1+p+actions.
    // Edit / Cancel+Save buttons move into the actions slot. Width is now the
    // single max-w-7xl standard from the layout (2026-06-11) — no per-page cap.
    <div className="animate-fade-in w-full space-y-6 pb-20 md:pb-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · บัญชีผู้ใช้"
        title="โปรไฟล์สมาชิก"
        description="ข้อมูลส่วนตัวและการตั้งค่าบัญชี"
        actions={
          !isEditing ? (
            <Button
              variant="outline"
              className="gap-2 rounded-xl border-primary/40 px-5 py-2.5 text-sm font-semibold text-primary shadow-sm transition-all hover:bg-primary hover:text-white hover:shadow-md"
              onClick={() => setIsEditing(true)}
            >
              <Pencil size={16} />
              แก้ไขโปรไฟล์
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 rounded-xl"
                onClick={handleCancel}
                disabled={saving}
              >
                <X size={14} />
                ยกเลิก
              </Button>
              <Button
                size="sm"
                className="gap-2 rounded-xl"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? <Spinner className="h-4 w-4" /> : <Save size={14} />}
                บันทึก
              </Button>
            </div>
          )
        }
      />

      {/* User Summary Card — ui_kit hero lockup: forest→leaf gradient
          banner with a leaf-icon avatar, matching the certificate header
          treatment in the ref (screens-more.jsx). */}
      <Card className="overflow-hidden rounded-[1.375rem] border-none p-0">
        <CardContent className="flex items-center gap-4 bg-gradient-to-br from-primary to-leaf p-5 text-white sm:p-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white">
            <User size={28} strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white">
              {user?.firstName || ''} {user?.lastName || ''}
            </h2>
            <p className="text-xs font-medium text-white/75">
              สมาชิกตั้งแต่ {memberSince}
            </p>
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-leaf-300" />
              <ShieldCheck size={12} />
              ยืนยันตัวตนแล้ว
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Personal Information — list rows with leaf-icon avatars + soft
          mint surface (ui_kit list pattern), inset border separators. */}
      <Card className="overflow-hidden rounded-[1.375rem] border-none p-0">
        <CardContent className="p-0">
          <div className="border-b border-mint-bg px-5 py-4">
            <label htmlFor={firstNameId} className="mb-2 flex items-center gap-3 text-xs font-bold text-muted-foreground">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                <User size={16} />
              </span>
              ชื่อ-นามสกุล
            </label>
            {isEditing ? (
              <div className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input id={firstNameId} value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} placeholder="ชื่อ" aria-label="ชื่อ" />
                <Input id={lastNameId} value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} placeholder="นามสกุล" aria-label="นามสกุล" />
              </div>
            ) : (
              <p className="pl-12 text-sm font-semibold text-foreground">{user?.firstName ? `${user.firstName} ${user.lastName || ''}` : '-'}</p>
            )}
          </div>
          <div className="border-b border-mint-bg px-5 py-4">
            <label htmlFor={emailId} className="mb-2 flex items-center gap-3 text-xs font-bold text-muted-foreground">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                <Mail size={16} />
              </span>
              อีเมล
            </label>
            {isEditing ? (
              <Input id={emailId} className="mt-1.5" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="อีเมล" />
            ) : (
              <p className="pl-12 text-sm font-semibold text-foreground">{String(user?.email || '-')}</p>
            )}
          </div>
          <div className="border-b border-mint-bg px-5 py-4">
            <label htmlFor={phoneId} className="mb-2 flex items-center gap-3 text-xs font-bold text-muted-foreground">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                <Phone size={16} />
              </span>
              เบอร์โทรศัพท์
            </label>
            {isEditing ? (
              <Input id={phoneId} className="mt-1.5" value={formData.phoneNumber} onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })} placeholder="0xx-xxx-xxxx" />
            ) : (
              <p className="pl-12 text-sm font-semibold text-foreground">{String(user?.phoneNumber || '-')}</p>
            )}
          </div>
          <div className="px-5 py-4">
            <label htmlFor={addressId} className="mb-2 flex items-center gap-3 text-xs font-bold text-muted-foreground">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                <MapPin size={16} />
              </span>
              ที่อยู่
            </label>
            {isEditing ? (
              <Input id={addressId} className="mt-1.5" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="ที่อยู่ตามทะเบียนบ้าน" />
            ) : (
              <p className="pl-12 text-sm font-semibold text-foreground">{String((user as Record<string, unknown>)?.address || '-')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Account management & preferences — ui_kit list rows: leaf-icon
          avatar + label + chevron, mint-soft hover surface. The logout
          row keeps its destructive tone. */}
      <div className="space-y-2">
        <button
          className="flex w-full items-center justify-between rounded-[1.375rem] bg-card px-5 py-4 text-left shadow-leaf-card transition-colors hover:bg-mint-soft"
          onClick={() => router.push('/health/settings')}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft"><Lock size={16} /></span>
            <span className="text-sm font-bold text-foreground">ความปลอดภัย</span>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
        <button
          className="flex w-full items-center justify-between rounded-[1.375rem] bg-card px-5 py-4 text-left shadow-leaf-card transition-colors hover:bg-mint-soft"
          onClick={() => router.push('/health/profile/security')}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft"><ShieldCheck size={16} /></span>
            <span className="text-sm font-bold text-foreground">การยืนยันตัวตน 2 ขั้นตอน (2FA)</span>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
        <button
          className="flex w-full items-center justify-between rounded-[1.375rem] bg-card px-5 py-4 text-left shadow-leaf-card transition-colors hover:bg-mint-soft"
          onClick={() => router.push('/health/profile/notifications')}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft"><Bell size={16} /></span>
            <span className="text-sm font-bold text-foreground">การแจ้งเตือน</span>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
        <button
          className="flex w-full items-center justify-between rounded-[1.375rem] bg-card px-5 py-4 text-left shadow-leaf-card transition-colors hover:bg-mint-soft"
          onClick={() => router.push('/health/profile/privacy')}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft"><ShieldAlert size={16} /></span>
            <span className="text-sm font-bold text-foreground">ความเป็นส่วนตัว (PDPA)</span>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
        <button
          className="flex w-full items-center justify-between rounded-[1.375rem] bg-card px-5 py-4 text-left shadow-leaf-card transition-colors hover:bg-mint-soft"
          onClick={() => router.push('/health/more')}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft"><Wrench size={16} /></span>
            <span className="text-sm font-bold text-foreground">เครื่องมือเพิ่มเติม</span>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
        <button
          className="flex w-full items-center justify-between rounded-[1.375rem] bg-card px-5 py-4 text-left shadow-leaf-card transition-colors hover:bg-destructive/5"
          onClick={handleLogout}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><LogOut size={16} /></span>
            <span className="text-sm font-bold text-destructive">ออกจากระบบ</span>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
