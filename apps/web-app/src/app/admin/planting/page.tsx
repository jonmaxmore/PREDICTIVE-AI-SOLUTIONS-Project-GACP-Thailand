'use client';


import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { DataTable } from '@/components/ui/data-table';
import { apiClient } from '@/lib/api/api-client';
import { FarmAccessNotice, SummaryHeader } from '@/components/feature';
import { formatThaiDate } from '@/lib/format/thai-date';
type AdminPlantingItem = {
  id: string;
  cycleName: string;
  status: string;
  startDate: string | null;
  expectedHarvestDate: string | null;
  farm?: {
    id: string;
    farmName?: string | null;
    ownerId?: string | null;
  } | null;
  plotCount: number;
  cultivationMethods: string[];
  totalAreaSqm: number;
  // R8 (design note 2026-08-20-planting-tnt-design) retired
  // per-plant tracking permanently, so this screen no longer reads the
  // plantUnits count the admin API still returns.
  counts?: {
    activities?: number;
    batches?: number;
  };
  integrity?: {
    overPlanCount?: number;
    unassignedCount?: number;
    isLegacyDataIssue?: boolean;
    traceabilityReady?: boolean;
    needsReview?: boolean;
  };
};

const STATUS_COLOR: Record<string, string> = {
  PLANNING: 'gray',
  PLANTED: 'blue',
  GROWING: 'teal',
  READY_HARVEST: 'orange',
  HARVESTED: 'green',
  COMPLETED: 'grape',
};

// Thai display labels for raw cycle-status enum values (display-only map,
// mirrors error-code-map/workflow-states pattern; enum values unchanged).
const STATUS_LABEL: Record<string, string> = {
  PLANNING: 'วางแผน',
  PLANTED: 'ปลูกแล้ว',
  GROWING: 'กำลังเติบโต',
  READY_HARVEST: 'พร้อมเก็บเกี่ยว',
  HARVESTED: 'เก็บเกี่ยวแล้ว',
  COMPLETED: 'เสร็จสิ้น',
};

// adminRequest removed — use apiClient instead (canonical cookie-based auth)

export default function AdminPlantingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AdminPlantingItem[]>([]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      const result = await apiClient.get<AdminPlantingItem[]>('/admin/planting-cycles?page=1&limit=100');
      if (!mounted) {
        return;
      }
      if (!result.success) {
        setError(result.error || 'ไม่สามารถโหลดข้อมูลรอบการปลูกได้');
        setItems([]);
      } else {
        setItems(Array.isArray(result.data) ? result.data : []);
      }
      setLoading(false);
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const metrics = useMemo(() => ({
    totalCycles: items.length,
    totalPlots: items.reduce((sum, row) => sum + Number(row.plotCount || 0), 0),
    totalBatches: items.reduce((sum, row) => sum + Number(row.counts?.batches || 0), 0),
    needsReview: items.filter((row) => Boolean(row.integrity?.needsReview)).length,
  }), [items]);

  return (
    // Wave E.2-B (batch 8): SummaryHeader replaces inline h2+p AND
    // the 5-card metric grid below. SummaryHeader's metrics row
    // wraps 5 items as 4+1 on lg screens (instead of an awkward
    // grid-cols-5) which actually reads cleaner.
    <div className="flex flex-col gap-5">
      {/* X5-FIX-B H-11: gov-gradient brand cue on ADMIN header. */}
      <SummaryHeader
        eyebrow="ผู้ดูแลระบบ · กำกับการปลูก"
        title="กำกับดูแลการปลูกและตรวจสอบย้อนกลับ"
        description="ติดตามข้อมูลรอบการปลูก QR ประจำแปลง และสายโซ่ตรวจสอบย้อนกลับ (อ่านอย่างเดียว)"
        metrics={[
          { label: 'รอบการปลูกทั้งหมด', value: metrics.totalCycles.toLocaleString('th-TH'), icon: '🌱' },
          { label: 'แปลงทั้งหมด', value: metrics.totalPlots.toLocaleString('th-TH'), icon: '🟦' },
          { label: 'ชุดเก็บเกี่ยว', value: metrics.totalBatches.toLocaleString('th-TH'), icon: '📦' },
          { label: 'ต้องตรวจสอบ', value: metrics.needsReview.toLocaleString('th-TH'), icon: '⚠️' },
        ]}
        className="gov-gradient border-none shadow-xl shadow-primary/20"
      />

      {/* T5 / PDPA ม.39 — the officer sees every farm in the country, and knows it is recorded. */}
      <FarmAccessNotice />

      {error && (
        <Alert color="red" title="โหลดข้อมูลไม่สำเร็จ">
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-4 py-6 shadow-sm">
          <Spinner size="sm" />
          <p className="text-sm text-muted-foreground">กำลังโหลดรอบการปลูก...</p>
        </div>
      ) : (
        <DataTable<AdminPlantingItem>
          data={items}
          rowKey="id"
          defaultSort={{ key: 'cycleName', dir: 'asc' }}
          emptyState="ไม่พบรอบการปลูก"
          caption={`รอบการปลูก ${items.length.toLocaleString('th-TH')} รายการ`}
          // Wave E.2-D PR-2 opt-ins: 25 rows/page (matches the
          // existing API limit of 100 → typically ≤ 4 pages) plus
          // URL state sync so admin links land on the right page +
          // sort.
          pageSize={25}
          urlStateKey="planting"
          columns={[
            {
              key: 'cycleName',
              header: 'รอบการปลูก',
              sortable: true,
              render: (row) => (
                <div className="flex flex-col">
                  <p className="font-semibold">{row.cycleName || '-'}</p>
                  <p className="text-xs text-muted-foreground">{formatThaiDate(row.startDate)}</p>
                </div>
              ),
              getSortValue: (row) => row.cycleName ?? '',
            },
            {
              key: 'farm',
              header: 'ฟาร์ม',
              sortable: true,
              render: (row) => row.farm?.farmName || '-',
              getSortValue: (row) => row.farm?.farmName ?? '',
            },
            {
              key: 'owner',
              header: 'เจ้าของ',
              render: (row) => <p className="text-xs">{row.farm?.ownerId || '-'}</p>,
            },
            {
              key: 'status',
              header: 'สถานะ',
              sortable: true,
              render: (row) => (
                <Badge color={STATUS_COLOR[String(row.status || '').toUpperCase()] || 'gray'}>
                  {STATUS_LABEL[String(row.status || '').toUpperCase()] || row.status || '-'}
                </Badge>
              ),
              getSortValue: (row) => row.status ?? '',
            },
            {
              key: 'plotCount',
              header: 'แปลง',
              sortable: true,
              numeric: true,
              render: (row) => Number(row.plotCount || 0).toLocaleString('en-US'),
              getSortValue: (row) => Number(row.plotCount || 0),
            },
            {
              key: 'methods',
              header: 'วิธีการปลูก',
              render: (row) => (row.cultivationMethods || []).join(', ') || '-',
            },
            {
              key: 'totalAreaSqm',
              header: 'พื้นที่ (ตร.ม.)',
              sortable: true,
              numeric: true,
              render: (row) => Number(row.totalAreaSqm || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
              getSortValue: (row) => Number(row.totalAreaSqm || 0),
            },
            {
              key: 'integrity',
              header: 'ความถูกต้องข้อมูล',
              render: (row) =>
                row.integrity?.traceabilityReady ? (
                  <Badge color="teal">พร้อมใช้งาน</Badge>
                ) : (
                  <div className="flex flex-col">
                    <Badge color={row.integrity?.isLegacyDataIssue ? 'yellow' : 'red'}>
                      {row.integrity?.isLegacyDataIssue ? 'ข้อมูลเก่าไม่ตรงกัน' : 'ต้องตรวจสอบ'}
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      เกินแผน {Number(row.integrity?.overPlanCount || 0).toLocaleString('th-TH')} · ยังไม่จัดสรร {Number(row.integrity?.unassignedCount || 0).toLocaleString('th-TH')}
                    </p>
                  </div>
                ),
            },
            {
              key: 'view',
              header: '',
              align: 'right',
              render: (row) => (
                <Button href={`/admin/planting/${encodeURIComponent(row.id)}`} size="sm" variant="secondary">
                  ดูรายละเอียด
                </Button>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
