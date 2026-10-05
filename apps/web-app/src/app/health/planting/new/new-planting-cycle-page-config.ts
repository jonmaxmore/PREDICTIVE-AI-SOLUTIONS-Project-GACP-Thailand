import { PLANT_MASTER_CODE } from '@/app/health/applications/new/_steps/steps/plant-selection-config';

// Area conversion and plant density both live in @/lib/area now. They were
// duplicated here with a different fallback density — 1 plant per square metre
// for an unrecognised method, where the backend enforces the outdoor 2.5 — so
// the suggested count was lower than what the platform would have accepted,
// with nothing on screen to say why.
export { plotAreaSqm, suggestPlantCount } from '@/lib/area';

export type PlotAssignmentForm = {
  allocatedAreaSqm: number;
  plannedPlantCount: number;
};

/**
 * พืชที่ควรถูกเลือกไว้ให้ตอนเปิดหน้าสร้างรอบปลูก
 *
 * เดิมหน้าจอเทียบ `code === 'cannabis'` — เทียบ slug ของวิซาร์ดกับรหัสทะเบียน (`CAN`)
 * จึงไม่เคยตรง และตกไปที่แถวแรกของทะเบียนเสมอ วันนี้แถวแรกบังเอิญเป็นกัญชา วันหน้าที่
 * ทะเบียนเพิ่มพืชหรือ sortOrder ขยับ เกษตรกรที่ถือใบรับรองกัญชาจะเจอพืชอื่นถูกเลือกไว้ให้
 *
 * แยกออกมาเป็นฟังก์ชันเพราะเป็นกฎ ไม่ใช่การวาดหน้าจอ — ทดสอบได้โดยไม่ต้อง mount อะไรเลย
 */
export function pickDefaultPlantSpeciesId(
    plantRows: ReadonlyArray<{ id?: string | null; code?: string | null }> | undefined | null,
): string {
    const rows = Array.isArray(plantRows) ? plantRows : [];
    if (!rows.length) { return ''; }
    const wanted = PLANT_MASTER_CODE.cannabis.toLowerCase();
    const cannabis = rows.find((row) => String(row?.code || '').toLowerCase() === wanted);
    return String(cannabis?.id || rows[0]?.id || '');
}
