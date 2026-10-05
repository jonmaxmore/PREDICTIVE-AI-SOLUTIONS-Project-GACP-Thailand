/**
 * กทล.1 ส่วนที่ ๒ ข้อ ๑-๒ — where the plants are, and by what right.
 *
 * EXACTLY the paper's fields and nothing else. The v1 site step had grown a water
 * system, an expected-yield estimate and other questions the form never asks; every one
 * of them is a thing a farmer has to answer before they can file, and none of them is a
 * thing anyone is entitled to require. A certification wizard may ask what the law asks.
 *
 * Two of these answers are DIMENSIONS the requirement register matches rules on —
 * `landOwnership` and `areaType` — so changing either changes which papers the filing
 * owes. That is why the screen re-asks the server after they change rather than keeping
 * its own idea of the required set.
 */

export type LandTenure = 'OWNED' | 'STATE_PERMITTED' | 'RENTED';
export type SiteAreaType = 'OUTDOOR' | 'GREENHOUSE' | 'INDOOR';

export interface ChoiceTH<T extends string> {
    value: T;
    labelTH: string;
}

/** ข้อ ๒ (๑) สิทธิในที่ดิน. The register's words; the applicant reads the labels. */
export const LAND_TENURE_OPTIONS: ReadonlyArray<ChoiceTH<LandTenure>> = Object.freeze([
    { value: 'OWNED', labelTH: 'เป็นเจ้าของที่ดินเอง' },
    { value: 'STATE_PERMITTED', labelTH: 'ได้รับอนุญาตจากหน่วยงานของรัฐ' },
    { value: 'RENTED', labelTH: 'เช่าที่ดินจากผู้อื่น' },
]);

/**
 * ข้อ ๒ (๒) ลักษณะพื้นที่ปลูก — ติ๊กได้หลายข้อ ตามที่กระดาษวางเป็นแถวเช็กบ็อกซ์
 *
 * **สามข้อ ไม่มี "อื่น ๆ"** (operator 2026-09-11: *"เรามีแค่ 3 อย่างนะ"*)
 *
 * ทำไมข้อนี้สำคัญกว่าที่ตาเห็น: จำนวนข้อที่ติ๊กคือ **ตัวคูณค่าบริการ** (หนึ่งข้อ = 35,310 บาท)
 * และชุดที่ติ๊กคือ **ขอบเขตที่ใบรับรองจะประกาศ** ซึ่งล็อกว่าฟาร์มจะเพิ่มแปลงแบบอื่นได้หรือไม่
 * (certified-scope.js) · ช่องที่สี่จึงไม่ใช่ตัวเลือกที่ไม่มีราคา
 *
 * ประตูยื่นถือคำชุดเดียวกันและปฏิเสธคำอื่นด้วยข้อความไทย
 * (`validation/canonical-application-validator.js` AREA_TYPES)
 */
export const AREA_TYPE_OPTIONS: ReadonlyArray<ChoiceTH<SiteAreaType>> = Object.freeze([
    { value: 'OUTDOOR', labelTH: 'กลางแจ้ง' },
    { value: 'GREENHOUSE', labelTH: 'โรงเรือน' },
    { value: 'INDOOR', labelTH: 'อาคารระบบปิด' },
]);

/**
 * The only unit this form takes.
 *
 * ตารางเมตร, never ไร่ and never a picker. A unit the applicant chooses is a number
 * whose meaning depends on a second field, and this platform has already had to heal 19
 * farms whose area had been stored against the wrong unit.
 */
export const AREA_UNIT_TH = 'ตารางเมตร';

export interface LandDocumentDetail {
    type: string;
    number: string;
    volume: string;
    page: string;
    issuedBy: string;
}

export const LAND_DOCUMENT_FIELDS: ReadonlyArray<{ key: keyof LandDocumentDetail; labelTH: string; required: boolean }> =
    Object.freeze([
        { key: 'type', labelTH: 'ประเภทเอกสารสิทธิ์ เช่น โฉนด น.ส.3 ส.ป.ก.', required: true },
        { key: 'number', labelTH: 'เลขที่เอกสารสิทธิ์', required: true },
        { key: 'volume', labelTH: 'เล่มที่', required: false },
        { key: 'page', labelTH: 'หน้าที่', required: false },
        { key: 'issuedBy', labelTH: 'ออกให้โดย', required: false },
    ]);

export const STEP3_COPY_TH = Object.freeze({
    siteHeading: 'สถานที่ปลูก',
    landHeading: 'สิทธิในที่ดิน',
    scaleHeading: 'ขนาดพื้นที่และรอบการปลูก',
    documentsHeading: 'เอกสารตามเงื่อนไขของแปลงนี้',
    siteName: 'ชื่อสถานที่ปลูก',
    siteAddress: 'ที่อยู่สถานที่ปลูก (บ้านเลขที่ หมู่ ถนน)',
    // กทล.๑ ส่วนที่ ๒ ข้อ ๑ writes the location as three separate fields; the certificate
    // names them, so they are collected here rather than buried in the free-text address.
    siteProvince: 'จังหวัด',
    siteDistrict: 'อำเภอ/เขต',
    siteSubDistrict: 'ตำบล/แขวง',
    sitePostalCode: 'รหัสไปรษณีย์',
    sitePhone: 'โทรศัพท์ที่ติดต่อได้ ณ สถานที่ปลูก',
    landOwnership: 'ที่ดินนี้คุณใช้โดยสิทธิใด',
    landlordName: 'ชื่อเจ้าของที่ดิน',
    areaType: 'ลักษณะพื้นที่ปลูก เลือกได้มากกว่าหนึ่งข้อ',
    areaSqm: `ขนาดพื้นที่ปลูก (${AREA_UNIT_TH})`,
    coordinates: 'พิกัดที่ตั้ง (ละติจูด, ลองจิจูด)',
    plantsPerCycle: 'จำนวนต้นต่อรอบการปลูก',
    cyclesPerYear: 'จำนวนรอบการปลูกต่อปี',
    /** The explainer strip on the approved Step 3 board. */
    conditionalExplainer:
        'รายการเอกสารด้านล่างเปลี่ยนตามคำตอบเรื่องสิทธิในที่ดินและลักษณะพื้นที่ ถ้าคุณเปลี่ยนคำตอบ ระบบจะถามเอกสารชุดใหม่ให้อัตโนมัติ',
});

/**
 * Which slots step 3 is responsible for showing. The SERVER decides which of them this
 * filing actually owes; this list only says where they appear.
 */
export const STEP3_SITE_SLOT_IDS: readonly string[] = Object.freeze([
    'land_rights',
    'landlord_consent',
    'site_map_coords',
    'building_plan_photos',
    'field_surround_photos',
    'site_photos',
]);

/** A landlord has to be named when the land is rented — the consent letter needs one. */
export function needsLandlordName(landOwnership: LandTenure | null): boolean {
    return landOwnership === 'RENTED';
}

/**
 * ขั้นที่ 3 ครบหรือยัง — ตัดสินด้วยสิ่งที่หน้าจอนี้ถาม ไม่ใช่ด้วยฟิลด์ของ wizard รุ่นก่อน
 *
 * ประตูเดิมถาม `farmData.farmName`, `farmData.address` และ `plots.length > 0` ทั้งที่หน้าจอ
 * เขียน `siteName` / `siteAddress` และไม่เคยสร้างแถว plot เลย ⇒ ขั้นนี้ทำให้ครบไม่ได้เลย
 * ไม่ว่ากรอกอย่างไร · เป็นชนิดเดียวกับที่โค้ดของขั้น 4 เตือนไว้เองว่า "เรียกร้องสิ่งที่ขั้นนั้น
 * ไม่ได้เก็บแล้ว คือ v1 hard-lock เป๊ะ ๆ"
 *
 * รายการที่ถาม = ช่องที่หน้าจอทำดอกจันไว้ + คำถามที่ต้องเลือก:
 * ชื่อสถานที่ · ที่อยู่ · สิทธิในที่ดิน · เอกสารสิทธิ์ (ประเภท+เลขที่) · ลักษณะพื้นที่อย่างน้อยหนึ่ง
 * · ขนาดพื้นที่ · ชื่อผู้ให้เช่าเมื่อเช่า · ข้อความของ "อื่น ๆ" เมื่อติ๊กอื่น ๆ
 */
export function step3CanProceed(farmData: Record<string, unknown> | null | undefined): boolean {
    const data = farmData ?? {};
    const stated = (value: unknown) => String(value ?? '').trim() !== '';

    if (!stated(data.siteName) || !stated(data.siteAddress)) { return false; }
    // The certificate names จังหวัด/อำเภอ/ตำบล; a filing without them passes submit and then
    // cannot be certified (F-WALK-03), so the step is not complete until they are stated.
    if (!stated(data.province) || !stated(data.district) || !stated(data.subDistrict)) { return false; }
    if (!stated(data.landOwnership)) { return false; }

    const doc = (data.landDocumentDetail ?? {}) as Record<string, unknown>;
    const documentComplete = LAND_DOCUMENT_FIELDS
        .filter((field) => field.required)
        .every((field) => stated(doc[field.key]));
    if (!documentComplete) { return false; }

    const areaTypes = Array.isArray(data.areaTypes) ? (data.areaTypes as SiteAreaType[]) : [];
    if (areaTypes.length === 0) { return false; }
    if (needsLandlordName(data.landOwnership as LandTenure | null) && !stated(data.landlordName)) { return false; }

    return stated(data.areaSqm);
}
