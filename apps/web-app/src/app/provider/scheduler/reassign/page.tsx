'use client';


import { useState, useEffect } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/primitives/table';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { IconCalendar, IconSwitchHorizontal, IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { notifications } from '@/lib/notifications';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../../components/provider-layout';

interface Application {
  id: string;
  applicationNumber: string;
  applicantName: string;
  plantType: string;
  status: string;
  currentAuditor?: string;
  currentAuditorId?: string;
  scheduledDate?: string;
  daysOverdue?: number;
}

/**
 * V2-C SC-3: renamed from `interface provider` (lower-case `p`) to match
 * the project TitleCase convention every other interface uses. The
 * underlying provider-directory row shape is unchanged — only the type
 * identifier moves.
 */
interface ProviderUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  workload?: number;
}

export default function ReassignmentPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [auditors, setAuditors] = useState<ProviderUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [newAuditorId, setNewAuditorId] = useState<string>('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      const [appsResponse, auditorsResponse] = await Promise.all([
        // P0-C: the reassign router is mounted at /audits/reassign
        // (routes/api/index.js: auditConsolidated.use('/reassign', …);
        // audits-reassign.js GET /reassignable). The old path missing the
        // /reassign segment fell into audits.js GET /:id → 404 → this page
        // permanently error-toasted, killing the scheduler's only swap tool.
        apiClient.get<{ applications: Application[] }>('/audits/reassign/reassignable'),
        // Wave B Phase 57 (hotfix) — provider directory is mounted at
        // /api/provider/directory in apps/backend/routes/api/index.js
        // (line 89). The bare /api/provider path is unmounted, so the
        // previous '/provider?role=...' silently 404'd and this page
        // showed an empty auditor dropdown.
        // M2: this page reassigns AUDITS, so it must list AUDITORs.
        // The old reviewer-alias filter canonicalises to document_reviewer
        // (canonical-rbac) and matchesRoleFilter does exact canonical
        // equality — AUDITOR-role staff never appeared in the picker.
        apiClient.get<ProviderUser[] | { provider: ProviderUser[] }>('/provider/directory?role=AUDITOR'),
      ]);

      if (!appsResponse.success || !auditorsResponse.success) throw new Error('Failed to fetch');

      setApplications((appsResponse.data as { applications?: Application[] })?.applications || []);
      const providerPayload = Array.isArray(auditorsResponse.data)
        ? auditorsResponse.data
        : ((auditorsResponse.data as { provider?: ProviderUser[] })?.provider || []);
      setAuditors(providerPayload);
    } catch (_error) {
      notifications.show({
        title: 'เกิดข้อผิดพลาด',
        message: 'ไม่สามารถโหลดข้อมูลได้',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReassign = async () => {
    if (!selectedApp || !newAuditorId) return;

    try {
      setReassigning(true);
      // P0-C: POST lives under the same /audits/reassign mount (see fetchData).
      const response = await apiClient.post(`/audits/reassign/${selectedApp.id}/reassign`, {
        newAuditorId,
        reason,
      });

      if (!response.success) throw new Error('Failed to reassign');

      notifications.show({
        title: 'สำเร็จ',
        message: 'มอบหมายงานใหม่เรียบร้อยแล้ว',
        color: 'green',
        icon: <IconCheck size={16} />,
      });

      setModalOpen(false);
      setSelectedApp(null);
      setNewAuditorId('');
      setReason('');
      fetchData();
    } catch (_error) {
      notifications.show({
        title: 'เกิดข้อผิดพลาด',
        message: 'ไม่สามารถมอบหมายงานได้',
        color: 'red',
      });
    } finally {
      setReassigning(false);
    }
  };

  const openReassignModal = (app: Application) => {
    setSelectedApp(app);
    setModalOpen(true);
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'AUDIT_CONFIRMED': 'blue',
      'CAR_REVIEWING': 'yellow',
      'OVERDUE': 'red',
      'CAR_PENDING': 'orange',
    };
    return colors[status] || 'gray';
  };

  const auditorOptions = auditors.map(auditor => ({
    value: auditor.id,
    label: `${auditor.firstName} ${auditor.lastName} ${auditor.workload ? `(งาน: ${auditor.workload})` : ''}`,
  }));

  return (
    // X2-FIX-B / H-9: Wrap in ProviderLayout so schedulers keep the
    // global sidebar + role-aware navigation. Previously rendered a
    // bare `<div>` shell with no sidebar/header — schedulers landing
    // on the reassignment page lost all global nav.
    //
    // V2-C SC-2 preserved — the inner wrapper retains `max-w-7xl`
    // (wider than DashboardLayout's `max-w-6xl` default) so the
    // 7-column reassignment table can still breathe. The existing
    // SC-2 regression test asserts on `.max-w-7xl` AND `.max-w-sm == 0`.
    <ProviderLayout title="มอบหมายงานใหม่" subtitle="Re-assignment">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            <IconSwitchHorizontal size={32} style={{ verticalAlign: 'middle', marginRight: 8 }} aria-hidden="true" focusable="false" />
            มอบหมายงานใหม่ (Re-assignment)
          </h2>
          <p className="text-sm text-muted-foreground">
            จัดการมอบหมายงานตรวจประเมินให้ผู้ตรวจประเมินคนใหม่
          </p>
        </div>
        <Button onClick={fetchData} loading={loading}>
          รีเฟรช
        </Button>
      </div>

      {loading && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm"
        >
          กำลังโหลดข้อมูล…
        </div>
      )}

      {applications.length === 0 && !loading && (
        <Alert icon={<IconAlertCircle size={16} />} title="ไม่มีรายการ" color="blue">
          ไม่มีงานที่ต้องมอบหมายใหม่ในขณะนี้
        </Alert>
      )}

      {/* V2-C SC-2 — the dead `bg-white/50` overlay was removed; the
          parent never had `relative` set so the overlay was layered on
          top of the visible table without visual purpose. */}
      {applications.length > 0 && !loading && (
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เลขที่คำขอ</TableHead>
              <TableHead>ชื่อเกษตรกร</TableHead>
              <TableHead>พืช</TableHead>
              <TableHead>ผู้ตรวจปัจจุบัน</TableHead>
              <TableHead>วันนัดหมาย</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead>การดำเนินการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {applications.map((app) => (
              <TableRow key={app.id}>
                <TableCell>
                  <p className="font-medium">{app.applicationNumber}</p>
                </TableCell>
                <TableCell>{app.applicantName || '-'}</TableCell>
                <TableCell>{app.plantType || '-'}</TableCell>
                <TableCell>
                  <p className="text-sm">{app.currentAuditor || 'ยังไม่มอบหมาย'}</p>
                </TableCell>
                <TableCell>
                  {app.scheduledDate ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <IconCalendar size={14} aria-hidden="true" focusable="false" />
                      <p className="text-sm">
                        {new Date(app.scheduledDate).toLocaleDateString('th-TH', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>
                  <Badge color={getStatusColor(app.status)}>
                    {app.status}
                    {app.daysOverdue && app.daysOverdue > 0 && (
                      <> (เกิน {app.daysOverdue} วัน)</>
                    )}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    onClick={() => openReassignModal(app)}
                  >
                    มอบหมายใหม่
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>มอบหมายงานใหม่</DialogTitle></DialogHeader>

          <div className="flex flex-col gap-4">
            <Alert icon={<IconAlertCircle size={16} />} color="blue">
              <p className="text-sm font-medium">
                คำขอ: {selectedApp?.applicationNumber}
              </p>
              <p className="text-sm">
                ผู้ตรวจปัจจุบัน: {selectedApp?.currentAuditor || 'ยังไม่มอบหมาย'}
              </p>
            </Alert>

            <Select
              label="เลือกผู้ตรวจประเมินคนใหม่"
              placeholder="เลือกผู้ตรวจประเมิน"
              value={newAuditorId}
              onChange={(value) => setNewAuditorId(value || '')}
              data={auditorOptions}

              required
            />

            <Textarea
              label="เหตุผลในการมอบหมายใหม่"
              placeholder="ระบุเหตุผล เช่น งานล่าช้า, ผู้ตรวจไม่ว่าง, ฯลฯ"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              rows={3}
              required
            />

            <Alert icon={<IconAlertCircle size={16} />} color="yellow" title="หมายเหตุ">
              <p className="text-sm">
                การมอบหมายใหม่จะส่งการแจ้งเตือนไปยังผู้ตรวจประเมินคนใหม่และเกษตรกร
              </p>
            </Alert>

            <div className="mt-4 flex flex-wrap items-center">
              <Button variant="default" onClick={() => setModalOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                onClick={handleReassign}
                loading={reassigning}
                disabled={!newAuditorId || !reason}
              >
                ยืนยันการมอบหมาย
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </ProviderLayout>
  );
}
