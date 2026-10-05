'use client';

/**
 * ชั้นพนักงานติดตาม — รายการรอบการปลูกของฟาร์มทุกแห่งทั่วประเทศ
 *
 * มติ operator 2026-09-05 (docs/design/2026-09-05-tnt-loop-and-farmer-updates.md §3.3):
 * *"เห็นข้อมูลทั้งหมด"* + *"ฟาร์มทุกประเทศ"* ⇒ จอนี้ไม่มีตัวกรอง "เฉพาะงานที่ได้รับมอบหมาย"
 * และจะไม่มี ตัวกรองแบบนั้นคือสิ่งที่มติยกเลิกไปแล้ว ไม่ใช่ของที่ยังไม่ได้ทำ
 *
 * สิ่งที่จอนี้ไม่แสดงโดยตั้งใจ: ใบแจ้งหนี้ ค่าธรรมเนียม ใบเสนอราคา และลิงก์ไปหน้าการเงิน
 * ตารางของมติเขียนว่าเรื่องเงิน "คนละหน้าที่ ไม่ได้อยู่ในคำว่าติดตาม" · payload ของ
 * ประตูหลังบ้านก็ไม่มีตัวเลขการเงินให้อ่านอยู่แล้ว การไปดึงมาจากที่อื่นจึงเป็นการฝืนมติ
 *
 * PDPA ม.39 ข้อ 3 ของมติ: หลังบ้านบันทึกทุกการเปิดดู (services/farm-access-audit.js)
 * และ *หน้าจอต้องบอกให้พนักงานรู้ตัว* ซึ่งคือ <FarmAccessNotice /> ด้านล่าง
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, RefreshCcw, Search, Sprout } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/feature/empty-state';
import { FarmAccessNotice } from '@/components/feature/farm-access-notice';
import { Spinner } from '@/components/ui/spinner';
import { formatThaiDate } from '@/lib/format/thai-date';
import { CYCLE_STATUS_CODES, formatCultivationMethods, formatCycleStatus } from '@/lib/planting-labels';
import {
  providerTrackingApi,
  type TrackingCycleListItem,
  type TrackingPagination,
} from '@/lib/services/provider-api';

import ProviderLayout from '../components/provider-layout';

const PAGE_SIZE = 25;

/** ป้ายไทยของตัวกรองสถานะ ค่าดิบยังเป็น enum เดิมที่ประตูหลังบ้านรับ */
const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'ทุกสถานะ' },
  ...CYCLE_STATUS_CODES.map((code) => ({ value: code, label: formatCycleStatus(code).label })),
];

export default function ProviderTrackingListView() {
  const [items, setItems] = useState<TrackingCycleListItem[]>([]);
  const [pagination, setPagination] = useState<TrackingPagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // `error` ไม่ใช่แค่ข้อความ แต่เป็นสถานะของจอ: เมื่อมีค่า ตารางจะไม่ถูกวาดเลย
  // ตารางว่างบนการอ่านที่ล้ม อ่านได้ว่า "ไม่มีฟาร์มในประเทศนี้" ซึ่งเป็นคำตอบที่ผิด
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      const result = await providerTrackingApi.listCycles({
        page,
        limit: PAGE_SIZE,
        status: status || null,
        q: debouncedSearch || null,
      });
      if (!active) {
        return;
      }
      if (!result.ok) {
        setError(result.error);
        setItems([]);
        setPagination(null);
      } else {
        setError(null);
        setItems(result.data);
        setPagination(result.pagination);
      }
      setIsLoading(false);
    };

    void load();

    return () => {
      active = false;
    };
  }, [debouncedSearch, status, page, reloadToken]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const totalLabel = useMemo(() => {
    if (!pagination) {
      return `${items.length.toLocaleString('th-TH')} รายการ`;
    }
    return `${pagination.total.toLocaleString('th-TH')} รายการ`;
  }, [pagination, items.length]);

  const showFirstLoad = isLoading && items.length === 0 && !error;

  return (
    <ProviderLayout
      title="ติดตามการปลูก"
      subtitle="รอบการปลูกและแปลงของฟาร์มทุกแห่งทั่วประเทศ"
    >
      <div className="animate-fade-in space-y-4">
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-xs text-muted-foreground">การติดตามและตรวจสอบย้อนกลับ</p>
            <h2 className="mt-0.5 text-xl font-semibold text-foreground">รอบการปลูกทั่วประเทศ</h2>
            <p
              className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground"
              data-testid="tracking-scope-note"
            >
              หน้านี้แสดงรอบการปลูกของฟาร์มทุกแห่งทั่วประเทศ ไม่จำกัดเฉพาะงานที่คุณได้รับมอบหมาย
              ค้นหาได้จากชื่อรอบปลูกหรือชื่อฟาร์ม และกรองตามสถานะรอบปลูก
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-3 px-4 py-3">
            <div className="min-w-[8rem]">
              <dt className="text-2xl font-semibold tabular-nums text-foreground">
                {pagination ? pagination.total.toLocaleString('th-TH') : items.length.toLocaleString('th-TH')}
              </dt>
              <dd className="mt-0.5 text-xs text-muted-foreground">รอบการปลูกที่ตรงเงื่อนไข</dd>
            </div>
            <div className="min-w-[8rem]">
              <dt className="text-2xl font-semibold tabular-nums text-foreground">
                {items.reduce((sum, row) => sum + Number(row.plotCount || 0), 0).toLocaleString('th-TH')}
              </dt>
              <dd className="mt-0.5 text-xs text-muted-foreground">แปลงในหน้านี้</dd>
            </div>
          </dl>
        </section>

        {/* PDPA ม.39 ข้อ 3 — พนักงานต้องรู้ว่าการเปิดดูถูกบันทึก ใช้ชิ้นเดียวกับจอ
            อื่นเพื่อไม่ให้ประโยคเพี้ยนกันไปทีละหน้า */}
        <FarmAccessNotice />

        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value || 'all'}
                variant={status === filter.value ? 'default' : 'outline'}
                size="sm"
                className="h-8 min-h-[44px] rounded-md px-3 text-xs font-medium sm:min-h-0"
                onClick={() => setStatus(filter.value)}
                data-testid={`tracking-status-chip-${filter.value || 'all'}`}
              >
                {filter.label}
              </Button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">ทั้งหมด {totalLabel}</div>
        </div>

        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาชื่อรอบปลูก หรือชื่อฟาร์ม"
            aria-label="ค้นหารอบการปลูก"
            data-testid="tracking-search-input"
            className="h-11 min-h-[44px] w-full rounded-lg border border-border bg-card pl-9 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
          />
        </div>

        {showFirstLoad ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 py-6">
            <Spinner size="sm" />
            <p className="text-sm text-muted-foreground">กำลังโหลดรอบการปลูก</p>
          </div>
        ) : error ? (
          // สถานะที่สาม: อ่านไม่สำเร็จ ไม่ใช่ไม่มีข้อมูล จึงไม่วาดตารางเลย
          <Alert color="red" title="อ่านรายการรอบการปลูกไม่สำเร็จ" data-testid="tracking-read-error">
            <div className="flex flex-col items-start gap-3">
              <p>
                {error} ระบบยังไม่ทราบว่ามีรอบการปลูกกี่รายการ หน้านี้จึงไม่แสดงรายการใด ๆ
                กรุณาลองใหม่อีกครั้ง
              </p>
              <Button size="sm" variant="secondary" onClick={retry} leftSection={<RefreshCcw className="h-4 w-4" />}>
                ลองอีกครั้ง
              </Button>
            </div>
          </Alert>
        ) : (
          <>
            <DataTable<TrackingCycleListItem>
              data={items}
              rowKey="id"
              defaultDensity="compact"
              defaultSort={{ key: 'startDate', dir: 'desc' }}
              emptyState={
                <EmptyState
                  icon={Sprout}
                  title="ไม่พบรอบการปลูกที่ตรงกับเงื่อนไข"
                  hint="ลองเปลี่ยนสถานะที่กรองไว้ หรือแก้คำค้นหา ระบบอ่านข้อมูลสำเร็จแล้วแต่ไม่มีรายการที่ตรงกัน"
                />
              }
              columns={[
                {
                  key: 'startDate',
                  header: 'รอบการปลูก',
                  sortable: true,
                  render: (row) => (
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">{row.cycleName || '-'}</span>
                      <span className="text-xs text-muted-foreground">
                        เริ่มปลูก {formatThaiDate(row.startDate)} · กำหนดเก็บเกี่ยว {formatThaiDate(row.expectedHarvestDate)}
                      </span>
                    </div>
                  ),
                  getSortValue: (row) => row.startDate ?? '',
                },
                {
                  key: 'farm',
                  header: 'ฟาร์ม',
                  sortable: true,
                  render: (row) => (
                    <div className="flex flex-col">
                      <span className="text-sm text-foreground">{row.farm?.farmName || '-'}</span>
                      <span className="text-xs text-muted-foreground">
                        {[row.farm?.district, row.farm?.province].filter(Boolean).join(' · ') || 'ไม่ระบุที่ตั้ง'}
                      </span>
                    </div>
                  ),
                  getSortValue: (row) => row.farm?.farmName ?? '',
                },
                {
                  key: 'status',
                  header: 'สถานะ',
                  sortable: true,
                  render: (row) => {
                    const { label, tone } = formatCycleStatus(row.status);
                    return <Badge tone={tone}>{label}</Badge>;
                  },
                  getSortValue: (row) => row.status ?? '',
                },
                {
                  key: 'plotCount',
                  header: 'แปลง',
                  sortable: true,
                  numeric: true,
                  render: (row) => Number(row.plotCount || 0).toLocaleString('th-TH'),
                  getSortValue: (row) => Number(row.plotCount || 0),
                },
                {
                  key: 'cultivationMethods',
                  header: 'วิธีการปลูก',
                  render: (row) => formatCultivationMethods(row.cultivationMethods || []),
                },
                {
                  key: 'totalAreaSqm',
                  header: 'พื้นที่รวม (ตร.ม.)',
                  sortable: true,
                  numeric: true,
                  render: (row) =>
                    Number(row.totalAreaSqm || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }),
                  getSortValue: (row) => Number(row.totalAreaSqm || 0),
                },
                {
                  key: 'counts',
                  header: 'บันทึก / รุ่น / ล็อต',
                  render: (row) => (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {Number(row.counts?.activities || 0).toLocaleString('th-TH')}
                      {' / '}
                      {Number(row.counts?.batches || 0).toLocaleString('th-TH')}
                      {' / '}
                      {Number(row.counts?.lots || 0).toLocaleString('th-TH')}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <Button asChild variant="ghost" size="sm" className="h-8 min-h-[44px] rounded-md px-2 sm:min-h-0">
                      <Link href={`/provider/tracking/${encodeURIComponent(row.id)}`} aria-label={`เปิดรอบการปลูก ${row.cycleName || row.id}`}>
                        <span className="text-xs">รายละเอียด</span>
                        <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                      </Link>
                    </Button>
                  ),
                },
              ]}
            />

            {pagination && pagination.totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  หน้า {pagination.page.toLocaleString('th-TH')} จาก {pagination.totalPages.toLocaleString('th-TH')}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading || pagination.page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    ก่อนหน้า
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading || pagination.page >= pagination.totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    ถัดไป
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ProviderLayout>
  );
}
