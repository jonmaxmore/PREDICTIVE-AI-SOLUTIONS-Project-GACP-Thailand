'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, Plus, RefreshCcw, UserPlus } from 'lucide-react';
import { apiClient } from '@/lib/api/api-client';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { CreateOrgDialog } from './_components/create-org-dialog';
import { CreateUserDialog } from './_components/create-user-dialog';
import type { ListPayload, Organization } from './_components/types';
import { EmptyState } from '@/components/feature/empty-state';
import { SummaryHeader } from '@/components/feature';

export const dynamic = 'force-dynamic';

const ORG_TYPE_LABEL: Record<string, string> = {
  GOVERNMENT: 'หน่วยงานราชการ',
  PRIVATE_CERTIFIER: 'หน่วยรับรองเอกชน (Certifier)',
  COOPERATIVE: 'สหกรณ์',
  FOREIGN_STANDARD: 'มาตรฐานต่างประเทศ',
  INTERNAL: 'ภายใน',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  ARCHIVED: 'destructive',
};

export default function AdminOrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [userDialogFor, setUserDialogFor] = useState<Organization | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.get<ListPayload>(
        '/api/platform-admin/organizations?limit=100'
      );
      if (result.success && result.data) {
        setOrgs(result.data.items || []);
      } else {
        setError(result.error || 'โหลดรายการล้มเหลว');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายการล้มเหลว');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    // Wave E.2-B (batch 8): SummaryHeader replaces inline h1+p+actions.
    // Building2 icon was decorative — title alone reads cleaner with
    // the eyebrow providing the "Admin · Tenants" frame.
    <div className="space-y-5">
      {/* X5-FIX-B H-11: gov-gradient brand cue on ADMIN header. */}
      <SummaryHeader
        eyebrow="ผู้ให้บริการ · องค์กร"
        title="องค์กร (Tenants)"
        description="จัดการองค์กรที่ใช้ระบบ แต่ละองค์กรเป็น tenant แยกในข้อมูล"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={refresh} disabled={loading} aria-label="รีเฟรชรายการองค์กร">
              <RefreshCcw className={loading ? 'mr-1 h-4 w-4 animate-spin' : 'mr-1 h-4 w-4'} aria-hidden="true" />
              รีเฟรช
            </Button>
            <Button size="sm" className="bg-white text-primary hover:bg-white/90" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              สร้างองค์กรใหม่
            </Button>
          </div>
        }
        className="gov-gradient border-none shadow-xl shadow-primary/20"
      />

      {error && (
        <Card className="border-destructive" role="alert" aria-live="polite">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            รายชื่อองค์กร {!loading && `(${orgs.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-gray-700" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> กำลังโหลด…
            </div>
          ) : orgs.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="ยังไม่มีองค์กร"
              hint="กดปุ่ม “สร้างองค์กรใหม่” ด้านบนเพื่อเริ่มต้น แต่ละองค์กรจะแยก tenant data ของตัวเอง"
            />
          ) : (
            <OrgTable orgs={orgs} onAddUser={setUserDialogFor} />
          )}
        </CardContent>
      </Card>

      <CreateOrgDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
      />

      <CreateUserDialog org={userDialogFor} onClose={() => setUserDialogFor(null)} />
    </div>
  );
}

function OrgTable({
  orgs,
  onAddUser,
}: {
  orgs: Organization[];
  onAddUser: (org: Organization) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-3">ชื่อ</th>
            <th className="py-2 pr-3">ตัวระบุ (Slug / Code)</th>
            <th className="py-2 pr-3">ประเภท</th>
            <th className="py-2 pr-3">สถานะ</th>
            <th className="py-2 pr-3">ระดับการแยกข้อมูล (Tier)</th>
            <th className="py-2 pr-3 text-right">การกระทำ</th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((org) => (
            <tr key={org.id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="py-2 pr-3">
                <div className="font-medium">{org.name}</div>
                {org.contactEmail && (
                  <div className="text-xs text-muted-foreground">{org.contactEmail}</div>
                )}
              </td>
              <td className="py-2 pr-3 font-mono text-xs">
                {org.slug}
                <div className="text-muted-foreground">{org.code}</div>
              </td>
              <td className="py-2 pr-3">{ORG_TYPE_LABEL[org.type] || org.type}</td>
              <td className="py-2 pr-3">
                <Badge variant={STATUS_VARIANT[org.status] || 'secondary'}>
                  {org.status}
                </Badge>
              </td>
              <td className="py-2 pr-3 text-xs">{org.isolationTier}</td>
              <td className="py-2 pr-3 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAddUser(org)}
                  disabled={org.status !== 'ACTIVE'}
                  aria-label={`เพิ่มผู้ใช้ใน ${org.name}`}
                >
                  <UserPlus className="mr-1 h-4 w-4" aria-hidden="true" />
                  เพิ่มผู้ใช้
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
