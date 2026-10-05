/**
 * กทล.1 ส่วนที่ ๑ — who is asking, field by field, per applicant type.
 *
 * The three lists are NOT variations on one form. The paper asks a วิสาหกิจชุมชน for
 * its registration code and its president's ID; it asks a sole trader for neither. A
 * single merged form with everything optional would collect the wrong facts and let a
 * filing through without the ones its own type requires, which the officer then has to
 * chase by telephone.
 *
 * Data, not markup: the labels are the only place an applicant reads these concepts
 * named, and the repo's rule is that new Thai literals live in a catalog.
 */

import type { ApplicantHolderType } from '../hooks/use-application-flow-store.state-types';

export interface IdentityField {
    /** Key inside `formData.applicantData`. */
    key: string;
    labelTH: string;
    /** Optional fields are collected but never block the step. */
    required: boolean;
    kind: 'text' | 'tel' | 'email' | 'nationalId';
    /** Shown under the input when the field needs saying more than its label can. */
    helpTH?: string;
}

const CONTACT_FIELDS: readonly IdentityField[] = Object.freeze<IdentityField[]>([
    { key: 'address', labelTH: 'ที่อยู่', required: true, kind: 'text' },
    { key: 'phone', labelTH: 'โทรศัพท์มือถือ', required: true, kind: 'tel' },
    { key: 'email', labelTH: 'อีเมล', required: false, kind: 'email' },
]);

export const IDENTITY_FIELDS_BY_APPLICANT_TYPE: Readonly<Record<ApplicantHolderType, readonly IdentityField[]>> =
    Object.freeze({
        COMMUNITY_ENTERPRISE: Object.freeze<IdentityField[]>([
            { key: 'communityName', labelTH: 'ชื่อวิสาหกิจชุมชน', required: true, kind: 'text' },
            { key: 'presidentName', labelTH: 'ชื่อประธานวิสาหกิจชุมชน', required: true, kind: 'text' },
            { key: 'presidentIdCard', labelTH: 'เลขประจำตัวประชาชนของประธาน', required: true, kind: 'nationalId' },
            { key: 'nationality', labelTH: 'สัญชาติ', required: true, kind: 'text' },
            {
                key: 'communityRegistrationNo',
                labelTH: 'รหัสทะเบียนวิสาหกิจชุมชน (สวช.01)',
                required: true,
                kind: 'text',
                helpTH: 'รหัสบนหนังสือสำคัญแสดงการจดทะเบียนวิสาหกิจชุมชน',
            },
            { key: 'houseCode', labelTH: 'เลขรหัสประจำบ้าน', required: true, kind: 'text' },
            ...CONTACT_FIELDS,
        ]),
        INDIVIDUAL: Object.freeze<IdentityField[]>([
            { key: 'firstName', labelTH: 'ชื่อ', required: true, kind: 'text' },
            { key: 'lastName', labelTH: 'นามสกุล', required: true, kind: 'text' },
            { key: 'idCard', labelTH: 'เลขประจำตัวประชาชน', required: true, kind: 'nationalId' },
            ...CONTACT_FIELDS,
            { key: 'lineId', labelTH: 'ไลน์ไอดี', required: false, kind: 'text' },
        ]),
        JURISTIC: Object.freeze<IdentityField[]>([
            { key: 'companyName', labelTH: 'ชื่อนิติบุคคล', required: true, kind: 'text' },
            { key: 'authorizedSignatory', labelTH: 'ผู้มีอำนาจลงนาม', required: true, kind: 'text' },
            {
                key: 'taxId',
                labelTH: 'เลขทะเบียนนิติบุคคลหรือเลขประจำตัวผู้เสียภาษี',
                required: true,
                kind: 'text',
            },
            ...CONTACT_FIELDS,
        ]),
    });

/** The fields this filing's own type asks for. Empty until step 1 is answered. */
export function identityFieldsFor(applicantType: ApplicantHolderType | null): readonly IdentityField[] {
    return applicantType ? IDENTITY_FIELDS_BY_APPLICANT_TYPE[applicantType] : [];
}

/**
 * Has this filing answered what its own type requires?
 *
 * Only the REQUIRED fields of the chosen type. Asking for another type's fields is how
 * a sole trader is blocked on a company registration number.
 */
export function identityComplete(
    applicantType: ApplicantHolderType | null,
    applicantData: Record<string, unknown> | null | undefined,
): boolean {
    const fields = identityFieldsFor(applicantType);
    if (fields.length === 0) { return false; }
    return fields
        .filter((f) => f.required)
        .every((f) => String(applicantData?.[f.key] ?? '').trim() !== '');
}

export const STEP2_COPY_TH = Object.freeze({
    identityHeading: 'ข้อมูลผู้ยื่นคำขอ',
    documentsHeading: 'เอกสารแสดงคุณสมบัติ',
    documentsHelp: 'ระบบแสดงเฉพาะเอกสารที่กฎหมายเรียกจากผู้ยื่นประเภทที่คุณเลือกไว้',
    noApplicantType: 'กรุณาเลือกประเภทผู้ยื่นในขั้นตอนที่ 1 ก่อน ระบบจึงจะทราบว่าต้องถามข้อมูลใดบ้าง',
});
