'use client';

/**
 * องค์ความรู้สมุนไพรรายชนิด (browse) — สัญญา C05F680149 ต้นแบบที่ 5.
 * จัดกลุ่มรายการตามหมวด, โหลดเพิ่มแบบแบ่งหน้า.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { Alert } from '@/components/ui/alert';
import { ReferenceDataNotice } from '@/components/feature/reference-data-notice';
import { apiClient } from '@/lib/api/api-client';

interface HerbEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  valueNumber?: number | null;
  unit?: string | null;
  source?: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  VARIETY: 'พันธุ์',
  ACTIVE_COMPOUND: 'สารสำคัญ',
  CULTIVATION: 'การปลูก',
  HARVEST: 'การเก็บเกี่ยว',
  PROCESSING: 'การแปรรูป',
  DISEASE: 'โรค/ศัตรูพืช',
  LEGAL: 'กฎหมาย',
  GENERAL: 'ทั่วไป',
};

const PAGE_SIZE = 50;

export default function ClientView() {
  const params = useParams<{ code: string }>();
  const code = String(params.code || '').toUpperCase();

  const [entries, setEntries] = useState<HerbEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [herbName, setHerbName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [entriesRes, speciesRes] = await Promise.all([
        apiClient.get<{ total: number; entries: HerbEntry[] }>(`/api/herbs/${code}/entries?page=${page}&pageSize=${PAGE_SIZE}`),
        apiClient.get<{ nameTH: string }>(`/api/herbs/${code}`),
      ]);
      if (entriesRes.success && entriesRes.data?.entries) {
        setEntries((prev) => (page === 1 ? entriesRes.data!.entries : [...prev, ...entriesRes.data!.entries]));
        setTotal(entriesRes.data.total);
      }
      if (speciesRes.success && speciesRes.data?.nameTH) {
        setHerbName(speciesRes.data.nameTH);
      } else if (!speciesRes.success) {
        setNotFound(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [code, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const groups: Record<string, HerbEntry[]> = {};
    for (const entry of entries) {
      (groups[entry.category] ||= []).push(entry);
    }
    return groups;
  }, [entries]);

  const hasMore = entries.length < total;

  return (
    <div className="mx-auto w-full px-4 py-6 md:px-6">
      <Link href="/health/herbs" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="size-4" /> กลับไปฐานข้อมูลสมุนไพร
      </Link>

      <h1 className="mt-3 text-xl font-semibold">{herbName || code}</h1>
      <p className="mt-1 text-sm text-muted-foreground">องค์ความรู้ทั้งหมด {total.toLocaleString()} รายการ</p>

      <ReferenceDataNotice />

      {notFound ? (
        <div className="mt-6">
          <Alert variant="error">ไม่พบฐานข้อมูลสมุนไพรนี้</Alert>
        </div>
      ) : null}

      {isLoading && entries.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h2 className="mb-2 text-base font-semibold">{CATEGORY_LABEL[category] ?? category}</h2>
              <div className="space-y-2">
                {items.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{entry.title}</span>
                      {entry.valueNumber != null ? (
                        <Badge className="border-leaf-300 bg-leaf-soft text-leaf-onSoft">
                          {entry.valueNumber}{entry.unit ? ` ${entry.unit}` : ''}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{entry.content}</p>
                    {entry.source ? <p className="mt-1 text-xs text-muted-foreground">ที่มา: {entry.source}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {hasMore ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setPage((p) => p + 1)} disabled={isLoading}>
                {isLoading ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
