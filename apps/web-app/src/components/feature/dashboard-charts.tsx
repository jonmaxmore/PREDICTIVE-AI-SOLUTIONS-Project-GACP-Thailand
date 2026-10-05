'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/primitives/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { DashboardMetrics } from '@/app/provider/dashboard/dashboard-utils';

export function ProviderDashboardCharts({ metrics }: { metrics: DashboardMetrics }) {
  const barData = useMemo(() => [
    { name: 'ใหม่วันนี้', 'จำนวน': metrics.newToday },
    { name: 'รอดำเนินการ', 'จำนวน': metrics.awaitingResponse },
    { name: 'เสี่ยงเกิน SLA', 'จำนวน': metrics.slaBreached },
  ], [metrics]);

  // V-03: only the real Queue Distribution chart remains. The former
  // "Application Flow" line chart was removed — it rendered hardcoded
  // mock values ("Simulated mock trends") presented as a 5-day history,
  // a data-integrity risk on a government dashboard. A real trend
  // endpoint can back a replacement chart in follow-up work.
  const hasData = barData.some((d) => d['จำนวน'] > 0);

  // Minimal-redesign pass: plain hairline card (no shadow, no 2xl radius),
  // token-driven bar colour (was an off-palette raw-hex teal), and a
  // hairline tooltip instead of a floating shadowed pill.
  return (
    <Card className="rounded-xl border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">การกระจายคิวงาน</CardTitle>
        <CardDescription className="text-xs">ภาพรวมงาน ณ ปัจจุบัน</CardDescription>
      </CardHeader>
      <CardContent className="h-[250px] w-full pt-4">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%" minHeight={200}>
            <BarChart data={barData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))' }}
                contentStyle={{ borderRadius: '6px', border: '1px solid hsl(var(--border))', fontSize: '12px' }}
              />
              <Bar dataKey="จำนวน" fill="var(--leaf-700)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-center text-muted-foreground">
            <p className="text-sm font-medium">ยังไม่มีข้อมูลในคิว</p>
            <p className="mt-1 text-xs">เมื่อมีคำขอเข้ามา กราฟจะแสดงที่นี่</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
