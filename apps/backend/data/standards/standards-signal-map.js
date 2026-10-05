'use strict';

/**
 * Signal map: StandardRequirement → สัญญาณจริงบนแพลตฟอร์ม
 * (สัญญา C05F680149 ต้นแบบที่ 1 — ระบบวิเคราะห์มาตรฐาน GACP 3 ระบบ)
 *
 * Key = `${CertificationStandard.code}:${StandardRequirement.name}` — requirement
 * names are stable seed content (prisma/seed-standards.js). A requirement with
 * no entry here is evaluated as NEEDS_REVIEW (expert/onsite assessment), never
 * NOT_MET — the engine only asserts a gap when it positively knows the
 * evidence class is absent.
 *
 * Signal fields (evaluated by standards-analyzer-service in this precedence):
 *   platform        — capability the platform itself provides to every farm
 *                     (e.g. batch traceability via QR chain) → MET
 *   docs[]          — ApplicationDocument.documentType values (canonical slot
 *                     ids upper-cased, see constants/document-slots.js) that
 *                     constitute PRIMARY evidence → MET
 *   certifiedStates — true → workflow states AUDIT_PASSED/APPROVED/CERTIFIED
 *                     count as onsite verification → MET (23-item onsite
 *                     checklist ครอบหมวดนี้)
 *   docsSecondary[] — supporting documents that indicate progress but are not
 *                     primary evidence → NEEDS_REVIEW
 *   form[]          — canonical formData paths (dot paths; `plots[].x` = any
 *                     element) → NEEDS_REVIEW
 *   recommendation  — Thai guidance shown when the requirement lands NOT_MET
 */

const SIGNAL_MAP = {
    // ── WHO GACP (v2003) ─────────────────────────────────────────────
    'WHO:Heavy Metals Analysis': {
        docs: ['LAB_CERTIFICATE'],
        recommendation: 'ส่งตัวอย่างผลผลิต/ดิน/น้ำตรวจวิเคราะห์โลหะหนักกับห้องปฏิบัติการที่ได้รับการรับรอง แล้วแนบใบรายงานผล (lab certificate) ในคำขอ เกณฑ์ WHO: As < 4.0, Cd < 0.3, Pb < 10.0, Hg < 0.5 ppm',
    },
    'WHO:Pesticide Residues': {
        docs: ['LAB_CERTIFICATE'],
        docsSecondary: ['SOP_PEST'],
        recommendation: 'ตรวจวิเคราะห์สารตกค้างกำจัดศัตรูพืชกับห้องปฏิบัติการ และจัดทำ SOP การป้องกันกำจัดศัตรูพืช (IPM) สารต้องห้ามต้องตรวจไม่พบ',
    },
    'WHO:Drying Protocols': {
        docs: ['SOP_HARVEST', 'SOP_PROCESSING', 'SOP_STORAGE'],
        form: ['harvestData.dryingMethod', 'productionData.dryingMethod'],
        recommendation: 'จัดทำ SOP การตากแห้ง/การแปรรูปหลังเก็บเกี่ยวพร้อมบันทึกอุณหภูมิ-ความชื้น เพื่อป้องกันการเกิดสารพิษเชื้อรา (Aflatoxins < 20 ppb)',
    },
    'WHO:Batch Traceability': {
        platform: {
            evidence: 'แพลตฟอร์มให้การตรวจสอบย้อนกลับระดับรุ่นผลิตอัตโนมัติ: รอบปลูก → รุ่นเก็บเกี่ยว → ล็อต พร้อม QR Code ลงนามดิจิทัล (RSA) ทุกจุด',
        },
    },

    // ── Thai GACP (กรมการแพทย์แผนไทยฯ / อย.) ─────────────────────────
    'THAI_GACP:Farm Registration': {
        docs: ['GOV_SUPPORT'],
        docsSecondary: ['LAND_DEED', 'LAND_LEASE', 'LAND_CONSENT'],
        form: ['farmData.farmName'],
        recommendation: 'ลงทะเบียนเกษตรกรกับสำนักงานเกษตรอำเภอ/กรมส่งเสริมการเกษตร แล้วแนบหนังสือรับรองในคำขอ',
    },
    'THAI_GACP:GAP Guidelines': {
        docs: ['FORM_SELF_ASSESSMENT'],
        docsSecondary: ['SITE_MAP', 'FACILITY_MAP'],
        form: ['farmData.waterSource'],
        certifiedStates: true,
        recommendation: 'ประเมินตนเองตามแนวทาง GAP (การเลือกพื้นที่/แหล่งน้ำ) และแนบแบบประเมินตนเอง พร้อมแผนผังแปลง',
    },

    // ── ASEAN GHP (v2021) ────────────────────────────────────────────
    'ASEAN:Health & Hygiene Training': {
        certifiedStates: true,
        docsSecondary: ['SOP_CULTIVATION'],
        recommendation: 'จัดอบรมสุขอนามัยบุคลากรประจำปีและเก็บบันทึกการอบรม ผู้ตรวจประเมินจะตรวจสอบ ณ แปลง',
    },
    'ASEAN:Pest Control System': {
        docs: ['SOP_PEST'],
        recommendation: 'จัดทำโปรแกรมควบคุมสัตว์พาหะเป็นเอกสาร (แผนผังจุดวางเหยื่อ + บันทึกการติดตาม) แนบเป็น SOP การป้องกันกำจัดศัตรูพืช',
    },
    'ASEAN:Waste Management': {
        certifiedStates: true,
        docsSecondary: ['SOP_PROCESSING', 'SOP_STORAGE'],
        recommendation: 'แยกและกำจัดของเสียอินทรีย์/อนินทรีย์ให้ห่างจากพื้นที่ผลิต ผู้ตรวจประเมินจะตรวจสอบ ณ แปลง',
    },
    'ASEAN:Cleaning Records': {
        certifiedStates: true,
        docsSecondary: ['SOP_STORAGE'],
        recommendation: 'บันทึกการทำความสะอาดอุปกรณ์/สถานที่ประจำวัน ใช้สมุดบันทึกกิจกรรมการเพาะปลูกบนแพลตฟอร์มได้',
    },

    // ── US FDA (21 CFR Part 111 / FSMA) ──────────────────────────────
    'FDA:Food Safety Plan (HACCP)': {
        docsSecondary: ['SOP_PROCESSING', 'SOP_STORAGE', 'SOP_HARVEST'],
        recommendation: 'จัดทำแผนความปลอดภัยอาหาร (HACCP) เป็นลายลักษณ์อักษร ครอบคลุมการวิเคราะห์อันตรายและจุดควบคุมวิกฤต',
    },
    'FDA:Sanitary Facilities': {
        certifiedStates: true,
        docsSecondary: ['PHOTOS_INTERIOR', 'FACILITY_MAP'],
        recommendation: 'จัดให้มีห้องน้ำและจุดล้างมือแยกจากพื้นที่ผลิต ผู้ตรวจประเมินจะตรวจสอบ ณ สถานที่',
    },
    'FDA:Water Quality': {
        docs: ['LAB_CERTIFICATE'],
        form: ['farmData.waterSource'],
        recommendation: 'ตรวจคุณภาพน้ำที่ใช้รดและล้างผลผลิตตามเกณฑ์จุลชีววิทยา (E. coli) กับห้องปฏิบัติการ แล้วแนบผล',
    },
    'FDA:Foreign Supplier Verification Program (FSVP)': {
        recommendation: 'เฉพาะผู้ส่งออกไปสหรัฐฯ: จัดเตรียมบันทึกการปฏิบัติตาม FSVP ร่วมกับผู้นำเข้าฝั่งสหรัฐฯ',
    },
};

module.exports = { SIGNAL_MAP };
