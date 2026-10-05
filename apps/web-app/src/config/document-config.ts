import { PURPOSE_CODES, purposeOptionLabel } from '@/lib/certification-purposes';

/**
 * Document Configuration — Data-driven, zero hardcoded values in components.
 * All organizational info, labels, and section definitions live here.
 */

/* ================================================================
   Organization Info
   ================================================================ */

export interface OrganizationConfig {
    ministry: string;
    department: string;
    division: string;
    address: string;
    phone: string;
    email: string;
    logoPath: string;
}

export const DTAM_ORG: OrganizationConfig = {
    ministry: 'GACP Thai Platform',
    department: 'ระบบรับรองมาตรฐาน GACP สมุนไพร',
    division: 'ระบบรับรองมาตรฐาน GACP สมุนไพร',
    address: '88/23 หมู่ 4 ถนนติวานนท์ ต.ตลาดขวัญ อ.เมือง จ.นนทบุรี 11000',
    phone: '(02) 5647889 หรือ 061-4219701',
    email: 'contact@gacpth.com',
    logoPath: '/images/gacpthai-logo.png',
};

/* ================================================================
   Form Labels — Reusable across all document types
   ================================================================ */

export const SERVICE_TYPE_LABELS: Record<string, string> = {
    NEW: 'ขอรับรองใหม่',
    RENEWAL: 'ต่ออายุใบรับรอง',
    MODIFY: 'แก้ไขรายละเอียดใบรับรอง',
    REPLACEMENT: 'ขอใบแทน',
};

/** Labels come from the one vocabulary (lib/certification-purposes.ts) — never retyped here. */
export const PURPOSE_LABELS: Record<string, string> = Object.fromEntries(
    PURPOSE_CODES.map((code) => [code, purposeOptionLabel(code)]),
);

export const METHOD_LABELS: Record<string, string> = {
    OUTDOOR: 'กลางแจ้ง',
    GREENHOUSE: 'โรงเรือน',
    INDOOR: 'อาคาร/โรงเรือนระบบปิด',
    outdoor: 'กลางแจ้ง',
    greenhouse: 'โรงเรือน',
    indoor: 'อาคาร/โรงเรือนระบบปิด',
};

export const APPLICANT_TYPE_LABELS: Record<string, string> = {
    INDIVIDUAL: 'บุคคลธรรมดา',
    COMMUNITY: 'วิสาหกิจชุมชน',
    JURISTIC: 'นิติบุคคล',
};

/* ================================================================
   กทล.1 Section Definitions — Official 10-section structure
   ================================================================ */

export interface SectionDefinition {
    key: string;
    title: string;
    subtitle?: string;
    /** If set, only show for these applicant types */
    applicantBranch?: ('INDIVIDUAL' | 'COMMUNITY' | 'JURISTIC')[];
}

/**
 * Official กทล.1 section order.
 * Sections S5/S7/S9 and S6/S8/S10 are conditional by applicant type.
 */
export const GACP_FORM_SECTIONS: SectionDefinition[] = [
    {
        key: 'consent',
        title: 'ส่วนที่ 1: ความยินยอมและข้อตกลง',
        subtitle: 'PDPA และยอมรับหลักเกณฑ์ GACP',
    },
    {
        key: 'request_type',
        title: 'ส่วนที่ 2: ประเภทคำขอและบริการ',
        subtitle: 'ประเภทคำขอ วัตถุประสงค์การรับรอง',
    },
    {
        key: 'crop_info',
        title: 'ส่วนที่ 3: ข้อมูลพืชสมุนไพร',
        subtitle: 'ชนิดพืช รูปแบบการปลูก',
    },
    {
        key: 'site_info',
        title: 'ส่วนที่ 4: สถานที่ปลูก/เก็บ',
        subtitle: 'ข้อมูลฟาร์ม พิกัด GPS ระบบน้ำ เอกสารสิทธิ์',
    },
    // Conditional Branch: Community Enterprise (S5)
    {
        key: 'applicant_community',
        title: 'ส่วนที่ 5: ข้อมูลวิสาหกิจชุมชน',
        subtitle: 'ชื่อวิสาหกิจ ประธาน ที่อยู่ตามทะเบียน',
        applicantBranch: ['COMMUNITY'],
    },
    // Conditional Branch: Individual (S7)
    {
        key: 'applicant_individual',
        title: 'ส่วนที่ 5: ข้อมูลผู้ยื่นคำขอ (บุคคลธรรมดา)',
        subtitle: 'ชื่อ-นามสกุล เลขบัตรประชาชน ที่อยู่',
        applicantBranch: ['INDIVIDUAL'],
    },
    // Conditional Branch: Juristic (S9)
    {
        key: 'applicant_juristic',
        title: 'ส่วนที่ 5: ข้อมูลนิติบุคคล',
        subtitle: 'ชื่อบริษัท ทะเบียนนิติบุคคล กรรมการผู้มีอำนาจ',
        applicantBranch: ['JURISTIC'],
    },
    {
        key: 'cultivation',
        title: 'ส่วนที่ 6: การเพาะปลูกและการผลิต',
        subtitle: 'ส่วนของพืช วิธีขยายพันธุ์ ระบบให้น้ำ สายพันธุ์',
    },
    {
        key: 'harvest_qc',
        title: 'ส่วนที่ 7: เก็บเกี่ยวและควบคุมคุณภาพ',
        subtitle: 'การเก็บเกี่ยว การทำแห้ง บรรจุภัณฑ์ มาตรการ GACP',
    },
    {
        key: 'evidence',
        title: 'ส่วนที่ 8: เอกสารประกอบคำขอ',
        subtitle: 'รายการหลักฐานที่อัปโหลด',
    },
    {
        key: 'system_meta',
        title: 'ส่วนที่ 9: ข้อมูลอ้างอิงระบบ',
        subtitle: 'ข้อมูลที่ระบบบันทึกอัตโนมัติ',
    },
];

/* ================================================================
   Document Type Definitions
   ================================================================ */

export type DocumentFormType = 'กทล.1' | 'กทล.2';

export interface DocumentConfig {
    formType: DocumentFormType;
    title: string;
    subtitle?: string;
    org: OrganizationConfig;
    badgeVariant: 'application' | 'quotation' | 'invoice' | 'receipt';
}

export const GACP_APPLICATION_DOC: DocumentConfig = {
    formType: 'กทล.1',
    title: 'แบบตรวจทานคำขอรับรอง GACP',
    subtitle: 'พรีวิวข้อมูลคำขอสำหรับตรวจสอบก่อนยืนยันและส่งคำขอ',
    org: DTAM_ORG,
    badgeVariant: 'application',
};
