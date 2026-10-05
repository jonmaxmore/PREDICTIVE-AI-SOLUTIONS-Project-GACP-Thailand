'use client';

/**
 * สัญญา C05F680149 ต้นแบบที่ 1.3 — "ระบบเปรียบเทียบมาตรฐาน ASEAN"
 * (ต้นแบบระบบวิเคราะห์มาตรฐาน GACP 3 ระบบ · THRSP)
 *
 * เปรียบเทียบมาตรฐาน GACP/สมุนไพร 10 ประเทศอาเซียน วิเคราะห์ช่องว่างและโอกาส
 * และแนะนำตลาดเป้าหมาย + วิเคราะห์คำขอรายใบเทียบข้อกำหนด ASEAN GHP.
 */

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/primitives/badge';
import { Spinner } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../../components/provider-layout';
import StandardAnalyzeView from '../_components/standard-analyze-view';

interface AseanRow {
  countryCode: string;
  country: string;
  countryTH: string;
  regulator: string;
  standardName: string;
  whoGacpAligned: boolean;
  certificationRequired: boolean;
  keyRequirements: string;
  gapVsThai: string;
  opportunity: string;
}

export default function AseanStandardPage() {
  const [rows, setRows] = useState<AseanRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await apiClient.get<AseanRow[]>('/api/standards/asean/comparison');
        if (active && res.success && Array.isArray(res.data)) {
          setRows(res.data);
        }
      } catch {
        // reference table missing is non-fatal — the analyze block below still works
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
    <ProviderLayout heading title="ระบบเปรียบเทียบมาตรฐาน ASEAN" subtitle="ASEAN Standards Comparison · THRSP ต้นแบบที่ 1.3">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <p className="mb-6 text-sm text-muted-foreground">
          เปรียบเทียบมาตรฐาน GACP/สมุนไพรของ 10 ประเทศอาเซียน วิเคราะห์ช่องว่างจากมาตรฐานไทย
          และโอกาสตลาดสำหรับสมุนไพรเป้าหมาย 6 ชนิด (กัญชา ขมิ้นชัน ขิง กระชายดำ ไพล กระท่อม)
        </p>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <div className="mb-8">
            {/* Desktop: table (≥ md) */}
            <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className="px-4 py-3 font-medium">ประเทศ</th>
                    <th className="px-4 py-3 font-medium">หน่วยงานกำกับ / มาตรฐาน</th>
                    <th className="px-4 py-3 font-medium">อิง WHO GACP</th>
                    <th className="px-4 py-3 font-medium">ช่องว่างจากมาตรฐานไทย</th>
                    <th className="px-4 py-3 font-medium">โอกาสตลาด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.countryCode} className={row.countryCode === 'TH' ? 'bg-leaf-soft/50' : undefined}>
                      <td className="px-4 py-3 align-top font-medium">
                        {row.countryTH}
                        <div className="text-xs text-muted-foreground">{row.country}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div>{row.regulator}</div>
                        <div className="text-xs text-muted-foreground">{row.standardName}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.whoGacpAligned ? (
                          <Badge className="border-leaf-300 bg-leaf-soft text-leaf-onSoft">อิง WHO</Badge>
                        ) : (
                          <Badge tone="neutral">ยังไม่มี</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground">{row.gapVsThai}</td>
                      <td className="px-4 py-3 align-top text-muted-foreground">{row.opportunity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                ข้อมูลอ้างอิงเรียบเรียง ณ ก.ค. 2569 ตรวจทานโดยทีมวิจัยก่อนใช้อ้างอิงภายนอก
              </div>
            </div>

            {/* Mobile: card stack (< md) — no horizontal scroll */}
            <ul className="space-y-3 md:hidden">
              {rows.map((row) => (
                <li key={row.countryCode} className={`rounded-lg border border-border bg-card p-4 ${row.countryCode === 'TH' ? 'bg-leaf-soft/50' : ''}`}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="font-medium">
                      {row.countryTH}
                      <div className="text-xs text-muted-foreground">{row.country}</div>
                    </div>
                    {row.whoGacpAligned ? (
                      <Badge className="shrink-0 border-leaf-300 bg-leaf-soft text-leaf-onSoft">อิง WHO</Badge>
                    ) : (
                      <Badge tone="neutral" className="shrink-0">ยังไม่มี WHO</Badge>
                    )}
                  </div>
                  <p className="text-sm">{row.regulator}</p>
                  <p className="text-xs text-muted-foreground">{row.standardName}</p>
                  <p className="mt-2 text-sm"><span className="text-muted-foreground">ช่องว่าง: </span>{row.gapVsThai}</p>
                  <p className="mt-1 text-sm"><span className="text-muted-foreground">โอกาสตลาด: </span>{row.opportunity}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-1 text-xs text-muted-foreground md:hidden">
              ข้อมูลอ้างอิงเรียบเรียง ณ ก.ค. 2569 ตรวจทานโดยทีมวิจัยก่อนใช้อ้างอิงภายนอก
            </p>
          </div>
        )}

        <h2 className="mb-3 text-base font-semibold">วิเคราะห์คำขอเทียบข้อกำหนด ASEAN GHP</h2>
        <StandardAnalyzeView standardCode="ASEAN" />
      </div>
    </ProviderLayout>
  );
}
