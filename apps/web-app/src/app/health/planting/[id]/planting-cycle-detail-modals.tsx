'use client';

import Image from 'next/image';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { NumberInput } from '@/components/ui/form-controls';
import { Modal } from '@/components/ui/overlays';
import { Input as TextInput } from '@/components/ui/primitives/input';
import { DateInput } from '@/components/ui/date-input';
import { SimpleGrid } from '@/components/ui/layout-utils';
import { Spinner as Loader } from '@/components/ui/spinner';
import { Icons } from '@/components/ui/icons';
import { formatCultivationMethod } from '@/lib/planting-labels';

/**
 * Modals for the planting-cycle detail screen.
 *
 * The 'สร้างรายต้น' modal and its 'ยืนยันปลูกแบบกลุ่ม' sibling are GONE:
 * R8 (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently, so there is no count of plants to mint
 * and no draft plant to confirm. Harvest is recorded per PLOT and creates
 * one Batch per plot with its Lots underneath - that is the finest
 * resolution the product carries.
 */

interface CyclePlotRow {
  cyclePlotId: string;
  name: string;
  solarSystem?: string;
  allocatedAreaSqm: number;
}

interface PackagingRow {
  packageType: string;
  quantity: number;
  unitWeight: number;
}

interface HarvestFormRow {
  freshWeightKg: number;
  qualityGrade: string;
  notes: string;
  packagingRows: PackagingRow[];
}

interface PlantingCycleDetailModalsProps {
  cycle: { plots?: CyclePlotRow[] };
  /** true while the harvest POST is in flight. */
  submitting: boolean;
  harvestModalOpened: boolean;
  closeHarvestModal: () => void;
  harvestDate: Date | null;
  setHarvestDate: (value: Date | null) => void;
  harvestForms: Record<string, HarvestFormRow>;
  createDefaultPackagingRow: () => PackagingRow;
  sumPackagingWeight: (rows: PackagingRow[]) => number;
  updateHarvestField: (cyclePlotId: string, patch: Partial<HarvestFormRow>) => void;
  updatePackagingRow: (cyclePlotId: string, rowIndex: number, patch: Partial<PackagingRow>) => void;
  removePackagingRow: (cyclePlotId: string, rowIndex: number) => void;
  addPackagingRow: (cyclePlotId: string) => void;
  handleHarvest: () => void;
  qrPreviewOpened: boolean;
  closeQrPreviewModal: () => void;
  qrPreviewTitle: string;
  qrPreviewDataUrl: string | null;
  qrPreviewTargetUrl: string;
}

export function PlantingCycleDetailModals({
  cycle,
  submitting,
  harvestModalOpened,
  closeHarvestModal,
  harvestDate,
  setHarvestDate,
  harvestForms,
  createDefaultPackagingRow,
  sumPackagingWeight,
  updateHarvestField,
  updatePackagingRow,
  removePackagingRow,
  addPackagingRow,
  handleHarvest,
  qrPreviewOpened,
  closeQrPreviewModal,
  qrPreviewTitle,
  qrPreviewDataUrl,
  qrPreviewTargetUrl,
}: PlantingCycleDetailModalsProps) {
  return (
    <>
      <Modal opened={harvestModalOpened} onClose={closeHarvestModal} title="เก็บเกี่ยวและสร้าง Batch/Lot แยกตามแปลง" centered size="xl">
        <div className="flex flex-col">
          {/*
            ผลวิเคราะห์ (COA) ไม่บังคับ — operator 2026-09-11: "ไม่ได้บังคับว่าต้องมี
            แต่มีเพื่อประโยชน์ของเกษตรกรเอง จะอัพหรือไม่อัพก็ได้"

            จึงเป็นคำบอกเล่า ไม่ใช่คำขวาง: ไม่ปิดปุ่ม ไม่ขึ้นสีแดง · สิ่งที่ต้องบอกคือ
            **ผู้ซื้อที่สแกนจะเห็นอะไร** เพราะนั่นคือผลที่เกษตรกรได้จริงจากการแนบหรือไม่แนบ
            และหน้าสแกนแยก "ถุงใบนี้ตรวจแล้วหรือยัง" ออกจาก "ฟาร์มนี้มีผลตรวจ" อยู่แล้ว
            (lab-evidence-service) ⇒ ล็อตที่ยังไม่มีผล จะแสดงว่ายังไม่มี ไม่ได้ยืมของฟาร์มมาอ้าง

            แนบทีหลังได้เสมอ — COA กลับจากแล็บ 3-14 วันหลังส่งตัวอย่าง ซึ่งมักช้ากว่าวันบรรจุ
          */}
          <div className="mb-4 rounded-xl border border-border bg-muted/40 p-4">
            <p className="text-sm font-medium text-foreground">ผลวิเคราะห์จากห้องแล็บ (COA)</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              ไม่จำเป็นต้องมีก่อนบรรจุ — แนบทีหลังได้เมื่อผลกลับมาจากแล็บ
              <br />
              ถ้ายังไม่แนบ ผู้ซื้อที่สแกน QR ของล็อตนี้จะเห็นว่า
              <span className="font-medium text-foreground"> ยังไม่มีผลวิเคราะห์ </span>
              ของล็อตนี้ · แนบแล้วจะเห็นไฟล์ผลตรวจและชื่อห้องแล็บ
            </p>
          </div>

          <DateInput label="วันที่เก็บเกี่ยว" value={harvestDate} onChange={setHarvestDate} required />

          {(cycle.plots || []).map((plot) => {
            const form = harvestForms[plot.cyclePlotId] || {
              freshWeightKg: 0,
              qualityGrade: '',
              notes: '',
              packagingRows: [createDefaultPackagingRow()],
            };
            const packagingTotal = sumPackagingWeight(form.packagingRows);

            return (
              <div className="rounded-lg bg-card shadow-sm" key={plot.cyclePlotId}>
                <div className="mb-2 flex flex-wrap items-center">
                  <div className="flex flex-col">
                    <p className="font-bold">{plot.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatCultivationMethod(plot.solarSystem)} · พื้นที่ {Math.round(plot.allocatedAreaSqm).toLocaleString('th-TH')} ตร.ม.
                    </p>
                  </div>
                  <Badge color="blue" >แปลงในรอบ</Badge>
                </div>

                <SimpleGrid cols={3} spacing="sm">
                  <NumberInput
                    label="น้ำหนักสด (กก.)"
                    min={0}

                    value={form.freshWeightKg}
                    onChange={(value) => updateHarvestField(plot.cyclePlotId, { freshWeightKg: Number(value || 0) })}
                    required
                  />
                  <TextInput
                    label="เกรดคุณภาพ"
                    placeholder="เช่น A"
                    value={form.qualityGrade}
                    onChange={(event) => updateHarvestField(plot.cyclePlotId, { qualityGrade: event.currentTarget.value })}
                  />
                  <TextInput
                    label="หมายเหตุย่อย"
                    value={form.notes}
                    onChange={(event) => updateHarvestField(plot.cyclePlotId, { notes: event.currentTarget.value })}
                  />
                </SimpleGrid>

                <hr className="my-3 h-px border-0 bg-slate-200/60" />
                <div className="flex flex-col gap-2">
                  {form.packagingRows.map((row, rowIndex) => (
                    <SimpleGrid key={`${plot.cyclePlotId}-${rowIndex}`} cols={5} spacing="sm">
                      <TextInput
                        label="ชนิดบรรจุภัณฑ์"
                        value={row.packageType}
                        onChange={(event) => updatePackagingRow(plot.cyclePlotId, rowIndex, { packageType: event.currentTarget.value })}
                      />
                      <NumberInput
                        label="จำนวนหน่วย"
                        min={1}
                        value={row.quantity}
                        onChange={(value) => updatePackagingRow(plot.cyclePlotId, rowIndex, { quantity: Number(value || 0) })}
                      />
                      <NumberInput
                        label="น้ำหนักต่อหน่วย (กก.)"
                        min={0}

                        value={row.unitWeight}
                        onChange={(value) => updatePackagingRow(plot.cyclePlotId, rowIndex, { unitWeight: Number(value || 0) })}
                      />
                      <TextInput
                        label="น้ำหนักรวม (คำนวณ)"
                        value={(Number(row.quantity || 0) * Number(row.unitWeight || 0)).toFixed(3)}

                      />
                      <div className="flex flex-wrap items-center">
                        <Button
                          variant="subtle"
                          color="red"
                          disabled={form.packagingRows.length <= 1}
                          onClick={() => removePackagingRow(plot.cyclePlotId, rowIndex)}
                        >
                          ลบ
                        </Button>
                      </div>
                    </SimpleGrid>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center">
                  <Button size="sm" onClick={() => addPackagingRow(plot.cyclePlotId)} leftSection={<Icons.Plus size={14} />}>
                    เพิ่มบรรจุภัณฑ์
                  </Button>
                  <p className="text-xs">
                    น้ำหนักรวมบรรจุภัณฑ์: {packagingTotal.toLocaleString('th-TH', { maximumFractionDigits: 3 })} กก.
                  </p>
                </div>
              </div>
            );
          })}

          <Alert color="blue" title="ข้อกำหนดการเก็บเกี่ยวหลายแปลง">
            ระบบจะสร้าง 1 Batch ต่อ 1 แปลงในรอบ และสร้าง Lot ภายใต้ Batch ของแปลงนั้น เพื่อให้ Trace ย้อนกลับได้ชัดเจน
          </Alert>

          <div className="flex flex-wrap items-center">
            <Button variant="default" onClick={closeHarvestModal}>ยกเลิก</Button>
            <Button color="green" onClick={handleHarvest} loading={submitting}>ยืนยันเก็บเกี่ยวและสร้างล็อต</Button>
          </div>
        </div>
      </Modal>

      <Modal opened={qrPreviewOpened} onClose={closeQrPreviewModal} title={qrPreviewTitle} centered>
        <div className="flex flex-col gap-3">
          {qrPreviewDataUrl ? (
            <Image src={qrPreviewDataUrl} alt={qrPreviewTitle} width={220} height={220} unoptimized />
          ) : (
            <Loader size="sm" />
          )}
          <p className="text-center text-xs text-slate-500" style={{ wordBreak: 'break-all' }}>
            {qrPreviewTargetUrl}
          </p>
          {/* แปลงหนึ่งแปลงมีรหัสสองแบบ และมีแบบเดียวที่ติดกลางแปลงได้ · รหัสในรูปนี้เป็นของ
              รอบปลูกนี้ ซึ่งเกิดใหม่ทุกฤดู (services/plot-qr-row.js) · ก่อนหน้านี้หน้าต่างนี้
              ขึ้นหัวข้อว่า "QR แปลง" เฉย ๆ วางอยู่ข้างปุ่ม "พิมพ์ป้าย" ที่พิมพ์ป้ายถาวร —
              คนที่แคปรูปนี้ไปปักกลางแปลงจะได้ป้ายที่ตายเมื่อจบฤดู */}
          <p className="rounded-lg bg-muted p-2 text-center text-[11px] font-medium leading-relaxed text-muted-foreground">
            รหัสนี้เป็นของ<strong>รอบปลูกนี้</strong> และเกิดใหม่ทุกรอบ ใช้สำหรับดูข้อมูลรอบปัจจุบัน
            <br />
            ป้ายที่ติดไว้กลางแปลงถาวร ให้กดปุ่ม &quot;พิมพ์ป้าย&quot; ซึ่งใช้รหัสประจำแปลงที่ไม่เปลี่ยน
          </p>
          <div className="flex flex-wrap items-center">
            <Button href={qrPreviewTargetUrl} target="_blank" rel="noreferrer" size="sm">
              เปิดหน้า Trace
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
