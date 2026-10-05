'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BriefcaseBusiness,
  Mail,
  RefreshCcw,
  ShieldCheck,
  UserRound,
  LogOut,
  Settings,
  LayoutDashboard,
  Verified,
  Building2,
  Phone,
  Bell,
} from 'lucide-react';
import ProviderLayout from '../components/provider-layout';
import { providerApiPaths } from '@/lib/services/provider-api';
import { apiClient } from '@/lib/api/api-client';
import { AuthService } from '@/lib/services/auth-service';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { SummaryHeader } from '@/components/feature/summary-header';
import { normalizeRole, ROLE_LABELS_EN } from '@/lib/role-utils';
import { providerRoleCanOpen } from '@/lib/provider-role-config';
import { useLanguage } from '@/lib/i18n/language-context';

interface ProviderProfile {
  id: string;
  providerId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  authType?: string;
  userType?: string;
  ministryVerified?: boolean;
  phoneNumber?: string;
}

// Role labels imported from @/lib/role-utils (ROLE_LABELS_EN)

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['จัดการผู้ใช้', 'จัดการขั้นตอนงาน', 'อนุมัติกรณีพิเศษ', 'ดูทุกโมดูล'],
  super_admin: ['ดูแลระบบทั้งหมด', 'ควบคุมนโยบายความปลอดภัย', 'ดูทุกโมดูล'],
  document_reviewer: ['ตรวจเอกสาร', 'ขอแก้ไขเอกสาร', 'อนุมัติขั้นตอนเอกสาร'],
  reviewer_auditor: ['ตรวจเอกสาร', 'ขอแก้ไขเอกสาร', 'อนุมัติขั้นตอนเอกสาร'],
  reviewer: ['ตรวจเอกสาร', 'ขอแก้ไขเอกสาร'],
  scheduler: ['มอบหมายผู้ตรวจประเมิน', 'จัดตารางตรวจ', 'ติดตาม SLA'],
  auditor: ['ตรวจประเมิน ณ แปลงปลูก', 'ออกใบ CAR', 'ตรวจหลักฐานการแก้ไข', 'ตรวจขั้นสุดท้าย', 'อนุมัติขั้นสุดท้าย'],
  head_auditor: ['ตรวจประเมิน ณ แปลงปลูก', 'ออกใบ CAR', 'ตรวจหลักฐานการแก้ไข', 'ตรวจขั้นสุดท้าย', 'อนุมัติขั้นสุดท้าย'], // Consolidated
  accountant: ['ดูบันทึกธุรกรรม', 'กระทบยอดการชำระเงิน', 'ส่งออกรายงานภาษี'],
  account: ['ดูบันทึกธุรกรรม', 'กระทบยอดการชำระเงิน', 'ส่งออกรายงานภาษี'],
};

// normalizeRole imported from @/lib/role-utils

function fullName(profile: ProviderProfile | null): string {
  if (!profile) return '-';
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  return name || profile.email;
}

export default function ProviderProfilePage() {
  const router = useRouter();
  const { dict } = useLanguage();
  const pDict = dict.provider?.profile;
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<ProviderProfile>(providerApiPaths.profileMe);

      if (!response.success || !response.data) {
        throw new Error(response.error || pDict?.errorPrefix || 'Unable to load provider profile');
      }

      setProfile(response.data);
    } catch (fetchError: unknown) {
      setProfile(null);
      setError(fetchError instanceof Error ? fetchError.message : (pDict?.errorPrefix || 'Unable to load provider profile'));
    } finally {
      setLoading(false);
    }
  }, [pDict?.errorPrefix]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const roleKey = normalizeRole(profile?.role) || '';
  // System Settings is admin-only (/provider/settings is gated to ADMIN). Showing the
  // quick-action to scheduler/account/reviewer/auditor would bounce them back to the
  // dashboard — the same "เด่งไปเด่งมา" class as the in-page links fixed elsewhere.
  const canOpenSystemSettings = providerRoleCanOpen(profile?.role, '/provider/settings/system');
  const roleLabel = useMemo(() => ROLE_LABELS_EN[roleKey] || profile?.role || '-', [profile?.role, roleKey]);
  const permissionList = useMemo(() => ROLE_PERMISSIONS[roleKey] || [pDict?.roleFallback || 'Role-based access enabled'], [roleKey, pDict?.roleFallback]);

  const handleLogout = async () => {
    await AuthService.logout();
    router.push('/auth/provider/login');
  };

  const metrics = useMemo(() => {
    if (!profile) return [];
    const m = pDict?.metrics;
    return [
      { label: m?.role || 'Role', value: roleLabel.split(' ')[0] ?? roleLabel, icon: '🛡️' },
      { label: m?.verified || 'Verified', value: profile.ministryVerified ? (m?.yes || 'Yes') : (m?.no || 'No'), icon: '✅' },
      { label: m?.status || 'Status', value: m?.active || 'Active', icon: '✨' },
    ];
  }, [profile, roleLabel, pDict?.metrics]);

  return (
    <ProviderLayout title={pDict?.pageTitle || 'Officer Profile'} subtitle={pDict?.pageSubtitle || 'Account identity and access control'}>
      <div className="animate-fade-in space-y-8">

        <SummaryHeader
          eyebrow={pDict?.eyebrow || 'Identity Management'}
          title={profile ? fullName(profile) : (pDict?.fallbackTitle || 'Officer Profile')}
          description={pDict?.description || 'Manage your provider account details, view assigned roles, and understand your system-wide permissions and access level.'}
          metrics={metrics}
          actions={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchProfile()}
              >
                <RefreshCcw className="mr-2 h-4 w-4" /> {pDict?.refresh || 'Refresh'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" /> {pDict?.logout || 'Log out'}
              </Button>
            </div>
          }
        />

        {error && (
          <Card className="rounded-lg border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-center gap-3 p-4 text-sm text-destructive">
              <ShieldCheck className="h-5 w-5" />
              {error}
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <RefreshCcw className="h-8 w-8 animate-spin text-primary/30" />
          </div>
        ) : profile ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

            {/* Identity Card */}
            <Card className="overflow-hidden rounded-lg border-border bg-card shadow-none">
              <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <UserRound className="h-4 w-4 text-primary" />
                  {pDict?.sections?.officialIdentity || 'Official Identity'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <UserRound className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">{fullName(profile)}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone="neutral" className="rounded-md text-xs">
                        {roleLabel}
                      </Badge>
                      {profile.ministryVerified && (
                        <Badge tone="success" className="rounded-md text-xs">
                          {pDict?.ministryVerified || 'Ministry Verified'}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoItem label={pDict?.labels?.providerId || 'Provider ID'} value={profile.providerId || '-'} />
                  <InfoItem label={pDict?.labels?.accountType || 'Account Type'} value={profile.userType || profile.authType || '-'} />
                </div>
              </CardContent>
            </Card>

            {/* Contact Card */}
            <Card className="overflow-hidden rounded-lg border-border bg-card shadow-none">
              <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Mail className="h-4 w-4 text-primary" />
                  {pDict?.sections?.contactInfo || 'Contact Information'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-6">
                <div className="space-y-4">
                  <ContactItem icon={Mail} label={pDict?.labels?.email || 'Email Address'} value={profile.email || '-'} />
                  <ContactItem icon={Phone} label={pDict?.labels?.phone || 'Phone Number'} value={profile.phoneNumber || '-'} />
                  <ContactItem icon={Building2} label={pDict?.labels?.organization || 'Organization'} value={pDict?.labels?.orgName || 'Department of Thai Traditional and Alternative Medicine'} />
                </div>
              </CardContent>
            </Card>

            {/* Permissions Card */}
            <Card className="overflow-hidden rounded-lg border-border bg-card shadow-none lg:col-span-2">
              <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {pDict?.sections?.permissions || 'Authorized Capabilities'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {permissionList.map((permission) => (
                    <div
                      key={permission}
                      className="flex items-center gap-2 py-1.5 text-sm text-foreground"
                    >
                      <Verified className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {permission}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Quick Actions */}
        <Card className="overflow-hidden rounded-lg border-border bg-card shadow-none">
          <CardHeader className="border-b border-border/50 px-6 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
              <BriefcaseBusiness className="h-4 w-4 text-primary" />
              {pDict?.sections?.sessionGov || 'Session & Governance'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 p-6">
            <Button variant="outline" onClick={() => router.push('/provider/profile/security')}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              {pDict?.quickActions?.securityMfa || 'Security & MFA'}
            </Button>
            {canOpenSystemSettings && (
              <Button variant="outline" onClick={() => router.push('/provider/settings/system')}>
                <Settings className="mr-2 h-4 w-4" />
                {pDict?.quickActions?.systemSettings || 'System Settings'}
              </Button>
            )}
            <Button variant="outline" onClick={() => router.push('/provider/profile/notifications')}>
              <Bell className="mr-2 h-4 w-4" />
              {pDict?.quickActions?.notifications || 'Notification Preferences'}
            </Button>
            <Button variant="outline" onClick={() => router.push('/provider/home')}>
              <LayoutDashboard className="mr-2 h-4 w-4" />
              {pDict?.quickActions?.dashboard || 'Dashboard'}
            </Button>
            <Button variant="destructive" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              {pDict?.quickActions?.endSession || 'End Session'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </ProviderLayout>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-0.5 text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function ContactItem({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string | undefined }>; label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}
