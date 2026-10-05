'use client';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Textarea } from '@/components/ui/textarea';
import { formatCultivationMethod } from '@/lib/planting-labels';

interface NewPlantingCycleSummaryProps {
  methods: string[];
  summary: {
    plotCount: number;
    totalAreaSqm: number;
    totalPlants: number;
  };
  submitBlockers: string[];
  notes: string;
  onNotesChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function NewPlantingCycleSummary({
  methods,
  summary,
  submitBlockers,
  notes,
  onNotesChange,
  onCancel,
  onSubmit,
  submitting,
}: NewPlantingCycleSummaryProps) {
  return (
    <>
      <div className="rounded-lg bg-card shadow-sm">
        <div className="flex flex-wrap items-center">
          <p className="font-semibold">สรุปก่อนบันทึก</p>
          <div className="flex flex-wrap items-center gap-2">
            {methods.map((method) => (
              <Badge key={method} color="teal">{formatCultivationMethod(method)}</Badge>
            ))}
          </div>
        </div>
        {/* W1-HYDRATION: the bold value was a <p> nested inside a <p> —
            invalid HTML. The browser closes the outer <p> while parsing the
            server HTML, so React's client tree can never match it
            ("In HTML, <p> cannot be a descendant of <p>" → hydration
            failure on /health/planting/new). <span> keeps the inline bold. */}
        <div className="grid grid-cols-2 gap-4">
          <p className="text-sm">จำนวนแปลงที่เลือก: <span className="font-bold">{summary.plotCount}</span> แปลง</p>
          <p className="text-sm">พื้นที่รวม: <span className="font-bold">{Math.round(summary.totalAreaSqm).toLocaleString('th-TH')}</span> ตร.ม.</p>
          <p className="text-sm">จำนวนต้นเป้าหมาย: <span className="font-bold">{summary.totalPlants.toLocaleString('th-TH')}</span> ต้น</p>
        </div>
        {submitBlockers.length > 0 ? (
          <Alert color="yellow" title="ยังบันทึกรอบปลูกไม่ได้">
            <div className="flex flex-col">
              {submitBlockers.map((item) => (
                <p className="text-xs" key={item}>• {item}</p>
              ))}
            </div>
          </Alert>
        ) : (
          <Alert color="green" title="พร้อมบันทึกรอบปลูก">
            ข้อมูลครบตามกติกา สามารถกดบันทึกรอบปลูกได้
          </Alert>
        )}
      </div>

      <Textarea
        label="หมายเหตุรอบปลูก"
        value={notes}
        onChange={(event) => onNotesChange(event.currentTarget.value)}
      />

      <div className="flex flex-wrap items-center">
        <Button variant="default" onClick={onCancel}>ยกเลิก</Button>
        <Button
          color="green"
          loading={submitting}
          disabled={submitBlockers.length > 0}
          onClick={onSubmit}
        >
          บันทึกรอบปลูก
        </Button>
      </div>
    </>
  );
}
