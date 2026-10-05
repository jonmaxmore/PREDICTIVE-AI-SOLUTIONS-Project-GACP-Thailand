'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  DollarSign,
  RefreshCcw,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/api-client';
import { getStatusLabel } from '@/lib/constants/workflow-states';
import { SummaryHeader } from '@/components/feature';

interface AdminDashboardData {
  kpi: {
    total: number;
    certified: number;
    inReview: number;
    auditPhase: number;
    unassigned: number;
    pendingPayment: number;
    newToday: number;
    slaBreach: number;
  };
  revenue: {
    last30Days: number;
    today: number;
  };
  auditors: {
    id: string;
    name: string;
    role: string;
    active: number;
    capacity: number;
    utilization: number;
    availability: 'AVAILABLE' | 'BUSY' | 'FULL';
  }[];
  timeline: {
    id: string;
    applicationNumber: string;
    status: string;
    applicantName: string;
    updatedAt: string | null;
  }[];
  statusBreakdown: Record<string, number>;
}

// Alias for non-canonical states only; canonical labels come from workflow-states.ts
const _EXTRA_LABELS: Record<string, string> = {
  REGISTERED: 'ลงทะเบียน',
};

function resolveStatusLabel(status: string): string {
  return _EXTRA_LABELS[status] || getStatusLabel(status);
}

function formatCurrency(value: number): string {
  return value.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<AdminDashboardData>('/provider/admin/dashboard');
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.error || 'ไม่สามารถโหลดข้อมูลได้');
      }
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const kpi = data?.kpi;
  const revenue = data?.revenue;

  const statusEntries = useMemo(() => {
    if (!data?.statusBreakdown) return [];
    return Object.entries(data.statusBreakdown)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a);
  }, [data?.statusBreakdown]);

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    // Wave E.2-B (batch 8): SummaryHeader replaces inline h2+p+refresh.
    // The headline KPIs (total / certified / SLA breach) move into
    // SummaryHeader.metrics so the chrome already conveys the
    // dashboard's punchline before the user scrolls.
    <div className="animate-fade-in space-y-6">
      {/* X5-FIX-B H-11: gov-gradient brand cue — ADMIN was 0% covered
          per X5-A/X5-B audit; mirror the X3-FIX-B + X4-FIX-B contract. */}
      <SummaryHeader
        eyebrow="ผู้ให้บริการ · ภาพรวมระบบ"
        title="ภาพรวมการบริหารระบบ"
        description="แดชบอร์ดหลักผู้ดูแลระบบ ข้อมูลเรียลไทม์จากทุกส่วนงาน"
        {...(kpi
          ? {
              metrics: [
                { label: 'คำขอทั้งหมด', value: kpi.total.toLocaleString('th-TH'), icon: '📋' },
                { label: 'ออกใบรับรองแล้ว', value: kpi.certified.toLocaleString('th-TH'), icon: '✅' },
                { label: 'อยู่ระหว่างตรวจ', value: (kpi.inReview + kpi.auditPhase).toLocaleString('th-TH'), icon: '🔎' },
                { label: 'SLA เกินกำหนด', value: kpi.slaBreach.toLocaleString('th-TH'), icon: '⚠️' },
              ],
            }
          : {})}
        actions={
          <Button variant="outline" size="sm" className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-offset-2" onClick={load}>
            <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" /> รีเฟรช
          </Button>
        }
        className="gov-gradient border-none shadow-xl shadow-primary/20"
      />

      {error && (
        <Card className="rounded-2xl border-destructive/30 bg-destructive/5" role="alert" aria-live="polite">
          <CardContent className="flex items-center gap-3 p-4 text-sm font-bold text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            {error}
          </CardContent>
        </Card>
      )}

      {kpi && (
        <>
          {/* Headline KPIs (total / certified / inReview+audit / SLA breach)
              now ride in the SummaryHeader above — no duplicate KpiCard row. */}

          {/* Queue Status Row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <QueueCard label="ยังไม่ได้มอบหมาย" value={kpi.unassigned} tone="warning" href="/provider/coordinator" />
            <QueueCard label="ตรวจเอกสาร" value={kpi.inReview} tone="info" href="/provider/applications" />
            <QueueCard label="ขั้นตรวจแปลง" value={kpi.auditPhase} tone="primary" href="/provider/audits" />
            <QueueCard label="รอชำระเงิน" value={kpi.pendingPayment} tone="neutral" href="/provider/accounting" />
            <QueueCard label="ใหม่วันนี้" value={kpi.newToday} tone="success" />
          </div>

          {/* Revenue Row */}
          {revenue && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card className="rounded-2xl border-border bg-leaf-soft shadow-sm dark:bg-primary-900/20">
                <CardContent className="flex items-center gap-4 p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-leaf-soft text-leaf-onSoft dark:bg-primary-900/30">
                    <DollarSign className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-leaf-700">รายได้ 30 วัน</p>
                    <p className="whitespace-nowrap text-2xl font-bold text-leaf-700">฿{formatCurrency(revenue.last30Days)}</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-border bg-blue-50 shadow-sm dark:bg-blue-950/20">
                <CardContent className="flex items-center gap-4 p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-900/30">
                    <TrendingUp className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-blue-700">รายได้วันนี้</p>
                    <p className="whitespace-nowrap text-2xl font-bold text-blue-700">฿{formatCurrency(revenue.today)}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Main Grid: Workload + Timeline + Status */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Auditor Workload */}
        <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm lg:col-span-1">
          <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
              <Users className="h-4 w-4 text-primary" aria-hidden="true" />
              ภาระงานผู้ตรวจ
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {data?.auditors && data.auditors.length > 0 ? (
              <div className="space-y-4">
                {data.auditors.map((a) => {
                  const barColor = a.availability === 'FULL' ? 'bg-red-500' : a.availability === 'BUSY' ? 'bg-amber-500' : 'bg-leaf-600';
                  return (
                    <div key={a.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-foreground">{a.name}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{a.active}/{a.capacity}</span>
                          <Badge
                            variant={a.availability === 'FULL' ? 'destructive' : a.availability === 'BUSY' ? 'secondary' : 'outline'}
                            className="rounded-md text-[10px]"
                          >
                            {a.availability === 'FULL' ? 'เต็ม' : a.availability === 'BUSY' ? 'ยุ่ง' : 'ว่าง'}
                          </Badge>
                        </div>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${a.utilization}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">ไม่พบข้อมูลผู้ตรวจ</p>
            )}
          </CardContent>
        </Card>

        {/* Activity Timeline */}
        <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm lg:col-span-1">
          <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
              <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
              กิจกรรมล่าสุด
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {data?.timeline && data.timeline.length > 0 ? (
              <div className="relative space-y-5 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-border">
                {data.timeline.slice(0, 10).map((item) => (
                  <Link
                    key={item.id}
                    href={`/provider/applications/${item.id}`}
                    className="relative block pl-8 transition-opacity hover:opacity-80"
                  >
                    <div className="absolute left-0 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-card shadow-sm">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                    <p className="text-sm font-bold leading-tight text-foreground">{item.applicationNumber}</p>
                    <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                      {resolveStatusLabel(item.status)} • {item.applicantName}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">{formatDateTime(item.updatedAt)}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">ไม่มีกิจกรรมล่าสุด</p>
            )}
          </CardContent>
        </Card>

        {/* Status Breakdown */}
        <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm lg:col-span-1">
          <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
              <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
              สถานะคำขอ
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {statusEntries.length > 0 ? (
              <div className="space-y-3">
                {statusEntries.map(([status, count]) => {
                  const total = kpi?.total || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={status} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground">{resolveStatusLabel(status)}</span>
                        <span className="text-xs font-bold text-muted-foreground">{count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            status === 'CERTIFIED' ? 'bg-leaf-600' :
                            status === 'CANCEL_EXPIRED' ? 'bg-red-500' :
                            status.includes('PENDING') ? 'bg-amber-500' :
                            'bg-primary'
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">ไม่มีข้อมูล</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="rounded-2xl border-border bg-card shadow-sm">
        <CardHeader className="px-6 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
            <Shield className="h-4 w-4 text-primary" aria-hidden="true" />
            เครื่องมือบริหาร
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 px-6 pb-6">
          <Button asChild variant="outline" className="rounded-xl font-bold">
            <Link href="/provider/coordinator">ศูนย์จัดสรรงาน</Link>
          </Button>
          {/* /admin/users is a legacy redirect to /provider/management; link
              directly to avoid the bounce and match the other /provider/* Quick
              Actions on this page. */}
          <Button asChild variant="outline" className="rounded-xl font-bold">
            <Link href="/provider/management">จัดการผู้ใช้</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-xl font-bold">
            <Link href="/provider/applications">รายการคำขอทั้งหมด</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-xl font-bold">
            <Link href="/provider/certificates">ใบรับรอง</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-xl font-bold">
            <Link href="/provider/accounting">ระบบบัญชี</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-xl font-bold">
            <Link href="/provider/analytics">รายงาน</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-xl font-bold">
            <Link href="/admin/planting">ตรวจสอบย้อนกลับฟาร์ม</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}


function QueueCard({ label, value, tone, href }: {
  label: string;
  value: number;
  tone: 'primary' | 'warning' | 'info' | 'success' | 'neutral';
  href?: string;
}) {
  const toneClasses = {
    primary: 'border-primary/20 bg-primary/5 text-primary',
    warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/20',
    info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/30 dark:bg-blue-950/20',
    success: 'border-leaf-300 bg-leaf-soft text-leaf-onSoft dark:border-primary-900/30 dark:bg-primary-900/20',
    neutral: 'border-border bg-muted/20 text-muted-foreground',
  };
  const content = (
    <div className={cn('flex min-h-[88px] flex-col items-center rounded-2xl border p-4 text-center transition-all', toneClasses[tone], href && 'cursor-pointer hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2')}>
      <p className="text-3xl font-black">{value.toLocaleString('th-TH')}</p>
      <p className="mt-1 whitespace-normal text-[10px] font-black opacity-80">{label}</p>
    </div>
  );
  return href ? (
    <Link href={href} aria-label={`${label}: ${value.toLocaleString('th-TH')}`} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
      {content}
    </Link>
  ) : content;
}
