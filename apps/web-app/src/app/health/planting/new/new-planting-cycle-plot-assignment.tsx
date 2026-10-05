'use client';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/primitives/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives/table';
import { formatCultivationMethod } from '@/lib/planting-labels';
import { type PlotOption } from '@/lib/services/planting-service';
import { plotAreaSqm, suggestPlantCount, type PlotAssignmentForm } from './new-planting-cycle-page-config';

interface NewPlantingCyclePlotAssignmentProps {
  plots: PlotOption[];
  /**
   * ลักษณะพื้นที่ที่ใบรับรองของฟาร์มนี้ครอบคลุม · null = ยังไม่มีใบรับรองที่มีผล
   *
   * แปลงที่อยู่นอกรายการนี้ถูกทำให้ **จางพร้อมบอกเหตุ ไม่ใช่ซ่อน** — ซ่อนแล้วเกษตรกร
   * จะถามว่า "แปลงโรงเรือนหายไปไหน" ซึ่งผิดเกณฑ์ที่ operator ตั้งไว้ว่าต้องใช้ได้เอง
   * โดยไม่ต้องถามใคร · แสดงพร้อมเหตุผลคือการสอนกฎและชี้ทางแก้ในที่เดียว
   */
  certifiedAreaTypes?: string[] | null;
  /** ระหว่างโหลด ห้ามประกาศว่า "ยังไม่มีแปลง" — นั่นเป็นคำกล่าวอ้างที่ยังไม่รู้ว่าจริง */
  loading?: boolean;
  /** ฟาร์มที่กำลังดู — ใช้พาไปหน้าเพิ่มแปลงของฟาร์มนั้นตรง ๆ */
  farmId?: string;
  selectedPlotIds: string[];
  assignments: Record<string, PlotAssignmentForm>;
  onTogglePlot: (plot: PlotOption, checked: boolean) => void;
  onAllocatedAreaChange: (plot: PlotOption, nextArea: number) => void;
  onPlantCountChange: (plot: PlotOption, nextCount: number) => void;
}

/** ลักษณะพื้นที่ของแปลง · INDOOR_CONTROLLED กับ INDOOR คือคำเดียวกันคนละสะกด */
function plotAreaWord(plot: PlotOption): string {
    const word = String(plot.solarSystem || '').trim().toUpperCase();
    return word === 'INDOOR_CONTROLLED' ? 'INDOOR' : word;
}

/** ป้ายไทยของลักษณะพื้นที่ — ใช้ในข้อความเหตุผล ไม่ใช่พ่นคำอังกฤษใส่เกษตรกร */
const AREA_TH: Record<string, string> = {
    OUTDOOR: 'กลางแจ้ง', GREENHOUSE: 'โรงเรือน', INDOOR: 'อาคารระบบปิด', OTHER: 'อื่น ๆ',
};
const areaTh = (word: string) => AREA_TH[word] || word || 'ไม่ระบุ';

export function NewPlantingCyclePlotAssignment({
  plots,
  certifiedAreaTypes = null,
  loading = false,
  farmId = '',
  selectedPlotIds,
  assignments,
  onTogglePlot,
  onAllocatedAreaChange,
  onPlantCountChange,
}: NewPlantingCyclePlotAssignmentProps) {
  return (
    <div className="rounded-lg bg-card shadow-sm">
      <p className="font-semibold">แปลงที่ใช้งานในรอบปลูก</p>
      <p className="mb-3 text-sm text-muted-foreground">เลือกได้หลายแปลง และกำหนดพื้นที่ใช้งานจริงเป็นหน่วยตร.ม.</p>
      <Alert color="blue" title="กติกาจำนวนต้นเป้าหมาย">
        ระบบคำนวณค่าแนะนำจากพื้นที่และรูปแบบการปลูกให้ก่อน แต่สามารถปรับจำนวนต้นเป้าหมายต่อแปลงได้ตามแผนจริง
      </Alert>

      {loading ? (
        // วัดจริง 2026-09-07: คำเตือน "ยังไม่มีแปลง" โผล่ ~7 วินาทีแรกของทุกการเปิดหน้า
        // เพราะเงื่อนไขดูแค่ plots.length ระหว่างที่ยังโหลดไม่เสร็จ — สั่งผู้ใช้ไปสร้างแปลง
        // ทั้งที่แปลงมีอยู่แล้ว · ระหว่างโหลดพูดได้แค่ว่ากำลังโหลด
        <p className="py-3 text-sm text-muted-foreground">กำลังโหลดข้อมูลแปลง…</p>
      ) : plots.length === 0 ? (
        <Alert color="yellow" title="ยังไม่มีแปลงในฟาร์มนี้">
          <span className="block">กรุณาเพิ่มข้อมูลแปลงปลูกก่อนสร้างรอบปลูก</span>
          {farmId ? (
            <a
              className="mt-1 inline-block text-sm font-medium text-leaf-700 underline"
              href={`/health/establishments/${farmId}`}
            >
              ไปหน้าจัดการแปลงของฟาร์มนี้
            </a>
          ) : null}
        </Alert>
      ) : (
        <>
          {/* Wide content scrolls inside its own box, never the page. Measured:
              a 7-column table made document scrollWidth 444 against a 390px
              viewport on /health/training, so the whole page slid sideways.
              Table.ScrollContainer already existed and was simply not used
              here (evidence/apple-qa-audit-2026-09-07). */}
          <Table.ScrollContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลือก</TableHead>
                    <TableHead>แปลง</TableHead>
                    <TableHead>วิธีปลูก</TableHead>
                    <TableHead>พื้นที่แปลง (ตร.ม.)</TableHead>
                    <TableHead>พื้นที่ใช้งาน (ตร.ม.)</TableHead>
                    <TableHead>จำนวนต้นเป้าหมาย</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plots.map((plot) => {
                    const checked = selectedPlotIds.includes(plot.id);
                    const areaSqm = plotAreaSqm(plot);
                    const assignment = assignments[plot.id];
                    // นอกขอบเขตใบรับรอง = เลือกไม่ได้ แต่ยังเห็น และรู้ว่าทำไม
                    const word = plotAreaWord(plot);
                    const outOfScope = Array.isArray(certifiedAreaTypes)
                      && certifiedAreaTypes.length > 0
                      && word !== ''
                      && !certifiedAreaTypes.includes(word);

                    return (
                      <TableRow key={plot.id} className={outOfScope ? 'opacity-60' : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={checked && !outOfScope}
                            disabled={outOfScope}
                            onCheckedChange={(checkedValue) => onTogglePlot(plot, checkedValue === true)}
                          />
                        </TableCell>
                        <TableCell>
                          {plot.name}
                          {outOfScope && (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              ใบรับรองของคุณครอบคลุมเฉพาะ
                              {certifiedAreaTypes.map(areaTh).join(' และ ')}
                              {' '}— ต้องการปลูกแบบ{areaTh(word)} ให้ยื่นคำขอเพิ่มรูปแบบการปลูกก่อน
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge color={outOfScope ? 'gray' : 'blue'}>{formatCultivationMethod(plot.solarSystem)}</Badge>
                        </TableCell>
                        <TableCell>{Math.round(areaSqm).toLocaleString('th-TH')}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={assignment?.allocatedAreaSqm || 0}
                            min={0}
                            max={areaSqm}
                            disabled={!checked || outOfScope}
                            onChange={(value) => onAllocatedAreaChange(plot, Number(value || 0))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={assignment?.plannedPlantCount || 0}
                            min={1}
                            disabled={!checked}
                            onChange={(value) => onPlantCountChange(plot, Math.max(1, Number(value || 0)))}
                          />
                          {checked && (
                            <p className="text-xs text-muted-foreground">
                              แนะนำ {suggestPlantCount(assignment?.allocatedAreaSqm || 0, plot.solarSystem).toLocaleString('th-TH')} ต้น
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
          </Table.ScrollContainer>

          <div className="flex flex-col gap-3">
            {plots.map((plot) => {
              const checked = selectedPlotIds.includes(plot.id);
              const areaSqm = plotAreaSqm(plot);
              const assignment = assignments[plot.id];
              const suggested = suggestPlantCount(assignment?.allocatedAreaSqm || areaSqm, plot.solarSystem);
              return (
                <div className="rounded-lg bg-card p-3 shadow-sm" key={`mobile-${plot.id}`}>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center">
                      <div>
                        <p className="font-bold">{plot.name}</p>
                        <p className="text-xs text-muted-foreground">
                          พื้นที่แปลง {Math.round(areaSqm).toLocaleString('th-TH')} ตร.ม.
                        </p>
                      </div>
                      <Badge color="blue">{formatCultivationMethod(plot.solarSystem)}</Badge>
                    </div>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(checkedValue) => onTogglePlot(plot, checkedValue === true)}
                      label="เลือกแปลงนี้เข้ารอบปลูก"
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Input
                        type="number"
                        label="พื้นที่ใช้งาน (ตร.ม.)"
                        value={assignment?.allocatedAreaSqm || 0}
                        min={0}
                        max={areaSqm}
                        disabled={!checked}
                        onChange={(value) => onAllocatedAreaChange(plot, Number(value || 0))}
                      />
                      <Input
                        type="number"
                        label="เป้าหมาย (ต้น)"
                        value={assignment?.plannedPlantCount || 0}
                        min={1}
                        disabled={!checked}
                        onChange={(value) => onPlantCountChange(plot, Math.max(1, Number(value || 0)))}
                      />
                    </div>
                    {checked && (
                      <p className="text-xs text-muted-foreground">จำนวนแนะนำตามพื้นที่/วิธีปลูก: {suggested.toLocaleString('th-TH')} ต้น</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
