/**
 * The officer document-check screen, as decisions rather than markup.
 *
 * ── WHY A SEPARATE MODULE ─────────────────────────────────────────────────────
 * Which button is enabled, what a row looks like, and whether a form may be
 * submitted are RULES, and they mirror refusals the backend already enforces
 * (application-document-review-service.js). Keeping them here means they can be
 * tested exhaustively without rendering, and — more importantly — that the two
 * sides can be compared by reading two files rather than by clicking.
 *
 * The screen must never be MORE permissive than the server. It may be less: a
 * disabled button is a better explanation than a 409.
 */

import { PRECHECK_FAILED_TH } from '@gacp/validation/precheck-copy';
import { isObservation, isOfficersLine } from '@/lib/services/document-precheck-results';

export type Verdict = 'ACCEPTED' | 'MORE_REQUESTED' | null;

/**
 * One pre-check flag as the officer's door sends it (GET .../document-check, Task 7):
 * the applicant's three fields plus confidence and the evidence snippet. The snippet
 * is masked on the server (raw 13-digit ids never leave it); this screen shows it as
 * received and never unmasks.
 */
export interface OfficerPrecheckFlag {
    check: string;
    result: string;
    reasonTH: string;
    /** 0-100, the OCR/text confidence the rule ran on (backend rules/readability.js). */
    confidence: number | null;
    evidenceSnippet: string | null;
}

export interface OfficerPrecheck {
    id: string;
    status: 'PENDING' | 'DONE' | 'FAILED';
    flags: OfficerPrecheckFlag[];
    /** Set when the applicant pressed "ยืนยันว่าเอกสารถูกต้อง". */
    acknowledgedAt: string | null;
}

export interface SlotRow {
    slotId: string;
    labelTH: string;
    required: boolean;
    satisfied: boolean;
    fileUrl: string | null;
    fileName: string | null;
    verdict: Verdict;
    reviewReason: string | null;
    reviewDueDate: string | null;
    /** The document pre-check, or null/absent for a slot it does not cover. Informs; never decides. */
    precheck?: OfficerPrecheck | null;
}

/** Mirrors services/application-document-review-service.js MIN_REASON_LENGTH. */
export const MIN_REASON_LENGTH = 10;

export const DOCUMENT_CHECK_COPY_TH = Object.freeze({
    title: 'ตรวจเอกสารตาม กทล.1',
    sectionSlots: 'ข้อ 1.1 เอกสารประกอบคำขอ',
    accept: 'รับเอกสารนี้',
    requestMore: 'ขอเอกสารเพิ่ม',
    view: 'ดู',
    notAttached: 'ยังไม่ได้แนบ',
    optional: 'ไม่บังคับ',
    reasonLabel: 'เหตุผลที่ขอเพิ่ม',
    reasonHint: 'อธิบายให้ผู้ยื่นทราบว่าต้องแก้ไขอะไร อย่างน้อย 10 ตัวอักษร',
    dueLabel: 'วันครบกำหนดส่ง',
    dueHint: 'ต้องเป็นวันทำการ',
    decisionAccept: 'รับคำขอ',
    decisionRequest: 'ส่งคำขอเอกสารเพิ่ม',
    blockedByRequired: 'ยังมีเอกสารที่จำเป็นซึ่งยังไม่ได้รับ',
    nothingRequested: 'ยังไม่ได้เลือกเอกสารที่ต้องการเพิ่ม',
});

/** The visual state of one row. Amber is "we asked for something". */
export function rowState(slot: SlotRow): 'ACCEPTED' | 'REQUESTED' | 'PENDING' {
    if (slot.verdict === 'ACCEPTED') { return 'ACCEPTED'; }
    if (slot.verdict === 'MORE_REQUESTED') { return 'REQUESTED'; }
    return 'PENDING';
}

/**
 * Is the per-slot "ขอเอกสารเพิ่ม" form complete?
 *
 * Same two rules the server applies, so the officer is told before the round
 * trip rather than after it. A weekend check needs the holiday calendar and
 * therefore stays server-side; this catches only what a browser can know.
 */
export function canSubmitRequest(reason: string, dueDate: string): boolean {
    return reason.trim().length >= MIN_REASON_LENGTH && Boolean(dueDate);
}

export interface DecisionState {
    canAccept: boolean;
    canRequestMore: boolean;
    /** Why ACCEPT is unavailable, in the officer's language. */
    acceptBlockedReason: string | null;
    /** The required slots still standing in the way — the rows to point at. */
    blockingSlotIds: string[];
}

/**
 * Which decision the officer may take.
 *
 * Mirrors decideDocumentOutcome: every REQUIRED slot accepted → รับคำขอ; at
 * least one MORE_REQUESTED → ส่งคำขอเอกสารเพิ่ม. OPTIONAL slots never block
 * acceptance, and an optional slot CAN be the thing requested.
 */
export function decisionState(slots: SlotRow[]): DecisionState {
    const rows = Array.isArray(slots) ? slots : [];
    const blockingSlotIds = rows
        .filter((s) => s.required && s.verdict !== 'ACCEPTED')
        .map((s) => s.slotId);
    const requested = rows.filter((s) => s.verdict === 'MORE_REQUESTED');

    return {
        canAccept: rows.length > 0 && blockingSlotIds.length === 0,
        canRequestMore: requested.length > 0,
        acceptBlockedReason: blockingSlotIds.length > 0
            ? DOCUMENT_CHECK_COPY_TH.blockedByRequired
            : null,
        blockingSlotIds,
    };
}

/**
 * รับได้ไหม — ปุ่มต้อง "เข้มกว่าหรือเท่ากับ" ประตูเสมอ ไม่มีทางหลวมกว่า
 *
 * ประตูปฏิเสธ REVIEW_SLOT_NOT_ATTACHED เมื่อสั่งรับช่องที่ยังไม่มีเอกสาร (เพิ่ม 2026-09-06
 * หลังเดินจริงแล้วพบว่ารับช่องว่างได้ และฐานข้อมูลบันทึก ACCEPTED ให้ water_test/soil_test
 * ที่ไม่เคยมีไฟล์) · ปุ่มที่กดได้แล้วถูกปฏิเสธเสมอ คือปุ่มที่โกหกเจ้าหน้าที่
 */
export function canAcceptSlot(slot: { satisfied?: boolean } | null | undefined): boolean {
    return slot?.satisfied === true;
}

/** เหตุผลที่ปุ่มรับกดไม่ได้ — บอกทางออกด้วย ไม่ใช่แค่บอกว่าไม่ได้ */
export const ACCEPT_BLOCKED_TH = 'ยังไม่มีเอกสารในรายการนี้ให้ตรวจ หากต้องการให้ผู้ยื่นส่ง ให้เลือก "ขอเอกสารเพิ่ม"';

/**
 * The pre-check block on an officer row. Spec §5 fixes two strings — the badge and the
 * MANUAL line; the rest are labels so status is never carried by colour alone.
 *
 * Operator ruling 2026-09-28: a PASS/MATCH flag is tagged "ไม่มีข้อสังเกต", never "ผ่าน"
 * (the officer's verdict is the only pass); the MANUAL line is tagged "ตรวจเอง"; and each
 * block opens with one line saying the officer decides. The other words were approved as-is.
 */
export const PRECHECK_OFFICER_COPY_TH = Object.freeze({
    officerDecides: 'ผลตรวจอัตโนมัติเป็นข้อสังเกตเบื้องต้น การตัดสินเป็นของเจ้าหน้าที่',
    heading: 'ผลตรวจเอกสารเบื้องต้นอัตโนมัติ',
    acknowledged: 'ผู้ยื่นยืนยันแล้ว',
    signature: 'ตรวจลายมือชื่อ/ตรา',
    checking: 'กำลังตรวจเอกสาร…',
    /** The same words the applicant card and the API flag carry (walk D5). */
    failed: PRECHECK_FAILED_TH,
    observation: 'ข้อสังเกต',
    nothingNoticed: 'ไม่มีข้อสังเกต',
    manualTag: 'ตรวจเอง',
    confidence: 'ความมั่นใจในการอ่าน',
    snippet: 'ข้อความที่พบ',
});

export interface PrecheckFlagLine {
    /** The reasonTH, or the signature line for MANUAL. */
    text: string;
    snippet: string | null;
    observation: boolean;
    manual: boolean;
}

/**
 * One flag, as the officer row prints it. No confidence per line: every rule runs on
 * the same extracted text and carries the same number, so it is shown once beside
 * the heading (precheckConfidence) instead of repeated on every line.
 */
export function precheckFlagLine(flag: OfficerPrecheckFlag): PrecheckFlagLine {
    const manual = isOfficersLine(flag.result);
    return {
        text: manual ? PRECHECK_OFFICER_COPY_TH.signature : flag.reasonTH,
        snippet: flag.evidenceSnippet && flag.evidenceSnippet.trim() !== '' ? flag.evidenceSnippet : null,
        observation: isObservation(flag.result),
        manual,
    };
}

/**
 * The extraction confidence of a pre-check, as a whole percent, or null.
 *
 * READABILITY's number is the extraction's own; every other rule carries the same
 * value (backend evaluate.js passes readability.confidence down). MANUAL is skipped:
 * the signature rule always writes 0, which means "not judged", not "0% sure".
 */
export function precheckConfidence(precheck: OfficerPrecheck): string | null {
    const flags = Array.isArray(precheck.flags) ? precheck.flags : [];
    const usable = flags.filter((f) => !isOfficersLine(f.result) && typeof f.confidence === 'number' && Number.isFinite(f.confidence));
    const pick = usable.find((f) => f.check === 'READABILITY') ?? usable[0];
    return pick ? `${Math.round(pick.confidence as number)}%` : null;
}
