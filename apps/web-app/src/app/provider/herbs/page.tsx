'use client';

/**
 * สัญญา C05F680149 ต้นแบบที่ 5 — "ฐานข้อมูลสมุนไพรไทย 6 ฐานข้อมูล"
 * หน้าจัดการ + ตัวชี้วัดความครบถ้วน (KPI: ≥300 รายการ/ฐาน).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Leaf, ChevronRight, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/primitives/badge';
import { Spinner } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../components/provider-layout';

interface HerbSpecies {
  code: string;
  nameTH: string;
  nameEN?: string | null;
  scientificName?: string | null;
  isPrimary: boolean;
  isControlled: boolean;
  entryCount: number;
}

interface CoverageHerb {
  code: string;
  nameTH: string;
  count: number;
  meets300: boolean;
}

interface Coverage {
  target: number;
  totalHerbs: number;
  herbsMeetingTarget: number;
  totalEntries: number;
  herbs: CoverageHerb[];
}

export default function ProviderHerbsPage() {
  const [species, setSpecies] = useState<HerbSpecies[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [speciesRes, coverageRes] = await Promise.all([
        apiClient.get<HerbSpecies[]>('/api/herbs'),
        apiClient.get<Coverage>('/api/herbs/coverage'),
      ]);
      if (speciesRes.success && Array.isArray(speciesRes.data)) {
        setSpecies(speciesRes.data);
      } else {
        setLoadError('โหลดฐานข้อมูลสมุนไพรไม่สำเร็จ');
      }
      if (coverageRes.success && coverageRes.data?.herbs) {
        setCoverage(coverageRes.data);
      }
    } catch {
      setLoadError('โหลดฐานข้อมูลสมุนไพรไม่สำเร็จ โปรดลองใหม่อีกครั้ง');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProviderLayout heading title="ฐานข้อมูลสมุนไพรไทย (6 ฐานข้อมูล)" subtitle="Thai Herb Knowledge DB · THRSP ต้นแบบที่ 5">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 py-12 text-center">
            <ShieldAlert className="size-6 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive">{loadError}</p>
            <button onClick={() => void load()} className="min-h-[44px] rounded-md border border-border px-4 py-1.5 text-sm text-foreground hover:bg-muted">
              ลองใหม่
            </button>
          </div>
        ) : species.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border py-12 text-center">
            <Leaf className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลฐานสมุนไพร</p>
          </div>
        ) : (
          <>
            {coverage ? (
              <div className="mb-6 rounded-lg border border-border bg-card p-4 md:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">ความครบถ้วนตามเป้า KPI</div>
                    <div className="mt-1 text-2xl font-semibold">
                      {coverage.herbsMeetingTarget}/{coverage.totalHerbs} ฐาน
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        ถึงเป้า ≥ {coverage.target} รายการ
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground">รายการทั้งหมด</div>
                    <div className="mt-1 text-2xl font-semibold">{coverage.totalEntries.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {species.map((herb) => {
                const cov = coverage?.herbs.find((h) => h.code === herb.code);
                const meets = cov?.meets300 ?? false;
                const pct = coverage ? Math.min(100, Math.round((herb.entryCount / coverage.target) * 100)) : 0;
                return (
                  <Link
                    key={herb.code}
                    href={`/provider/herbs/${herb.code}`}
                    className="group rounded-lg border border-border bg-card p-5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                        <Leaf className="size-5" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2 font-semibold">
                          {herb.nameTH}
                          {herb.isPrimary ? (
                            <Badge className="border-leaf-300 bg-leaf-soft text-leaf-onSoft">หลัก</Badge>
                          ) : null}
                          {herb.isControlled ? (
                            <span title="มีการควบคุมตามกฎหมาย">
                              <ShieldAlert className="size-4 text-amber-600" />
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs italic text-muted-foreground">{herb.scientificName}</div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">รายการ</span>
                        <span className={meets ? 'font-semibold text-leaf-700' : 'font-semibold'}>
                          {herb.entryCount.toLocaleString()}
                          {coverage ? <span className="text-muted-foreground"> / {coverage.target}</span> : null}
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${meets ? 'bg-leaf-600' : 'bg-amber-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-1 text-sm font-medium text-primary">
                      จัดการรายการ
                      <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </ProviderLayout>
  );
}
