/**
 * แก้ไขรอบปลูก — กติกาของหน้าจอ T2
 *
 * หน้านี้ไม่เคยมีมาก่อน: `plantingService.updateCycle()` มีอยู่ในโค้ดฝั่งเว็บแต่ไม่มีไฟล์ไหน
 * เรียกมันเลย ⇒ กติกา R11/R12 ("แก้ได้จนตัด แล้วแช่แข็ง") ไม่เคยถูกใช้งานจริง
 *
 * ตั้งแต่ T1 ประตูฝั่ง server ปฏิเสธการแก้ฟิลด์ที่หน้าสแกนสาธารณะประกาศ ด้วย
 * `CYCLE_FROZEN` 409 · หน้าจอต้องบอกเรื่องนี้ **ก่อน** ผู้ใช้พิมพ์ ไม่ใช่หลังกดส่ง
 *
 * ออกแบบ: docs/design/2026-09-05-tnt-loop-and-farmer-updates.md §2
 */

/** ฟิลด์ที่แช่แข็งหลังตัด เพราะสี่ตัวนี้คือสิ่งที่หน้าสแกนสาธารณะประกาศ */
export const FROZEN_AFTER_CUT = ['varietyName', 'seedSource', 'soilType', 'irrigationType'] as const;
export type FrozenField = typeof FROZEN_AFTER_CUT[number];

/**
 * ป้ายภาษาไทยของแต่ละฟิลด์ — แหล่งเดียว ใช้ทั้งการวาดฟอร์มและการแปลชื่อฟิลด์ที่ประตูปฏิเสธ
 * (ห้ามพิมพ์ชื่อฟิลด์อังกฤษให้เกษตรกรอ่าน)
 */
export const FIELD_LABEL_TH: Record<string, string> = {
    cycleName: 'ชื่อรอบปลูก',
    varietyName: 'สายพันธุ์',
    seedSource: 'แหล่งที่มาของเมล็ด/ต้นพันธุ์',
    soilType: 'ชนิดดิน',
    irrigationType: 'ระบบให้น้ำ',
    notes: 'บันทึกภายใน',
};

export type Cycle = {
    id: string;
    status?: string | null;
    /**
     * จำนวนรุ่นเก็บเกี่ยว — ประตู getById ส่งมาที่ `traceSummary.batchCount` (และ
     * `_count.batches`) ไม่ได้ส่งเป็น top-level `batchCount` · ต้องอ่านให้ครบทุกทรง
     * ไม่งั้นด่านแช่แข็งฝั่ง "มี batch แล้ว" จะไม่เคยติดจากคำตอบจริงของ API
     */
    batchCount?: number | null;
    traceSummary?: { batchCount?: number | null } | null;
    _count?: { batches?: number | null } | null;
    cycleName?: string | null;
    varietyName?: string | null;
    seedSource?: string | null;
    soilType?: string | null;
    irrigationType?: string | null;
    notes?: string | null;
};

/** จำนวนรุ่นเก็บเกี่ยว จากทรงใดก็ได้ที่ประตูอาจส่งมา — มิเรอร์ `isLocked` ฝั่ง server */
function batchCountOf(cycle: Cycle): number {
    const raw = cycle.traceSummary?.batchCount
        ?? cycle._count?.batches
        ?? cycle.batchCount
        ?? 0;
    return Number(raw) || 0;
}

/**
 * แปลรายชื่อฟิลด์ที่ประตู `CYCLE_FROZEN` 409 ปฏิเสธ ให้เป็นข้อความไทยที่ระบุชื่อฟิลด์เป็นไทย
 *
 * ประตูส่ง `fields` (ชื่อคีย์อังกฤษ) มาใน envelope · หน้าจอแช่แข็งช่องเหล่านี้ไว้ก่อนอยู่แล้ว
 * ข้อความนี้จึงเป็นตาข่ายชั้นสอง — ถ้าสถานะเลื่อนจนหลุดมาถึง 409 จริง เกษตรกรต้องอ่านชื่อไทย
 * ไม่ใช่คีย์อังกฤษที่ประตูต่อไว้ในข้อความของมันเอง · คีย์ที่ไม่รู้จักไม่ทิ้งเงียบ แสดงดิบไป
 */
export function frozenRefusalMessage(fields: unknown): string | null {
    if (!Array.isArray(fields) || fields.length === 0) { return null; }
    const labels = fields.map((f) => FIELD_LABEL_TH[String(f)] || String(f)).filter(Boolean);
    if (labels.length === 0) { return null; }
    return `แก้ไม่สำเร็จ: ${labels.join(' · ')} ถูกแช่แข็งแล้ว เพราะแสดงอยู่บนหน้าตรวจสอบย้อนกลับที่ผู้ซื้อสแกนดูได้ `
        + 'หากต้องแก้ไข กรุณาติดต่อเจ้าหน้าที่';
}

/**
 * สามสถานะที่หน้าจอต้องบอกให้ชัดก่อนอย่างอื่น
 * "อ่านไม่ได้" ต้องไม่หน้าตาเหมือน "ยังไม่มีข้อมูล" (tnt-data-scope หลักข้อ 4)
 */
export type PageState =
    | { kind: 'loading' }
    | { kind: 'unreadable' }
    | { kind: 'editable'; cycle: Cycle }
    | { kind: 'frozen'; cycle: Cycle; reason: 'HARVESTED' | 'HAS_BATCHES' };

/** ตรงกับ `isLocked` ของ services/planting-service.js — เงื่อนไขเดียวกัน คนละฝั่ง */
export function freezeReason(cycle: Cycle | null): 'HARVESTED' | 'HAS_BATCHES' | null {
    if (!cycle) { return null; }
    const status = String(cycle.status || '').toUpperCase();
    if (['HARVESTED', 'COMPLETED'].includes(status)) { return 'HARVESTED'; }
    if (batchCountOf(cycle) > 0) { return 'HAS_BATCHES'; }
    return null;
}

export function pageState(args: {
    loading: boolean; error: boolean; cycle: Cycle | null;
}): PageState {
    if (args.loading) { return { kind: 'loading' }; }
    if (args.error || !args.cycle) { return { kind: 'unreadable' }; }
    const reason = freezeReason(args.cycle);
    return reason
        ? { kind: 'frozen', cycle: args.cycle, reason }
        : { kind: 'editable', cycle: args.cycle };
}

/**
 * ส่งเฉพาะฟิลด์ที่เปลี่ยนจริง และเฉพาะที่ยังแก้ได้
 *
 * ส่งฟิลด์ที่แช่แข็งไปด้วยค่าที่ไม่ได้เปลี่ยน ก็ยังโดนประตูปฏิเสธทั้งคำขอ — เพราะประตู
 * ดูว่า "มีคีย์นั้นมาไหม" ไม่ได้ดูว่าค่าต่างไหม (ปฏิเสธเสียงดัง ไม่ตัดคีย์เงียบ)
 * ⇒ หน้าจอต้องไม่ส่งสิ่งที่ผู้ใช้แก้ไม่ได้ตั้งแต่แรก
 */
export function buildPatch(original: Cycle, draft: Partial<Cycle>, frozen: boolean): Partial<Cycle> {
    const editable: (keyof Cycle)[] = frozen
        ? ['notes']
        : ['notes', 'cycleName', ...FROZEN_AFTER_CUT];
    const patch: Partial<Cycle> = {};
    for (const key of editable) {
        const next = draft[key];
        if (next === undefined) { continue; }
        if ((original[key] ?? '') !== next) {
            (patch as Record<string, unknown>)[key] = next;
        }
    }
    return patch;
}

export type SaveState =
    | { canSave: false; reason: 'NOTHING_CHANGED' | 'IN_FLIGHT' }
    | { canSave: true; reason: null };

export function saveState(patch: Partial<Cycle>, inFlight: boolean): SaveState {
    if (inFlight) { return { canSave: false, reason: 'IN_FLIGHT' }; }
    if (Object.keys(patch).length === 0) { return { canSave: false, reason: 'NOTHING_CHANGED' }; }
    return { canSave: true, reason: null };
}
