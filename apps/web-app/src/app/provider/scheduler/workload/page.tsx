'use client';

/**
 * Scheduler workload / work-distribution view (Phase 1C, frontend).
 *
 * Reads the work-distribution ledger query API (/provider/ledger/*) to show how
 * work has been DISTRIBUTED across staff — so a scheduler can spot lopsided
 * assignment and an uneven round-robin.
 *
 * HONEST METRIC (do not relabel): the per-person count is `assignmentsGiven`
 * over the selected window = THROUGHPUT (work that was HANDED to this person),
 * NOT their current open load. The backend tags the payload metric
 * 'assignments_given'; the column is labelled accordingly and a note makes the
 * semantics explicit. "Current open load" would need live work/application
 * state and is intentionally not shown here.
 */

import { useState, useEffect, useCallback } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/primitives/table';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { IconUsers, IconArrowsShuffle, IconAlertCircle, IconChartBar } from '@tabler/icons-react';
import { notifications } from '@/lib/notifications';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../../components/provider-layout';

interface FairnessRow {
  assigneeUserId: string;
  assigneeName: string | null;
  role: string | null;
  assignmentsGivenInWindow: number;
}

interface FairnessData {
  metric: string;
  people: number;
  totalAssignments: number;
  rows: FairnessRow[];
  window?: { days: number };
}

interface ReassignEvent {
  id: string;
  createdAt: string;
  assigneeName: string | null;
  previousAssigneeName: string | null;
  assignedByName: string | null;
  reason: string | null;
  source: string | null;
}

const WINDOW_OPTIONS = [
  { value: '7', label: '7 วัน' },
  { value: '30', label: '30 วัน' },
  { value: '90', label: '90 วัน' },
];

export default function SchedulerWorkloadPage() {
  const [fairness, setFairness] = useState<FairnessData | null>(null);
  const [reassignments, setReassignments] = useState<ReassignEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('30');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [fairnessRes, reassignRes] = await Promise.all([
        apiClient.get<FairnessData>(`/provider/ledger/fairness?days=${days}`),
        apiClient.get<{ events: ReassignEvent[] }>(`/provider/ledger/reassignments?days=${days}`),
      ]);

      // apiClient strips the envelope to body.data — everything the backend
      // returns is nested under `data`, so read it all from res.data.
      if (fairnessRes.success && fairnessRes.data) {
        setFairness(fairnessRes.data);
      } else {
        setFairness(null);
      }
      setReassignments(
        reassignRes.success && Array.isArray(reassignRes.data?.events)
          ? reassignRes.data.events
          : [],
      );
    } catch (_error) {
      notifications.show({
        title: 'เกิดข้อผิดพลาด',
        message: 'ไม่สามารถโหลดข้อมูลการกระจายงานได้',
        color: 'red',
      });
      setFairness(null);
      setReassignments([]);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const rows = fairness?.rows || [];
  const maxGiven = rows.reduce((m, r) => Math.max(m, r.assignmentsGivenInWindow), 0);

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    // Mirror the sibling scheduler/reassign page: ProviderLayout shell + an
    // inner max-w-7xl wrapper so the distribution table can breathe.
    <ProviderLayout title="ภาระงาน & การกระจายงาน" subtitle="Work Distribution">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              <IconChartBar size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} aria-hidden="true" focusable="false" />
              การกระจายงาน (Work Distribution)
            </h2>
            <p className="text-sm text-muted-foreground">
              ดูว่างานถูกมอบหมายให้เจ้าหน้าที่แต่ละคนมากน้อยเพียงใดในช่วงเวลาที่เลือก
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              label="ช่วงเวลา"
              value={days}
              onChange={(value) => setDays(value || '30')}
              data={WINDOW_OPTIONS}
            />
            <Button onClick={fetchData} loading={loading}>รีเฟรช</Button>
          </div>
        </div>

        {/* Honest-metric note: this is throughput, not current open load. */}
        <Alert icon={<IconAlertCircle size={16} />} color="blue" title="ความหมายของตัวเลข">
          <p className="text-sm">
            ตัวเลขคือ <strong>จำนวนงานที่ถูกมอบหมาย</strong> (ASSIGN/REASSIGN) ให้แต่ละคน
            ในช่วง {days} วันที่ผ่านมา ใช้ดูความสม่ำเสมอของการกระจายงาน
            <strong> ไม่ใช่จำนวนงานค้างปัจจุบัน</strong>
          </p>
        </Alert>

        {loading && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm"
          >
            กำลังโหลดข้อมูล…
          </div>
        )}

        {!loading && (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-card p-4 shadow-sm">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <IconUsers size={16} aria-hidden="true" focusable="false" /> เจ้าหน้าที่ที่ได้รับมอบหมาย
                </p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{fairness?.people ?? 0}</p>
              </div>
              <div className="rounded-lg bg-card p-4 shadow-sm">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <IconChartBar size={16} aria-hidden="true" focusable="false" /> งานที่มอบหมายรวม (ใน {days} วัน)
                </p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{fairness?.totalAssignments ?? 0}</p>
              </div>
            </div>

            {rows.length === 0 ? (
              <Alert className="mt-4" icon={<IconAlertCircle size={16} />} title="ไม่มีข้อมูล" color="blue">
                ยังไม่มีการมอบหมายงานในช่วงเวลานี้
              </Alert>
            ) : (
              <div className="mt-4 rounded-lg bg-card p-4 shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เจ้าหน้าที่</TableHead>
                      <TableHead>บทบาท</TableHead>
                      <TableHead>งานที่ได้รับมอบหมาย (ใน {days} วัน)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.assigneeUserId}>
                        <TableCell>
                          <p className="font-medium">{r.assigneeName || r.assigneeUserId.slice(0, 8)}</p>
                        </TableCell>
                        <TableCell>
                          {r.role ? <Badge color="gray">{r.role}</Badge> : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{r.assignmentsGivenInWindow}</span>
                            <span
                              aria-hidden="true"
                              className="inline-block h-2 rounded bg-leaf-600"
                              style={{ width: `${maxGiven > 0 ? Math.round((r.assignmentsGivenInWindow / maxGiven) * 96) : 0}px` }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="mt-6">
              <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-foreground">
                <IconArrowsShuffle size={20} aria-hidden="true" focusable="false" /> การมอบหมายใหม่ล่าสุด (Reassignments)
              </h3>
              {reassignments.length === 0 ? (
                <Alert icon={<IconAlertCircle size={16} />} title="ไม่มีรายการ" color="blue">
                  ไม่มีการมอบหมายงานใหม่ในช่วงเวลานี้
                </Alert>
              ) : (
                <div className="rounded-lg bg-card p-4 shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>วันที่</TableHead>
                        <TableHead>จาก</TableHead>
                        <TableHead>เป็น</TableHead>
                        <TableHead>โดย</TableHead>
                        <TableHead>เหตุผล</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reassignments.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell><span className="text-sm">{fmtDate(e.createdAt)}</span></TableCell>
                          <TableCell><span className="text-sm">{e.previousAssigneeName || '-'}</span></TableCell>
                          <TableCell><span className="text-sm font-medium">{e.assigneeName || '-'}</span></TableCell>
                          <TableCell><span className="text-sm">{e.assignedByName || '-'}</span></TableCell>
                          <TableCell><span className="text-sm text-muted-foreground">{e.reason || '-'}</span></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ProviderLayout>
  );
}
