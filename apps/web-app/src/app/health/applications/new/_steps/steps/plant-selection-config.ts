/**
 * ทะเบียนพืชและประเภทคำขอ ที่หน้าจอขั้น 1 และขั้น 4 อ่าน
 *
 * หัวไฟล์เดิมเขียนว่า "Extracted from plant-selection-step.tsx" — ไฟล์นั้นไม่มีอยู่แล้ว
 */

import type {
    PlantId,
    ServiceType,
} from '../hooks/use-application-flow-store';

// ค่าบริการต่อรูปแบบการปลูกไม่มีในไฟล์นี้ และไม่มีในเว็บเป็นค่าคงที่อีกแล้ว: หน้าจออ่านจาก
// GET /api/pricing/fees (hooks/use-pricing.ts) ส่วนยอดของคำขอจริงมาจากใบเสนอราคาที่ระบบออก
// (เดิมมี alias CULTIVATION_FEE_PER_METHOD ชี้ค่าคงที่ ไม่มีผู้ใช้ และค่าคงที่นั้นคือสิ่งที่จะค้าง
//  ราคาเก่าเมื่อ operator เปลี่ยนค่าบริการ จึงถอดออก 2026-10-03)

// TYPES

export interface PlantOption {
    id: string;
    code: PlantId;
    nameTH: string;
    nameEN: string;
    group: 'HIGH_CONTROL' | 'GENERAL';
    enabled: boolean;
    availableServiceTypes: ServiceType[];
}

/**
 * ตัดออก 2026-09-11 (คำสั่ง operator: ล้างคราบเก่า) — ไม่มีไฟล์ไหนใน repo import ของพวกนี้
 *
 * PurposeDocumentType/Config · PurposeOption · CultivationOption · PurposeDocumentState ·
 * ApplicationFlowStep · PlantApiOption · M1_DOCUMENT_SET · PURPOSE_OPTIONS ·
 * CULTIVATION_OPTIONS · PURPOSE_DOCUMENT_SET · PLANT_CODE_ALIAS · APPLICATION_FLOW_STEPS ·
 * getLocalizedText · toPlantCode · buildPurposeDocumentState
 *
 * สิ่งที่หนักที่สุดในชุดนั้นคือ M1_DOCUMENT_SET: ช่องอัปโหลด ภท.11/09/10 ตั้ง required:true
 * ไว้ทั้งสามช่อง คนที่เปิดไฟล์นี้อ่านจึงสรุปว่าระบบบังคับให้แนบแบบคำขอสามใบ ทั้งที่ไม่มีหน้าจอ
 * ไหนเรนเดอร์มันมาตั้งแต่วิซาร์ด 6 ขั้น และ census ของทีมตัดสินไปแล้วว่าให้ตัด:
 *   - กทล.1 ส่วนที่ ๓ ไม่มีรายการ ภท. ใดเลย
 *   - checklist ท้ายแบบของเจ้าหน้าที่ขอ *ตัวใบอนุญาต* ไม่ใช่แบบคำขอ — และแบบคำขอคือสิ่งที่
 *     ผู้ประกอบการยื่นต่อ herbctrl.dtam เพื่อ *ขอ* ใบอนุญาต จึงไม่พิสูจน์สิทธิอะไรเลย
 *   - ป้ายผิดข้อเท็จจริงด้วย: reference ของ repo เองบอกว่า ภท.09 คือคำขอรับใบอนุญาต
 *     **ศึกษาวิจัย** ไม่ใช่ "คำขออนุญาตเพาะปลูก" ตามที่ป้ายเขียน
 *   เหตุผลเต็ม + การตรวจแบบ skeptic: reports/research/2026-09-01-dtam-application-baseline/
 *   census/verify-30.md (upheld = true)
 *
 * APPLICATION_FLOW_STEPS ก็เป็นคราบชั้นเดียวกัน — ลำดับขั้นจริงอยู่ที่
 * `_steps/application-flow-config.ts` (FLOW_STEPS) มานานแล้ว
 *
 * ที่เหลือไว้คือสามอย่างที่มีคนใช้จริง: FALLBACK_PLANTS · SERVICE_OPTIONS · PLANT_MASTER_CODE
 */

/**
 * ชนิดที่ผู้ยื่นเลือกได้
 *
 * ทั้งหกเปิดตั้งแต่ 2026-09-11 (มติ operator: "สินค้า หรือสมุนไพรต้องมี 6 อย่าง ไม่ใช่แค่
 * กัญชา") ก่อนหน้านี้เปิดเฉพาะกัญชา ส่วนอีกห้าชนิดอยู่ในรายการแต่ปิดไว้
 *
 * เปิดได้ก็ต่อเมื่อฝั่งหลังบ้านพร้อมครบสามอย่าง ซึ่งทำมาก่อนใบนี้แล้ว:
 *   1. กฎหมายเอกสารของแต่ละชนิดถูกยื่นเข้าทะเบียนแยกกันหกชุด (5d1f4ee9)
 *      ถ้าไม่มี ประตูยื่นจะปฏิเสธด้วย PLANT_LAW_NOT_FILED
 *   2. แบบ กทล.1 เรียกชื่อชนิดที่ขอ ไม่ใช่พิมพ์ว่ากัญชาให้ทุกคน (088db696)
 *   3. ใบอนุญาตสมุนไพรควบคุมถูกขอเฉพาะกัญชากับกระท่อม — อีกสี่ชนิดไม่มีใบอนุญาตนั้น
 *      อยู่จริง การขอไปเท่ากับกันเขาออกโดยที่เขาทำอะไรไม่ได้
 *
 * ลำดับนี้สำคัญ: เปิดก่อนข้อ 2 เสร็จ คนปลูกขิงจะได้เอกสารราชการที่เขียนว่ากัญชา
 * ซึ่งแย่กว่าถูกบล็อก
 */
export const FALLBACK_PLANTS: PlantOption[] = [
    {
        id: '1',
        code: 'cannabis',
        nameTH: 'กัญชา',
        nameEN: 'Cannabis',
        group: 'HIGH_CONTROL',
        enabled: true,
        availableServiceTypes: ['NEW', 'RENEWAL'],
    },
    {
        id: '3',
        code: 'kratom',
        nameTH: 'กระท่อม',
        nameEN: 'Kratom',
        group: 'HIGH_CONTROL',
        enabled: true,
        availableServiceTypes: ['NEW'],
    },
    {
        id: '4',
        code: 'turmeric',
        nameTH: 'ขมิ้นชัน',
        nameEN: 'Turmeric',
        group: 'GENERAL',
        enabled: true,
        availableServiceTypes: ['NEW'],
    },
    {
        id: '5',
        code: 'ginger',
        nameTH: 'ขิง',
        nameEN: 'Ginger',
        group: 'GENERAL',
        enabled: true,
        availableServiceTypes: ['NEW'],
    },
    {
        id: '6',
        code: 'plai',
        nameTH: 'ไพล',
        nameEN: 'Plai',
        group: 'GENERAL',
        enabled: true,
        availableServiceTypes: ['NEW'],
    },
    {
        id: '7',
        code: 'black_galangal',
        nameTH: 'กระชายดำ',
        nameEN: 'Black Galangal',
        group: 'GENERAL',
        enabled: true,
        availableServiceTypes: ['NEW'],
    },
];

export const SERVICE_OPTIONS: Array<{
    id: ServiceType;
    labelTH: string;
    labelEN: string;
    descriptionTH: string;
    descriptionEN: string;
}> = [
        {
            id: 'NEW',
            labelTH: 'ขอรับรองใหม่',
            labelEN: 'New certification',
            descriptionTH: 'ยื่นคำขอครั้งแรก หรือใบรับรองเดิมหมดอายุแล้ว',
            descriptionEN: 'For first-time submission or expired certificate.',
        },
        {
            id: 'RENEWAL',
            labelTH: 'ต่ออายุใบรับรอง',
            labelEN: 'Renewal',
            descriptionTH: 'ใช้สำหรับต่ออายุใบรับรองที่ยังมีผลบังคับ',
            descriptionEN: 'For extending an active certificate.',
        },
        // 'MODIFY' ("แก้ไขข้อมูลในใบรับรองเดิมโดยไม่เริ่มคำขอใหม่ทั้งหมด") was removed on
        // 2026-09-05. It promised the opposite of the คำรับรอง the same applicant signs
        // three steps later — กทล.1 ส่วนที่ ๔ (๓), "ไม่เปลี่ยนพื้นที่/เมล็ดพันธุ์/ส่วนที่ใช้
        // โดยไม่ยื่นคำขอใหม่" — and it mapped to nothing: the requirement engine knows
        // NEW / RENEWAL / REPLACEMENT only, so picking it filed an ordinary new
        // application without saying so. Zero filings on either database used it.
    ];

/**
 * slug ของวิซาร์ด → รหัสในทะเบียนพืช (`plant_species.code`)
 *
 * คำศัพท์สองชุดนี้ผูกกันอยู่แล้วที่ `apps/backend/config/plant-species-slugs.js` ซึ่งเอกสาร
 * ของมันเขียนเองว่าเป็น "the one place the two vocabularies meet" · ฝั่งเบราว์เซอร์เรียก
 * ไฟล์นั้นไม่ได้ จึงมีสำเนาไว้ที่นี่ และผูกให้ตรงกันด้วยเทสที่อ่านไฟล์ฝั่งหลังบ้านเป็นข้อความ
 * (`health/planting/new/__tests__/the-plant-picked-is-the-plant-meant.test.ts`) —
 * สำนวนเดียวกับที่ `plant-slug-map-covers-the-wizard.test.js` ใช้อยู่แล้วฝั่งหลังบ้าน
 *
 * ทำไมถึงต้องมี: หน้าสร้างรอบปลูกเคยเทียบ `plant.code === 'cannabis'` กับสิ่งที่ประตู
 * `/api/plants` คืนมา ซึ่งคือรหัสทะเบียน `CAN` ⇒ เงื่อนไขไม่มีวันจริง และหน้าจอเลือก
 * แถวแรกของทะเบียนให้เสมอ (บังเอิญเป็นกัญชาอยู่ จึงไม่มีใครเห็น)
 */
export const PLANT_MASTER_CODE: Record<PlantId, string> = {
    cannabis: 'CAN',
    kratom: 'KRA',
    turmeric: 'TUR',
    ginger: 'GIN',
    plai: 'PLA',
    black_galangal: 'GAL',
};
