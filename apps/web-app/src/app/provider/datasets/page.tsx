'use client';

/**
 * สัญญา C05F680149 ภาคผนวก 4 ข้อ 3 — "ชุดข้อมูลดิบ (API/CSV) + คู่มือการใช้
 * ชุดข้อมูล → Data Lake บพข." — แคตตาล็อกชุดข้อมูลดิบ + ปุ่มดาวน์โหลด
 * (การ export จริงจำกัดสิทธิ์ ADMIN ฝั่ง backend; ปุ่มจะ 403 สำหรับ role อื่น)
 */

import { useEffect, useState } from 'react';
import { Database, Download, BookOpen } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../components/provider-layout';

interface DatasetDomain {
  key: string;
  thaiName: string;
  description: string;
  model: string;
  fieldCount: number;
  formats: string[];
}

export default function DatasetsPage() {
  const [domains, setDomains] = useState<DatasetDomain[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await apiClient.get<DatasetDomain[]>('/api/datasets');
        if (active && res.success && Array.isArray(res.data)) {
          setDomains(res.data);
        }
      } catch {
        // catalog stays empty
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
    <ProviderLayout title="ชุดข้อมูลดิบ (Data Lake)" subtitle="Raw Dataset Export · ภาคผนวก 4 ข้อ 3">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            ชุดข้อมูลปฏิบัติการที่ยังไม่ผ่านการวิเคราะห์ สำหรับส่งเข้า Data Lake ของ บพข.
            ทุกชุดเป็นนามแฝงโดยโครงสร้าง (ไม่มีคอลัมน์ข้อมูลส่วนบุคคล)
          </p>
          <Button asChild variant="outline">
            <a href="/api/datasets/dictionary" target="_blank" rel="noreferrer">
              <BookOpen className="mr-1 size-4" /> คู่มือการใช้ชุดข้อมูล (Data Dictionary)
            </a>
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {domains.map((domain) => (
              <div key={domain.key} className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Database className="size-5" />
                  </span>
                  <div>
                    <div className="font-semibold">{domain.thaiName}</div>
                    <div className="font-mono text-xs text-muted-foreground">{domain.key} · {domain.fieldCount} fields</div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{domain.description}</p>
                <div className="mt-4 flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/datasets/${domain.key}/export?format=csv`} download>
                      <Download className="mr-1 size-4" /> CSV
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/datasets/${domain.key}/export?format=jsonl`} download>
                      <Download className="mr-1 size-4" /> JSONL
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          การดาวน์โหลดจำกัดสิทธิ์ผู้ดูแลระบบ (ADMIN) และถูกบันทึกใน audit trail ทุกครั้ง
        </p>
      </div>
    </ProviderLayout>
  );
}
