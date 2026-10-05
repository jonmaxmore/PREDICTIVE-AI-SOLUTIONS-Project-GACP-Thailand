/**
 * Shared Dropdown Options — Single Source of Truth
 *
 * ใช้ import จากไฟล์นี้แทนการ define ซ้ำในแต่ละ component
 */

export type SelectOption = { value: string; label: string };

// ─── ระบบน้ำ ─────────────────────────────────────────────────────────────────

/** ประเภทแหล่งน้ำ — ใช้ใน farm-info-step */
export const WATER_SOURCE_OPTIONS: SelectOption[] = [
    { value: 'BOREWELL', label: 'บ่อบาดาล' },
    { value: 'TAP_WATER', label: 'น้ำประปา' },
    { value: 'RAIN', label: 'น้ำฝน' },
    { value: 'RIVER', label: 'แม่น้ำ/ลำธาร' },
    { value: 'POND', label: 'สระน้ำ' },
    { value: 'CANAL', label: 'คลองชลประทาน' },
    { value: 'OTHER', label: 'อื่น ๆ (ระบุ)' },
];

/** ประเภทการกรองน้ำ — ใช้ใน farm-info-step */
export const FILTRATION_OPTIONS: SelectOption[] = [
    { value: 'AGRICULTURAL_FILTER', label: 'กรองเกษตร' },
    { value: 'RO', label: 'RO (Reverse Osmosis)' },
    { value: 'UV', label: 'UV (Ultraviolet)' },
    { value: 'SEDIMENT', label: 'กรองตะกอน' },
    { value: 'CARBON', label: 'กรองคาร์บอน' },
    { value: 'NONE', label: 'ไม่มีการกรอง' },
];

/** ระบบการให้น้ำ — ใช้ทั้ง farm-info-step และ production-info-step */
export const IRRIGATION_OPTIONS: SelectOption[] = [
    { value: 'DRIP', label: 'ระบบน้ำหยด (Drip)' },
    { value: 'SPRINKLER', label: 'สปริงเกลอร์ (Sprinkler)' },
    { value: 'MANUAL', label: 'รดน้ำด้วยมือ (Manual)' },
    { value: 'FLOOD', label: 'ท่วมขัง (Flood)' },
];

// ─── ที่ดิน ───────────────────────────────────────────────────────────────────

/** ประเภทการถือครองที่ดิน — ใช้ใน farm-info-step */
export const LAND_OWNERSHIP_OPTIONS: SelectOption[] = [
    { value: 'OWN', label: 'เจ้าของที่ดิน (มีโฉนด/น.ส.3)' },
    { value: 'RENT', label: 'เช่าที่ดิน (ต้องมีสัญญาเช่า)' },
    { value: 'CONSENT', label: 'ได้รับอนุญาต (ต้องมีหนังสือยินยอม)' },
];

/** ประเภทเอกสารสิทธิ์ที่ดิน — ใช้ใน farm-info-step */
export const LAND_DOCUMENT_OPTIONS = [
    { id: 'CHANOTE', label: 'โฉนดที่ดิน (ชนด)', required: true },
    { id: 'NS3', label: 'น.ส.3', required: false },
    { id: 'SPK', label: 'ส.ป.ก.', required: false },
    { id: 'OTHER', label: 'อื่น ๆ (ระบุ)', required: false },
];

// ─── การผลิต ─────────────────────────────────────────────────────────────────

/** วิธีการขยายพันธุ์ — ใช้ใน production-info-step */
export const PROPAGATION_OPTIONS: SelectOption[] = [
    { value: 'SEED', label: 'เมล็ด (Seed)' },
    { value: 'CUTTING', label: 'กิ่งปักชำ (Cutting)' },
    { value: 'TISSUE', label: 'เพาะเนื้อเยื่อ (Tissue Culture)' },
    { value: 'SEEDLING', label: 'กล้าพันธุ์ (Seedling)' },
    { value: 'OTHER', label: 'อื่น ๆ' },
];

/** ส่วนของพืชที่เก็บเกี่ยว — ใช้ใน production-info-step */
export const PLANT_PARTS_OPTIONS: SelectOption[] = [
    { value: 'flower', label: 'ช่อดอก (Flower)' },
    { value: 'leaf', label: 'ใบ (Leaf)' },
    { value: 'seed', label: 'เมล็ด (Seed)' },
    { value: 'root', label: 'ราก (Root)' },
    { value: 'stem', label: 'ลำต้น (Stem)' },
    { value: 'whole', label: 'ทั้งต้น (Whole Plant)' },
];

/** ประเภทวัสดุปลูก — ใช้ใน production-info-step */
export const PLANTING_MATERIAL_OPTIONS: SelectOption[] = [
    { value: 'SOIL', label: 'ดิน (Soil)' },
    { value: 'COCO_PEAT', label: 'กาบมะพร้าว (Coco Peat)' },
    { value: 'PERLITE', label: 'เพอร์ไลท์ (Perlite)' },
    { value: 'ROCKWOOL', label: 'ร็อควูล (Rockwool)' },
    { value: 'HYDROPONIC', label: 'ไฮโดรโปนิกส์ (Hydroponic)' },
    { value: 'AEROPONIC', label: 'แอโรโปนิกส์ (Aeroponic)' },
    { value: 'MIX', label: 'ดินผสม/อื่น ๆ' },
];

/** ประเภทปัจจัยการผลิต — ใช้ใน production-info-step */
export const INPUT_TYPE_OPTIONS: SelectOption[] = [
    { value: 'FERTILIZER', label: 'ปุ๋ย' },
    { value: 'SOIL_AMENDMENT', label: 'วัสดุปรับปรุงดิน' },
    { value: 'PLANT_PROTECTION', label: 'สารป้องกันกำจัดศัตรูพืช' },
    { value: 'OTHER', label: 'อื่น ๆ' },
];

/** ประเภทปุ๋ย — ใช้ใน production-info-step */
export const FERTILIZER_TYPE_OPTIONS: SelectOption[] = [
    { value: 'ORGANIC', label: 'อินทรีย์ (Organic)' },
    { value: 'CHEMICAL', label: 'เคมี (Chemical)' },
    { value: 'BIO', label: 'ชีวภาพ (Bio-fertilizer)' },
];

// ─── GACP Certification ──────────────────────────────────────────────────────

/** ชนิดดิน — ใช้ใน production-info-step */
export const SOIL_TYPE_OPTIONS: SelectOption[] = [
    { value: 'LOAM', label: 'ดินร่วน (Loam)' },
    { value: 'SANDY_LOAM', label: 'ดินร่วนปนทราย (Sandy Loam)' },
    { value: 'CLAY_LOAM', label: 'ดินร่วนเหนียว (Clay Loam)' },
    { value: 'SANDY', label: 'ดินทราย (Sandy)' },
    { value: 'CLAY', label: 'ดินเหนียว (Clay)' },
    { value: 'PEAT', label: 'ดินพีท (Peat)' },
    { value: 'OTHER', label: 'อื่น ๆ/ไม่ใช้ดิน' },
];

/** ประเภทสายพันธุ์ — ใช้ใน seed-sources */
export const STRAIN_TYPE_OPTIONS: SelectOption[] = [
    { value: 'SATIVA', label: 'Sativa' },
    { value: 'INDICA', label: 'Indica' },
    { value: 'HYBRID', label: 'Hybrid (ลูกผสม)' },
    { value: 'LOCAL', label: 'พันธุ์ท้องถิ่น (Local)' },
    { value: 'UNKNOWN', label: 'ไม่ทราบ' },
];
