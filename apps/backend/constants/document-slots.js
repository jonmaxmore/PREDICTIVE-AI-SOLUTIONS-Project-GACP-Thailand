/**
 * GACP Document Slots
 * กำหนด slot IDs สำหรับเอกสารที่ต้องแนบใน Application
 * 
 * Note: ใบอนุญาต (ภท.09/10/11/12/13/16) รวมอยู่ในนี้เพื่อรีวิวพร้อมกับเอกสารอื่น
 * ภท.09/10/11 คือ **ใบอนุญาตที่ออกให้แล้ว** ที่รองรับวัตถุประสงค์ของคำขอ (มติ operator 2026-10-05) —
 * ชื่อและรหัสมาจาก shared/certification-purposes.js ที่เดียว
 * จ่าย 5,000 บาท ต่อ 1 area type = 1 ชุดเอกสาร = 1 การรีวิว
 * 
 * แบบฟอร์มตามกฎกระทรวง พ.ศ. 2559 และประกาศGACP Thai Platform พ.ศ. 2568:
 * - ภท.12: แบบคำขอรับอนุญาตจำหน่าย/มีไว้ในครอบครองซึ่งสมุนไพรควบคุม
 * - ภท.13: แบบใบอนุญาต (เจ้าหน้าที่ออกให้หลังอนุมัติ)
 * - ภท.16: แบบคำขอรับใบแทนใบอนุญาต (เมื่อใบเดิมสูญหาย/ชำรุด)
 * - ภท.33: ใบสั่งจ่ายสมุนไพรควบคุม (กัญชา)
 *
 * รายงาน (ภท.27-32) อยู่ใน routes/api/report-submissions.js
 * SOP Templates อยู่ใน web-app/src/app/health/sop-templates/page.tsx
 */

const { CERTIFICATION_PURPOSES, KRATOM_EXPORT_LICENCE_SLOT_ID } = require('../shared/certification-purposes');

/** ช่องใบอนุญาตของวัตถุประสงค์หนึ่ง — ใบอนุญาตตัวจริงที่ออกให้แล้ว ไม่ใช่แบบคำขอ */
function licenceSlot(purposeCode) {
    const purpose = CERTIFICATION_PURPOSES[purposeCode];
    return {
        slotId: purpose.slotId,
        name: `${purpose.licenceName} (${purpose.licenceCode})`,
        description: `ตัวใบอนุญาตที่ออกให้แล้ว ไม่ใช่แบบคำขอ ใช้กรณีเลือกวัตถุประสงค์ "${purpose.label}" สำหรับสมุนไพรควบคุม`,
        sourceHint: `ขอ${purpose.licenceName} (${purpose.licenceCode}) กับนายทะเบียน สสจ. จังหวัดที่ตั้งสถานประกอบการ (กรุงเทพฯ ยื่นที่กรมการแพทย์แผนไทยฯ) แล้วนำใบอนุญาตที่ออกให้แล้วมาแนบ`,
    };
}

const DOCUMENT_SLOTS = {
    // ===== เอกสารใบอนุญาต (DTAM License) =====
    // ตามกฎกระทรวง พ.ศ. 2559 และประกาศGACP Thai Platform พ.ศ. 2568

    // Legacy BT codes (for backward compatibility with tests)
    LICENSE_BT11: {
        slotId: 'license_bt11',
        name: 'แบบ บท.11 / ภท.11 (คำขออนุญาตสมุนไพรควบคุม)',
        description: 'แบบคำขออนุญาตศึกษาวิจัย/จำหน่าย/ส่งออก/แปรรูปสมุนไพรควบคุม',
        required: true, // ✅ บังคับเสมอ สำหรับพืชควบคุม
        requiredFor: { plantTypes: ['cannabis', 'kratom'] },
        warningText: '⚠️ พืชควบคุมต้องยื่นแบบ บท.11/ภท.11 กับGACP Thaiฯ',
    },
    LICENSE_BT13: {
        slotId: 'license_bt13',
        name: 'แบบ บท.13 (ใบอนุญาตแปรรูปสมุนไพรควบคุม)',
        description: 'ใบอนุญาตประกอบกิจการโรงงานแปรรูปสมุนไพรควบคุม (กรณีมีกิจกรรมแปรรูป)',
        required: false,
        conditionalRequired: true,
        requiredFor: { plantTypes: ['cannabis', 'kratom'], objectives: ['PROCESSING', 'MANUFACTURING'] },
        warningText: '⚠️ กรณีมีกิจกรรมแปรรูป/ผลิต ต้องมีใบอนุญาต บท.13',
    },
    LICENSE_BT16: {
        slotId: 'license_bt16',
        name: 'แบบ บท.16 (คำขอรับใบแทนใบอนุญาต)',
        description: 'สำหรับกรณีใบอนุญาตเดิมสูญหายหรือชำรุด',
        required: false,
        conditionalRequired: true,
        requiredFor: { applicationTypes: ['REPLACEMENT'] },
        warningText: '⚠️ กรณีใบอนุญาตสูญหาย/ชำรุด ต้องแนบแบบ บท.16',
    },

    // Current PT codes (ภท. - official DTAM license forms)
    // Ref: https://herbctrl.dtam.moph.go.th
    // ใบอนุญาตที่ออกให้แล้วซึ่งรองรับวัตถุประสงค์ของคำขอ — หนึ่งใบอนุญาตหนึ่งช่อง ชื่อและรหัสมาจาก
    // shared/certification-purposes.js (มติ operator 2026-10-05) · บังคับเมื่อเลือกวัตถุประสงค์นั้น
    // และพืชเป็นสมุนไพรควบคุม ซึ่งตัดสินที่ application-requirements-service ไม่ใช่ที่นี่
    LICENCE_PT09: licenceSlot('RESEARCH'),
    LICENCE_PT10: licenceSlot('EXPORT'),
    LICENCE_PT11: licenceSlot('PROCESSING'),
    // กระท่อมส่งออก: ใบอนุญาตตามมาตรา 10 พ.ร.บ.พืชกระท่อม พ.ศ. 2565 — ไม่มีเลขแบบ ภ.ท. (ภ.ท. เป็นของกัญชา)
    // และไม่พบเลขแบบของใบนี้ จึงไม่ตั้งเลขให้ (มติ operator 2026-10-05)
    KRATOM_EXPORT_LICENCE: {
        slotId: KRATOM_EXPORT_LICENCE_SLOT_ID,
        name: 'ใบอนุญาตส่งออกพืชกระท่อม',
        description: 'ตัวใบอนุญาตที่ออกให้แล้ว ไม่ใช่แบบคำขอ คือใบอนุญาตตามมาตรา 10 แห่ง พ.ร.บ.พืชกระท่อม พ.ศ. 2565 ใช้กรณีเลือกวัตถุประสงค์ "ส่งออกเพื่อการค้า" สำหรับกระท่อม',
        sourceHint: 'ยื่นขอใบอนุญาตส่งออกพืชกระท่อมตามมาตรา 10 แห่ง พ.ร.บ.พืชกระท่อม พ.ศ. 2565 แล้วนำใบอนุญาตที่ออกให้แล้วมาแนบ',
    },
    LICENSE_PT12: {
        slotId: 'license_pt12',
        name: 'แบบ ภ.ท.12 (คำขอรับอนุญาตจำหน่าย/ครอบครองสมุนไพรควบคุม)',
        description: 'แบบคำขอรับอนุญาตจำหน่าย/มีไว้ในครอบครองซึ่งสมุนไพรควบคุม (กัญชา กทล.1)',
        required: false,
        conditionalRequired: true,
        requiredFor: { plantTypes: ['cannabis'], objectives: ['POSSESSION'] },
        warningText: '⚠️ กรณีจำหน่าย/ครอบครอง ต้องยื่นแบบ ภ.ท.12',
        externalUrl: 'https://herbctrl.dtam.moph.go.th',
        status: 'STUB', // รอทีมอื่นทำฟอร์มเต็ม
    },
    LICENSE_PT13: {
        slotId: 'license_pt13',
        name: 'แบบ ภ.ท.13 (ใบอนุญาตแปรรูปสมุนไพรควบคุม)',
        description: 'ใบอนุญาตประกอบกิจการโรงงานแปรรูปสมุนไพรควบคุม (กรณีมีกิจกรรมแปรรูป)',
        required: false,
        conditionalRequired: true,
        requiredFor: { plantTypes: ['cannabis', 'kratom'], objectives: ['PROCESSING', 'MANUFACTURING'] },
        warningText: '⚠️ กรณีมีกิจกรรมแปรรูป/ผลิต ต้องมีใบอนุญาต ภ.ท.13',
    },
    LICENSE_PT16: {
        slotId: 'license_pt16',
        name: 'แบบ ภ.ท.16 (คำขอรับใบแทนใบอนุญาต)',
        description: 'สำหรับกรณีใบอนุญาตเดิมสูญหายหรือชำรุด',
        required: false,
        conditionalRequired: true,
        requiredFor: { applicationTypes: ['REPLACEMENT'] },
        warningText: '⚠️ กรณีใบอนุญาตสูญหาย/ชำรุด ต้องแนบแบบ ภ.ท.16',
    },

    // ===== เอกสารที่ดิน =====
    LAND_DEED: {
        slotId: 'land_deed',
        name: 'โฉนดที่ดิน / น.ส.3 / น.ส.4',
        description: 'สำเนาเอกสารสิทธิ์ที่ดิน',
        required: true,
    },
    LAND_LEASE: {
        slotId: 'land_lease',
        name: 'สัญญาเช่าที่ดิน',
        description: 'สัญญาเช่า (กรณีเช่าที่ดิน)',
        required: false,
    },

    // ===== เอกสารบุคคล/นิติบุคคล =====
    ID_CARD: {
        slotId: 'id_card',
        name: 'สำเนาบัตรประชาชน',
        description: 'ผู้ยื่นขอหรือผู้มีอำนาจลงนาม',
        required: true,
    },
    HOUSE_REG: {
        slotId: 'house_reg',
        name: 'สำเนาทะเบียนบ้าน',
        description: 'ทะเบียนบ้านผู้ยื่นขอ',
        required: true,
    },
    COMPANY_REG: {
        slotId: 'company_reg',
        name: 'หนังสือรับรองบริษัท',
        description: 'กรณีนิติบุคคล (อายุไม่เกิน 6 เดือน)',
        required: false,
        conditionalRequired: true,
        requiredFor: { applicantTypes: ['JURISTIC', 'COMMUNITY_ENTERPRISE'] },
    },
    // NEW: DTAM Required Documents
    CRIMINAL_BG: {
        slotId: 'criminal_bg',
        name: 'ผลตรวจสอบประวัติอาชญากรรม',
        description: 'ใบรับรองความประพฤติจาก สตช. (อายุไม่เกิน 3 เดือน)',
        required: true,
        warningText: '⚠️ GACP Thaiกำหนดให้ต้องมีผลตรวจประวัติอาชญากรรม',
    },
    LAND_CONSENT: {
        slotId: 'land_consent',
        name: 'หนังสือยินยอมให้ใช้ที่ดิน',
        description: 'กรณีใช้ที่ดินของผู้อื่น (ไม่ใช่เจ้าของ/ไม่ใช่เช่า)',
        required: false,
        conditionalRequired: true,
        requiredFor: { landOwnership: ['permitted_use'] },
    },
    GOV_SUPPORT: {
        slotId: 'gov_support',
        name: 'หนังสือสนับสนุนจากหน่วยงาน',
        description: 'กรณีวิสาหกิจชุมชน/บุคคลธรรมดาบางกรณี',
        required: false,
        conditionalRequired: true,
        requiredFor: { applicantTypes: ['COMMUNITY_ENTERPRISE'] },
    },

    // ===== เอกสาร SOP =====
    SOP_CULTIVATION: {
        slotId: 'sop_cultivation',
        name: 'SOP การปลูก',
        description: 'มาตรฐานการปฏิบัติงานด้านการปลูก',
        required: true,
    },
    SOP_HARVEST: {
        slotId: 'sop_harvest',
        name: 'SOP การเก็บเกี่ยว',
        description: 'มาตรฐานการเก็บเกี่ยว',
        required: true,
    },
    SOP_PROCESSING: {
        slotId: 'sop_processing',
        name: 'SOP การแปรรูป',
        description: 'มาตรฐานการแปรรูป (ถ้ามี)',
        required: false,
    },
    SOP_STORAGE: {
        slotId: 'sop_storage',
        name: 'SOP การเก็บรักษา',
        description: 'มาตรฐานการเก็บรักษาผลผลิต',
        required: true,
    },
    SOP_PEST: {
        slotId: 'sop_pest',
        name: 'SOP การจัดการศัตรูพืช',
        description: 'การควบคุมศัตรูพืช/โรค',
        required: true,
    },

    // ===== แผนผัง =====
    SITE_MAP: {
        slotId: 'site_map',
        name: 'แผนผังแปลงปลูก',
        description: 'แผนที่/แผนผังพื้นที่ปลูก',
        required: true,
    },
    FACILITY_MAP: {
        slotId: 'facility_map',
        name: 'แผนผังอาคาร',
        description: 'แผนผังอาคารแปรรูป/เก็บ (ถ้ามี)',
        required: false,
    },

    // ===== รูปถ่าย (แยกหมวด) =====
    PHOTOS_EXTERIOR: {
        slotId: 'photos_exterior',
        name: 'ภาพถ่ายภายนอก',
        description: 'ภาพถ่ายพื้นที่ภายนอก/แปลงปลูก',
        required: true,
        category: 'photos',
    },
    PHOTOS_INTERIOR: {
        slotId: 'photos_interior',
        name: 'ภาพถ่ายภายใน',
        description: 'ภาพถ่ายภายในอาคาร/โรงเรือน',
        required: false,
        category: 'photos',
    },
    PHOTOS_STORAGE: {
        slotId: 'photos_storage',
        name: 'ภาพถ่ายคลังเก็บ',
        description: 'ภาพถ่ายพื้นที่เก็บรักษาผลผลิต',
        required: false,
        category: 'photos',
    },
    PHOTOS_SIGNAGE: {
        slotId: 'photos_signage',
        name: 'ภาพถ่ายป้าย',
        description: 'ป้ายชื่อสถานที่/ป้ายเตือน/ป้ายความปลอดภัย',
        required: true,
        category: 'photos',
    },
    // Legacy photo slot (for backward compatibility)
    PHOTOS_SITE: {
        slotId: 'photos_site',
        name: 'ภาพถ่ายพื้นที่ (รวม)',
        description: 'ภาพถ่ายแปลงปลูกปัจจุบัน (deprecated - ใช้ photos แยกหมวดแทน)',
        required: false,
        deprecated: true,
    },

    // ===== เอกสารนิติบุคคล (เพิ่มเติม) =====
    COMMUNITY_CERT: {
        slotId: 'community_cert',
        name: 'หนังสือจดทะเบียนวิสาหกิจชุมชน',
        description: 'สำเนาหนังสือสำคัญแสดงการจดทะเบียน',
        required: false,
        conditionalRequired: true,
        requiredFor: { applicantTypes: ['COMMUNITY_ENTERPRISE'] },
    },
    COOP_CERT: {
        slotId: 'coop_cert',
        name: 'หนังสือสำคัญสหกรณ์การเกษตร',
        description: 'สำเนาหนังสือสำคัญสหกรณ์',
        required: false,
        conditionalRequired: true,
        requiredFor: { applicantTypes: ['AGRICULTURAL_COOP'] },
    },

    // ===== เอกสาร Renewal =====
    RENEWAL_REPORT: {
        slotId: 'renewal_report',
        name: 'รายงานผลการดำเนินการ',
        description: 'รายงานผลการดำเนินการที่ผ่านมา (สำหรับขอต่ออายุ)',
        required: false,
        conditionalRequired: true,
        requiredFor: { applicationTypes: ['RENEWAL'] },
    },
    PREVIOUS_CERT: {
        slotId: 'previous_cert',
        name: 'ใบรับรอง GACP เดิม',
        description: 'สำเนาใบรับรอง GACP ที่หมดอายุ (สำหรับขอต่ออายุ)',
        required: false,
        conditionalRequired: true,
        requiredFor: { applicationTypes: ['RENEWAL'] },
    },

    // ===== แบบฟอร์ม GACP (ตาม DTAM) =====
    FORM_GACP_APPLICATION: {
        slotId: 'form_gacp_application',
        name: 'แบบคำขอรับรอง GACP',
        description: 'แบบยื่นคำขอรับรองมาตรฐาน GACP ระบบจะ generate อัตโนมัติจากข้อมูลที่กรอก',
        required: true,
        autoGenerated: true, // ระบบ generate จาก wizard data
    },
    FORM_FARM_SUMMARY: {
        slotId: 'form_farm_summary',
        name: 'แบบสรุปข้อมูลฟาร์ม',
        description: 'สรุปข้อมูลฟาร์ม พื้นที่ปลูก แปลง GPS ระบบจะ generate อัตโนมัติ',
        required: true,
        autoGenerated: true, // ระบบ generate จาก wizard data
    },
    FORM_SELF_ASSESSMENT: {
        slotId: 'form_self_assessment',
        name: 'แบบประเมินตนเอง (Self Assessment)',
        description: 'แบบประเมินตนเองตามเกณฑ์ GACP 14 หมวด (ตัวเลือก)',
        required: false,
    },

    // ===== Legacy FORM slots (backward compatibility) =====
    FORM_09: { slotId: 'form_09', name: 'แบบฟอร์ม 09', description: 'Alias → form_gacp_application', required: false, deprecated: true },
    FORM_10: { slotId: 'form_10', name: 'แบบฟอร์ม 10', description: 'Alias → form_farm_summary', required: false, deprecated: true },
    FORM_11: { slotId: 'form_11', name: 'แบบฟอร์ม 11', description: 'Alias → form_self_assessment', required: false, deprecated: true },

    // ===== v2 — กทล.1 canonical slots (spec 2026-09-01) =====
    //
    // ป้ายของช่องเหล่านี้ใช้กับทุกชนิดที่แพลตฟอร์มรับรอง จึงเรียก "พืช" ไม่ใช่ "กัญชา"
    // (มติ operator 2026-09-11: หกชนิด) — ข้อความเดิมลอกมาจากแบบของกัญชาโดยตรง ซึ่งอ่าน
    // แล้วจริงสำหรับกัญชา แต่ผิดเมื่อช่องเดียวกันถูกขอจากคนปลูกขิง · ความหมายไม่ได้หายไป
    // สำหรับกัญชา เพราะ "ส่วนของพืชที่เหลือ" ครอบสิ่งเดียวกัน
    //
    // The attachment list of "แบบกัญชา กทล 1" ส่วนที่ ๓, as the ministry writes it,
    // is the whole required set (operator ruling 1, 2026-09-01). The rows above
    // grew a different set: seven spellings of ภท.11, four of the land document,
    // one photo slot per wizard step. A farmer was asked twice for one paper, and
    // the officer's checklist could not be read against the form it comes from.
    //
    // Three things are deliberate here:
    //
    //   1. NO `required` / `requiredFor` field. Which of these a case must attach
    //      is decided by `requirement_rules` (the dated, append-only engine), not
    //      by a constant a deploy can change. A flag here would be a second
    //      answer to a question the engine already owns, and the two would drift.
    //   2. `sourceHint` is a NEW field and is the point of the block: "หาได้ที่ไหน".
    //      Every counter clerk gets asked this and the platform never answered it,
    //      so a farmer who owns the land still could not tell which of the four
    //      land papers to bring. It names a place and an action, never an enum.
    //   3. The old rows are left standing. Documents already uploaded carry the
    //      old ids, and the alias fold in @gacp/validation/upload-rules is what
    //      makes them keep counting; deleting the rows is a separate, later step
    //      once nothing reads them.

    // ── กทล.1 ส่วนที่ ๓ A1-A8: what every case attaches, by its case ──────────
    LAND_RIGHTS: {
        slotId: 'land_rights',
        name: 'สำเนาเอกสารสิทธิ์ที่ดิน หรือหนังสืออนุญาตใช้ที่ดินของรัฐ',
        description: 'หลักฐานแสดงกรรมสิทธิ์หรือสิทธิครอบครองที่ดินที่ใช้ปลูกหรือแปรรูป เช่น โฉนด น.ส.3 น.ส.3 ก. ส.ป.ก. หรือหนังสืออนุญาตให้ใช้ที่ดินของรัฐ',
        sourceHint: 'ขอคัดสำเนาโฉนดหรือหนังสือแสดงสิทธิได้ที่สำนักงานที่ดินจังหวัดหรือสาขาที่ที่ดินตั้งอยู่ ถ้าเป็นที่ดิน ส.ป.ก. ขอได้ที่สำนักงานการปฏิรูปที่ดินจังหวัด',
    },
    LANDLORD_CONSENT: {
        slotId: 'landlord_consent',
        name: 'หนังสือยินยอมจากผู้ให้เช่าหรือผู้ให้ใช้ที่ดิน',
        description: 'ใช้เฉพาะกรณีเช่าที่ดินหรือขอใช้ที่ดินของผู้อื่น ต้องระบุแปลงที่ยินยอมให้ใช้และมีลายมือชื่อเจ้าของที่ดิน',
        sourceHint: 'ให้เจ้าของที่ดินหรือผู้ให้เช่าลงนามในหนังสือยินยอม แล้วแนบสำเนาบัตรประจำตัวประชาชนของผู้ยินยอมที่เซ็นรับรองสำเนาถูกต้อง',
    },
    SITE_MAP_COORDS: {
        slotId: 'site_map_coords',
        name: 'แผนที่แสดงที่ตั้ง พิกัด เส้นทางเข้าถึง ขนาดแปลง และสิ่งปลูกสร้างใกล้เคียง',
        description: 'แผนที่ของแปลงปลูกหรือสถานที่แปรรูป ที่อ่านแล้วเดินทางไปถึงได้จริงในวันตรวจ',
        sourceHint: 'จัดทำเองได้ โดยจับค่าพิกัดจากแอปแผนที่ในโทรศัพท์ตรงกลางแปลง แล้ววาดผังพร้อมเขียนพิกัด ขนาดแปลง และเส้นทางเข้าถึงกำกับไว้',
    },
    BUILDING_PLAN_PHOTOS: {
        slotId: 'building_plan_photos',
        name: 'แบบแปลนอาคารหรือโรงเรือน พร้อมภาพถ่ายภายนอกและภายใน',
        description: 'ใช้เฉพาะพื้นที่แบบอาคารหรือโรงเรือนระบบปิด และโรงเรือนทั่วไป',
        sourceHint: 'ใช้แบบแปลนชุดที่ยื่นขออนุญาตก่อสร้างไว้กับองค์กรปกครองส่วนท้องถิ่น หรือวาดผังอาคารพร้อมระบุขนาดเอง แล้วถ่ายภาพภายนอกและภายในรวมไว้ในไฟล์เดียวกัน',
    },
    FIELD_SURROUND_PHOTOS: {
        slotId: 'field_surround_photos',
        name: 'ภาพถ่ายแปลงปลูกและบริเวณโดยรอบ',
        description: 'ใช้เฉพาะพื้นที่ปลูกกลางแจ้ง ให้เห็นทั้งแปลงปลูกและสภาพแวดล้อมที่อยู่ติดกัน',
        sourceHint: 'ถ่ายเองที่แปลงในเวลากลางวัน ให้เห็นแปลงปลูกและพื้นที่ติดกันครบทั้งสี่ด้าน',
    },
    PRODUCTION_UTIL_PLAN: {
        slotId: 'production_util_plan',
        name: 'แผนการผลิต (ปลูก) และแผนการใช้ประโยชน์หรือแปรรูป',
        description: 'รอบการปลูกต่อปี ปริมาณที่คาดว่าจะได้ และแผนนำผลผลิตไปใช้ประโยชน์หรือแปรรูป',
        sourceHint: 'เขียนเองจากแผนงานที่คุณวางไว้จริง ระบุรอบปลูก ปริมาณต่อรอบ และปลายทางของผลผลิตแต่ละส่วน',
    },
    SECURITY_RESIDUE_PLAN: {
        slotId: 'security_residue_plan',
        name: 'มาตรการรักษาความปลอดภัย และวิธีนำส่วนของพืชที่เหลือไปใช้ประโยชน์',
        description: 'วิธีป้องกันการเข้าถึงพื้นที่ปลูกหรือที่เก็บผลผลิต และวิธีจัดการส่วนของพืชที่เหลือจากการผลิต',
        sourceHint: 'เขียนเองจากสิ่งที่ทำจริงในพื้นที่ เช่น รั้ว ประตูล็อก กล้องวงจรปิด ทะเบียนผู้เข้าออก และวิธีจัดการส่วนที่เหลือของต้น',
    },
    SITE_PHOTOS: {
        slotId: 'site_photos',
        name: 'รูปถ่ายสถานที่ผลิต (ปลูก) และการเก็บเกี่ยว',
        description: 'ภาพสถานที่ปลูกและจุดที่ใช้เก็บเกี่ยว ให้เห็นสภาพการใช้งานจริง',
        sourceHint: 'ถ่ายเองในพื้นที่ ให้เห็นแปลงปลูก จุดเก็บเกี่ยว และที่พักผลผลิต ถ่ายในเวลากลางวันที่แสงพอมองเห็นรายละเอียด',
    },
    SOP_MANUAL: {
        slotId: 'sop_manual',
        name: 'คู่มือมาตรฐานการปฏิบัติงาน (SOP)',
        description: 'ขั้นตอนการทำงานตั้งแต่เตรียมพื้นที่ ปลูก ดูแล เก็บเกี่ยว จนถึงเก็บรักษาและแปรรูป',
        sourceHint: 'เขียนจากขั้นตอนที่คุณทำจริง โดยใช้หัวข้อตามข้อกำหนดของกรมการแพทย์แผนไทยและการแพทย์ทางเลือกเป็นโครง แล้วรวมเป็นไฟล์เดียว',
    },

    // ── ส่วนสำหรับเจ้าหน้าที่ (ท้าย กทล.1) ข้อ 1.1: ใบอนุญาตตัวจริง ไม่ใช่แบบคำขอ ──
    // กัญชาเท่านั้น และ "ไม่บังคับ" — ไม่มีใบอนุญาตปลูกกัญชาตามกฎหมายที่ใช้บังคับ มีเพียงการแจ้งปลูกในระบบ
    // "ปลูกกัญ" และรายการแนบของคำขอ ภ.ท. ก็ระบุใบอนุญาตปลูกว่า "(ถ้ามี)" · เอนจินแสดงช่องนี้แบบไม่บล็อก
    // (application-requirements-service OPTIONAL_FOR_CANNABIS_PLANTING) · ใต้ certScope=PROCESSING ช่อง id เดียวกัน
    // ไม่ใช้แล้ว — การแปรรูปขอ licence_pt11 แทน
    CONTROLLED_HERB_LICENSE: {
        slotId: 'controlled_herb_license',
        name: 'ใบอนุญาตปลูกหรือหลักฐานการแจ้งปลูก (ถ้ามี)',
        description: 'ถ้ามีใบอนุญาตปลูกหรือหลักฐานการแจ้งปลูกกัญชาในระบบ "ปลูกกัญ" แนบไว้ได้ ไม่แนบก็ยื่นคำขอได้',
        sourceHint: 'ใบอนุญาตปลูกที่ออกให้แล้ว หรือหน้าจอ/ใบยืนยันการแจ้งปลูกจากระบบ "ปลูกกัญ" ของ อย. ถ้าคุณมี',
    },

    // ── กลุ่มคุณสมบัติผู้ยื่น (ตามประเภทผู้ขอ) ────────────────────────────────
    ID_HOUSE_REG: {
        slotId: 'id_house_reg',
        name: 'สำเนาบัตรประจำตัวประชาชนและสำเนาทะเบียนบ้านของผู้ยื่นคำขอ',
        description: 'กรณีวิสาหกิจชุมชนใช้ของประธาน กรณีนิติบุคคลใช้ของผู้มีอำนาจลงนาม รวมสองอย่างไว้ในไฟล์เดียว',
        sourceHint: 'ถ่ายสำเนาบัตรประชาชนและทะเบียนบ้านของคุณเอง แล้วเซ็นรับรองสำเนาถูกต้อง ถ้าทะเบียนบ้านหาย ขอคัดสำเนาได้ที่สำนักทะเบียนอำเภอหรือสำนักงานเขต',
    },
    COMMUNITY_REG_MEMBERS: {
        slotId: 'community_reg_members',
        name: 'สำเนาหนังสือจดทะเบียนวิสาหกิจชุมชน พร้อมบัญชีรายชื่อสมาชิก',
        description: 'ต้องมีสถานะยังดำเนินกิจการ วัตถุประสงค์สอดคล้องกับการปลูกหรือแปรรูปพืชที่ขอรับรอง และแนบบัญชีรายชื่อสมาชิกมาด้วย',
        sourceHint: 'ขอคัดสำเนาหนังสือสำคัญแสดงการจดทะเบียนวิสาหกิจชุมชนและบัญชีรายชื่อสมาชิกได้ที่สำนักงานเกษตรอำเภอที่คุณจดทะเบียนไว้',
    },
    COMMUNITY_ASSIGNMENT: {
        slotId: 'community_assignment',
        name: 'หนังสือแสดงว่าผู้ยื่นได้รับมอบหมายให้ดำเนินกิจการแทนวิสาหกิจชุมชน',
        description: 'เอกสารคุณสมบัติของวิสาหกิจชุมชนตาม กทล.1 ไม่ใช่การมอบอำนาจให้ผู้อื่นยื่นคำขอแทนคุณ',
        sourceHint: 'ให้ที่ประชุมสมาชิกวิสาหกิจชุมชนมีมติมอบหมาย แล้วออกหนังสือลงนามโดยประธาน พร้อมแนบสำเนารายงานการประชุมครั้งนั้น',
    },
    PRODUCER_SUPERVISION_LETTER: {
        slotId: 'producer_supervision_letter',
        name: 'หนังสือแสดงการดำเนินการภายใต้ความร่วมมือและการกำกับดูแลของผู้รับอนุญาตผลิตยาหรือผลิตภัณฑ์สมุนไพร',
        description: 'ใช้กรณีผู้ยื่นเป็นบุคคลธรรมดา ผู้รับอนุญาตอาจเป็นผู้ผลิตยาแผนปัจจุบัน ยาแผนโบราณ หรือผลิตภัณฑ์สมุนไพร',
        sourceHint: 'ติดต่อผู้รับอนุญาตผลิตที่คุณร่วมงานด้วย ให้ออกหนังสือรับรองความร่วมมือและการกำกับดูแล แล้วแนบสำเนาใบอนุญาตผลิตของผู้รับอนุญาตรายนั้นไปพร้อมกัน',
    },
    JURISTIC_REG_6M: {
        slotId: 'juristic_reg_6m',
        name: 'สำเนาหนังสือรับรองการจดทะเบียนนิติบุคคล (ออกให้ไม่เกิน 6 เดือน)',
        description: 'ใช้ได้ทั้งบริษัท ห้างหุ้นส่วน วิสาหกิจเพื่อสังคม หรือสหกรณ์การเกษตร พร้อมบัญชีรายชื่อกรรมการ หุ้นส่วน หรือสมาชิก',
        sourceHint: 'ขอหนังสือรับรองได้ที่กรมพัฒนาธุรกิจการค้าหรือสำนักงานพาณิชย์จังหวัด ส่วนสหกรณ์ขอได้ที่สำนักงานสหกรณ์จังหวัด และต้องเป็นฉบับที่ออกให้ไม่เกิน 6 เดือน',
    },
    JURISTIC_AUTHORITY: {
        slotId: 'juristic_authority',
        name: 'หนังสือแสดงว่าผู้ยื่นเป็นผู้แทนหรือผู้มีอำนาจทำการแทนนิติบุคคล',
        description: 'เช่น หนังสือมอบอำนาจ หรือบัญชีรายชื่อกรรมการที่ระบุผู้มีอำนาจลงนาม',
        sourceHint: 'ให้กรรมการผู้มีอำนาจลงนามตามหนังสือรับรองนิติบุคคลออกหนังสือมอบอำนาจ ติดอากรแสตมป์ตามที่กฎหมายกำหนด แล้วแนบสำเนาบัตรประจำตัวประชาชนของทั้งผู้มอบและผู้รับมอบ',
    },

    // ── กรณีต่ออายุ ────────────────────────────────────────────────────────────
    PREV_CERT_ORIGINAL: {
        slotId: 'prev_cert_original',
        name: 'ต้นฉบับใบรับรองเดิม',
        description: 'ใบรับรอง GACP ฉบับที่กำลังขอต่ออายุ',
        sourceHint: 'ถ้าใบรับรองออกจากระบบนี้ ให้เปิดจากเมนูใบรับรองของคุณแล้วอัปโหลดไฟล์เดิม จากนั้นเตรียมต้นฉบับไว้แสดงต่อเจ้าหน้าที่ในวันตรวจ',
    },
    RENEWAL_PLAN: {
        slotId: 'renewal_plan',
        name: 'แผนการปลูกและเก็บเกี่ยว หรือแผนการแปรรูป',
        description: 'แผนของรอบใบรับรองใหม่ที่ขอต่ออายุ',
        sourceHint: 'เขียนเองจากแผนรอบถัดไป โดยปรับจากแผนที่ยื่นไว้ครั้งก่อนให้ตรงกับพื้นที่และปริมาณที่จะทำจริง',
    },
    RENEWAL_UTIL_PLAN: {
        slotId: 'renewal_util_plan',
        name: 'แผนการใช้ประโยชน์',
        description: 'ปลายทางของผลผลิตในรอบใบรับรองใหม่ที่ขอต่ออายุ',
        sourceHint: 'เขียนเองว่าผลผลิตแต่ละส่วนจะส่งให้ใครหรือใช้ทำอะไร ถ้ามีคู่สัญญารับซื้อ ให้ระบุชื่อผู้รับซื้อไว้ด้วย',
    },
    OPERATION_SUMMARY_REPORT: {
        slotId: 'operation_summary_report',
        name: 'รายงานสรุปผลการดำเนินการที่ผ่านมา',
        description: 'สรุปผลของรอบใบรับรองเดิม ทั้งปริมาณที่ผลิตได้และการนำไปใช้ประโยชน์',
        sourceHint: 'สรุปเองจากบันทึกกิจกรรมแปลงปลูก บันทึกการเก็บเกี่ยว และบันทึกการขายผลผลิตในรอบใบรับรองที่ผ่านมา',
    },

    // ── กรณีขอใบแทน ───────────────────────────────────────────────────────────
    POLICE_REPORT: {
        slotId: 'police_report',
        name: 'ใบแจ้งความ (กรณีใบรับรองสูญหาย)',
        description: 'หลักฐานการแจ้งความว่าใบรับรองฉบับเดิมสูญหาย',
        sourceHint: 'แจ้งความเอกสารหายที่สถานีตำรวจท้องที่ แล้วขอสำเนาบันทึกประจำวันที่มีลายมือชื่อพนักงานสอบสวนมาแนบ',
    },
    DAMAGED_CERT: {
        slotId: 'damaged_cert',
        name: 'ใบรับรองเดิม (กรณีถูกทำลายหรือลบเลือน)',
        description: 'ใบรับรองฉบับที่ชำรุด ใช้แทนใบแจ้งความเมื่อใบรับรองยังอยู่แต่ใช้การไม่ได้',
        sourceHint: 'ถ่ายภาพหรือสแกนใบรับรองฉบับที่ชำรุดให้เห็นเลขที่ใบรับรอง แล้วเตรียมตัวจริงส่งคืนกรมพร้อมคำขอใบแทน',
    },

    // ── ไม่ใช่เอกสารบังคับตอนยื่น (ข้อกำหนดข้อ 2 และขั้นตอนตรวจข้อ 4-5) ────────
    // กรมโดยปกติไม่ตรวจแล็บ ยกเว้นพบความเสี่ยงปนเปื้อน จึงเป็นช่องเสริม ไม่นับความครบถ้วน
    WATER_TEST: {
        slotId: 'water_test',
        name: 'ผลตรวจคุณภาพน้ำ',
        description: 'ไม่ใช่เอกสารบังคับตอนยื่น แนบได้เมื่อคุณมีผลตรวจอยู่แล้ว หรือเมื่อเจ้าหน้าที่ขอเพิ่มเพราะพบความเสี่ยงปนเปื้อน',
        sourceHint: 'ส่งตัวอย่างน้ำที่ใช้ในแปลงให้ห้องปฏิบัติการที่ได้รับการรับรอง แล้วนำรายงานผลที่มีเลขที่รายงานและวันที่ตรวจมาแนบ',
    },
    SOIL_TEST: {
        slotId: 'soil_test',
        name: 'ผลตรวจคุณภาพดิน',
        description: 'ไม่ใช่เอกสารบังคับตอนยื่น แนบได้เมื่อคุณมีผลตรวจอยู่แล้ว หรือเมื่อเจ้าหน้าที่ขอเพิ่มเพราะพบความเสี่ยงปนเปื้อน',
        sourceHint: 'เก็บตัวอย่างดินจากแปลงส่งห้องปฏิบัติการที่ได้รับการรับรอง แล้วนำรายงานผลที่มีเลขที่รายงานและวันที่ตรวจมาแนบ',
    },
    ADDITIONAL_DOCS: {
        slotId: 'additional_docs',
        name: 'เอกสารเพิ่มเติมอื่น ๆ',
        description: 'ใช้แนบเอกสารที่เจ้าหน้าที่ขอเพิ่มเป็นรายการ หรือรายละเอียดพันธุ์และส่วนของพืชที่เกินสองส่วนตาม กทล.1 ส่วนที่ ๒',
        sourceHint: 'ดูรายการที่เจ้าหน้าที่ระบุไว้ในคำขอเอกสารเพิ่มเติมของคำขอนี้ แล้วอัปโหลดเฉพาะเอกสารตามรายการนั้น',
    },
};

// Get all required slots for a plant type
const getRequiredSlots = (plantType = 'general') => {
    return Object.values(DOCUMENT_SLOTS).filter(slot => {
        if (!slot.required) { return false; }
        if (slot.requiredFor?.plantTypes && !slot.requiredFor.plantTypes.includes(plantType?.toLowerCase())) { return false; }
        return true;
    });
};

// Get all slot IDs
const getAllSlotIds = () => Object.values(DOCUMENT_SLOTS).map(s => s.slotId);

// Check if license is required for plant type
const requiresLicense = (plantType) => {
    return ['cannabis', 'kratom'].includes(plantType?.toLowerCase());
};

/**
 * Get required documents based on selections
 * @param {Object} options - { plantType, objectives, applicantType, landOwnership, applicationType }
 * @returns {Array} List of required document slots
 */
const getRequiredDocuments = (options = {}) => {
    const {
        plantType = 'general',
        objectives = [],
        applicantType = 'INDIVIDUAL',
        landOwnership = 'owned',
        applicationType = 'NEW',
    } = options;
    const required = [];

    for (const [key, slot] of Object.entries(DOCUMENT_SLOTS)) {
        let isRequired = slot.required === true;

        // Check plant-type specific requirements
        if (slot.requiredFor?.plantTypes) {
            const plant = plantType?.toLowerCase();
            if (slot.requiredFor.plantTypes.includes(plant)) {
                isRequired = true;
            }
        }

        // Check objective-specific requirements (conditional)
        if (slot.conditionalRequired && slot.requiredFor?.objectives) {
            const matchingObjective = slot.requiredFor.objectives.some(obj =>
                objectives.includes(obj) || objectives.includes(obj.toUpperCase()),
            );
            if (matchingObjective) {
                isRequired = true;
            }
        }

        // Check applicant type specific
        if (slot.conditionalRequired && slot.requiredFor?.applicantTypes) {
            if (slot.requiredFor.applicantTypes.includes(applicantType)) {
                isRequired = true;
            }
        }

        // Check land ownership specific (LAND_CONSENT for permitted_use)
        if (slot.conditionalRequired && slot.requiredFor?.landOwnership) {
            if (slot.requiredFor.landOwnership.includes(landOwnership)) {
                isRequired = true;
            }
        }

        // Check application type specific (RENEWAL documents)
        if (slot.conditionalRequired && slot.requiredFor?.applicationTypes) {
            if (slot.requiredFor.applicationTypes.includes(applicationType)) {
                isRequired = true;
            }
        }

        // Legacy check for company registration
        if (key === 'COMPANY_REG' && applicantType === 'JURISTIC') {
            isRequired = true;
        }

        if (isRequired) {
            required.push({
                ...slot,
                isRequired: true,
                key,
            });
        }
    }

    return required;
};

module.exports = {
    DOCUMENT_SLOTS,
    getRequiredSlots,
    getAllSlotIds,
    requiresLicense,
    getRequiredDocuments,
};


