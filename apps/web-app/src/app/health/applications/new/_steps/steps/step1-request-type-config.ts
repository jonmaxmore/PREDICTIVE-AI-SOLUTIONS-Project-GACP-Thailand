/**
 * Step 1 — the three questions กทล.1 asks first, as data.
 *
 * The words on the LEFT of each option are the applicant's; the words on the RIGHT
 * are the requirement register's own vocabulary (requirement-rule-service
 * RULE_DIMENSIONS). Keeping the pair in one table is the point: `applicantType` and
 * `requestType` are DIMENSIONS the engine matches rules on, and a value spelled
 * differently here than the register spells it does not error — it matches only the
 * rules that bind everybody, so the filing is judged by almost no law at all, and
 * reports ครบ. That failure has already happened once on this platform with a
 * trailing space in holderType.
 *
 * Copy lives here rather than in the component because the repo's rule is that new
 * Thai literals live in catalogs/config, and because these labels are the only place
 * an applicant ever sees these concepts named.
 */

import type { ApplicantHolderType, CertScope, RequestType, WizardState } from '../hooks/use-application-flow-store.state-types';

export interface Step1Option<T extends string> {
    /** The register's word. Never rendered. */
    value: T;
    /** What the applicant reads. */
    labelTH: string;
    /** One line saying when this is the right choice. */
    helpTH: string;
}

export const REQUEST_TYPE_OPTIONS: ReadonlyArray<Step1Option<RequestType>> = Object.freeze([
    {
        value: 'NEW',
        labelTH: 'ขอใหม่',
        helpTH: 'ยังไม่เคยได้รับใบรับรอง GACP สำหรับแปลงนี้',
    },
    {
        value: 'RENEWAL',
        labelTH: 'ต่ออายุ',
        helpTH: 'มีใบรับรองเดิมที่ใกล้หมดอายุหรือหมดอายุแล้ว',
    },
    {
        value: 'REPLACEMENT',
        labelTH: 'ใบแทน',
        helpTH: 'ใบรับรองเดิมสูญหายหรือชำรุด และต้องการใบใหม่แทนฉบับเดิม',
    },
]);

export const APPLICANT_TYPE_OPTIONS: ReadonlyArray<Step1Option<ApplicantHolderType>> = Object.freeze([
    {
        value: 'COMMUNITY_ENTERPRISE',
        labelTH: 'วิสาหกิจชุมชน',
        helpTH: 'จดทะเบียนวิสาหกิจชุมชนและยื่นในนามกลุ่ม',
    },
    {
        value: 'INDIVIDUAL',
        labelTH: 'บุคคลธรรมดา',
        helpTH: 'ยื่นในนามตนเอง ใช้เลขประจำตัวประชาชน',
    },
    {
        value: 'JURISTIC',
        labelTH: 'นิติบุคคล',
        helpTH: 'บริษัทหรือห้างหุ้นส่วนที่จดทะเบียนแล้ว',
    },
]);

export const CERT_SCOPE_OPTIONS: ReadonlyArray<Step1Option<CertScope>> = Object.freeze([
    {
        value: 'PLANTING',
        labelTH: 'การปลูก',
        helpTH: 'ขอรับรองแหล่งผลิตในขั้นการเพาะปลูกและเก็บเกี่ยว',
    },
    {
        value: 'PROCESSING',
        labelTH: 'การแปรรูป',
        helpTH: 'ขอรับรองขั้นการแปรรูปหลังการเก็บเกี่ยว',
    },
]);

/**
 * A renewal and a replacement both succeed a certificate that already exists, so the
 * filing has to name it. Asked here rather than later because it is what tells the
 * officer which record this one continues.
 */
export function needsPreviousCertificate(requestType: RequestType | null): boolean {
    return requestType === 'RENEWAL' || requestType === 'REPLACEMENT';
}

/**
 * Only a NEW request is asked what is being certified. A renewal inherits the scope
 * of what it renews, and asking again invites a filing whose scope contradicts the
 * certificate it succeeds.
 */
export function needsCertScope(requestType: RequestType | null): boolean {
    return requestType === 'NEW';
}

/**
 * What step 1 must have before the applicant may leave it.
 *
 * Deliberately the SAME predicate as `isStepComplete(state, 1)`: the button and the
 * navigation guard disagreeing is how a farmer gets a live ถัดไป button that bounces
 * them straight back to the step they just left.
 */
export function step1CanProceed(state: Partial<WizardState>): boolean {
    if (!state.requestType || !state.applicantType) { return false; }
    if (needsPreviousCertificate(state.requestType)) {
        return String(state.previousCertificateNumber ?? '').trim() !== '';
    }
    // The scope question is retired (operator, 2026-09-06: "ขอรับรองในขั้นตอนใด
    // ส่วนนี้ไม่ต้องมี") — a NEW filing is PLANTING, written silently by the screen
    // when ขอใหม่ is chosen, so the gate no longer demands an answer nobody is asked.
    //
    // The PLANT, however, is demanded here (operator ruling 2026-09-06, F-QA-04). กทล.1 is
    // filed per plant and the requirement register keys its rules on the plant, so a filing
    // that names none is unjudgeable: the engine returns ZERO document slots and steps 2–3
    // render no upload cards at all. Asking it first is what makes the papers resolvable on
    // the screens that collect them.
    return String(state.plantId ?? '').trim() !== '';
}

/** Shown once a succeeding request is chosen, so the shorter path is not a surprise. */
export const SUCCEEDING_REQUEST_NOTE_TH =
    'คำขอต่ออายุและคำขอใบแทนจะข้ามขั้นตอนที่ 2 ถึง 5 ไปยังชุดเอกสารเฉพาะกรณี';
