'use client';

/**
 * Scheduler: Reassign Document Reviewer.
 *
 * The reviewer-side mirror of /provider/scheduler/reassign (which is the AUDITOR
 * reassign tool). Lists applications whose document review is in flight
 * (ASSIGNED_FOR_REVIEW or REVISION_REQUESTED — the reviewerId is the active
 * binding through both) and lets a scheduler/admin swap the assigned reviewer.
 * This is the FE surface for the reviewer-reassign endpoints that previously had
 * no UI (audit follow-up: close the REVISION_REQUESTED dead spot end-to-end).
 */

import { useState, useEffect, useCallback } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/primitives/table';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { IconSwitchHorizontal, IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { notifications } from '@/lib/notifications';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../../components/provider-layout';

interface Application {
  id: string;
  applicationNumber: string;
  applicantName: string;
  plantType: string;
  status: string;
  currentReviewer?: string;
  currentReviewerId?: string;
  updatedAt?: string;
}

interface ProviderUser {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  role: string;
}

export default function ReviewerReassignmentPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [reviewers, setReviewers] = useState<ProviderUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [newReviewerId, setNewReviewerId] = useState<string>('');
  const [reason, setReason] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [appsRes, reviewersRes] = await Promise.all([
        apiClient.get<{ applications: Application[] }>('/provider/scheduler/reviewer-assignments/reassignable'),
        apiClient.get<ProviderUser[]>('/provider/scheduler/reviewers'),
      ]);
      // apiClient strips the envelope to body.data — read nested fields from data.
      setApplications(appsRes.success ? (appsRes.data?.applications || []) : []);
      setReviewers(reviewersRes.success && Array.isArray(reviewersRes.data) ? reviewersRes.data : []);
    } catch {
      notifications.show({ title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถโหลดข้อมูลได้', color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleReassign = async () => {
    if (!selectedApp || !newReviewerId || !reason) return;
    try {
      setReassigning(true);
      const res = await apiClient.post(`/provider/scheduler/reviewer-assignments/${selectedApp.id}/reassign`, {
        newReviewerId,
        reason,
      });
      if (!res.success) throw new Error('failed');
      notifications.show({ title: 'สำเร็จ', message: 'มอบหมายผู้ตรวจเอกสารใหม่เรียบร้อยแล้ว', color: 'green', icon: <IconCheck size={16} /> });
      setModalOpen(false);
      setSelectedApp(null);
      setNewReviewerId('');
      setReason('');
      fetchData();
    } catch {
      notifications.show({ title: 'เกิดข้อผิดพลาด', message: 'ไม่สามารถมอบหมายใหม่ได้', color: 'red' });
    } finally {
      setReassigning(false);
    }
  };

  const reviewerOptions = reviewers.map((r) => ({
    value: r.id,
    label: r.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.id.slice(0, 8),
  }));

  const statusColor = (s: string) => (s === 'REVISION_REQUESTED' ? 'orange' : 'blue');

  return (
    <ProviderLayout title="มอบหมายผู้ตรวจเอกสารใหม่" subtitle="Reviewer Re-assignment">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              <IconSwitchHorizontal size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} aria-hidden="true" focusable="false" />
              มอบหมายผู้ตรวจเอกสารใหม่
            </h2>
            <p className="text-sm text-muted-foreground">
              สลับผู้ตรวจเอกสารของคำขอที่อยู่ระหว่างตรวจ (รวมช่วงขอแก้ไขเอกสาร REVISION_REQUESTED)
            </p>
          </div>
          <Button onClick={fetchData} loading={loading}>รีเฟรช</Button>
        </div>

        {loading && (
          <div role="status" aria-live="polite" className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
            กำลังโหลดข้อมูล…
          </div>
        )}

        {!loading && applications.length === 0 && (
          <Alert icon={<IconAlertCircle size={16} />} title="ไม่มีรายการ" color="blue">
            ไม่มีคำขอที่ต้องมอบหมายผู้ตรวจเอกสารใหม่ในขณะนี้
          </Alert>
        )}

        {!loading && applications.length > 0 && (
          <div className="rounded-lg bg-card p-4 shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เลขที่คำขอ</TableHead>
                  <TableHead>ชื่อเกษตรกร</TableHead>
                  <TableHead>พืช</TableHead>
                  <TableHead>ผู้ตรวจปัจจุบัน</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead>การดำเนินการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell><p className="font-medium">{app.applicationNumber}</p></TableCell>
                    <TableCell>{app.applicantName || '-'}</TableCell>
                    <TableCell>{app.plantType || '-'}</TableCell>
                    <TableCell><p className="text-sm">{app.currentReviewer || 'ยังไม่มอบหมาย'}</p></TableCell>
                    <TableCell><Badge color={statusColor(app.status)}>{app.status}</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => { setSelectedApp(app); setModalOpen(true); }}>มอบหมายใหม่</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>มอบหมายผู้ตรวจเอกสารใหม่</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-4">
              <Alert icon={<IconAlertCircle size={16} />} color="blue">
                <p className="text-sm font-medium">คำขอ: {selectedApp?.applicationNumber}</p>
                <p className="text-sm">ผู้ตรวจปัจจุบัน: {selectedApp?.currentReviewer || 'ยังไม่มอบหมาย'}</p>
              </Alert>
              <Select
                label="เลือกผู้ตรวจเอกสารคนใหม่"
                placeholder="เลือกผู้ตรวจเอกสาร"
                value={newReviewerId}
                onChange={(value) => setNewReviewerId(value || '')}
                data={reviewerOptions}
                required
              />
              <Textarea
                label="เหตุผลในการมอบหมายใหม่"
                placeholder="ระบุเหตุผล เช่น ผู้ตรวจไม่ว่าง, งานล่าช้า, ฯลฯ"
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
                rows={3}
                required
              />
              <Alert icon={<IconAlertCircle size={16} />} color="yellow" title="หมายเหตุ">
                <p className="text-sm">การมอบหมายใหม่จะส่งการแจ้งเตือนไปยังผู้ตรวจคนใหม่ ผู้ตรวจเดิม และเกษตรกร</p>
              </Alert>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="default" onClick={() => setModalOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleReassign} loading={reassigning} disabled={!newReviewerId || !reason}>
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
