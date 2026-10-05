'use client';

/**
 * ฐานข้อมูลสมุนไพรไทย 6 ชนิด — มุมมองเกษตรกร (browse-only).
 * สัญญา C05F680149 ต้นแบบที่ 5.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Leaf, ChevronRight } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/primitives/card';
import { Badge } from '@/components/ui/primitives/badge';
import { Spinner } from '@/components/ui/spinner';
import { ReferenceDataNotice } from '@/components/feature/reference-data-notice';
import { apiClient } from '@/lib/api/api-client';

interface HerbSpecies {
  code: string;
  nameTH: string;
  nameEN?: string | null;
  scientificName?: string | null;
  isControlled: boolean;
  description?: string | null;
  entryCount: number;
}

export default function ClientView() {
  const [herbs, setHerbs] = useState<HerbSpecies[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await apiClient.get<HerbSpecies[]>('/api/herbs?activeOnly=true');
        if (!active) { return; }
        if (res.success && Array.isArray(res.data)) {
          setHerbs(res.data);
        } else {
          setLoadError(true);
        }
      } catch {
        if (active) { setLoadError(true); }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto w-full px-4 py-6 md:px-6">
      <h1 className="text-xl font-semibold">ฐานข้อมูลสมุนไพรไทย</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        องค์ความรู้สมุนไพร 6 ชนิด พันธุ์ สารสำคัญ การปลูก การเก็บเกี่ยว การแปรรูป และข้อกฎหมาย
      </p>

      <ReferenceDataNotice />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : loadError ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-red-200 bg-red-50 py-12 text-center">
          <p className="text-sm text-red-700">โหลดข้อมูลสมุนไพรไม่สำเร็จ โปรดลองใหม่อีกครั้ง</p>
        </div>
      ) : herbs.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-border py-12 text-center">
          <Leaf className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลสมุนไพร</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {herbs.map((herb) => (
            <Link key={herb.code} href={`/health/herbs/${herb.code}`} className="block h-full no-underline">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                      <Leaf className="size-5" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {herb.nameTH}
                        {herb.isControlled ? (
                          <Badge className="border-amber-200 bg-amber-100 text-amber-800">ควบคุมตามกฎหมาย</Badge>
                        ) : null}
                      </div>
                      <div className="text-xs italic text-muted-foreground">{herb.scientificName}</div>
                      <div className="text-xs text-muted-foreground">{herb.entryCount.toLocaleString()} รายการ</div>
                    </div>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
