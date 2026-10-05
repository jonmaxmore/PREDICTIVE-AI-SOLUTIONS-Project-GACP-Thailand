/**
 * แก้ไขเอกสารตามที่เจ้าหน้าที่ขอ — the screen's rules, apart from its markup.
 *
 * ── WHAT THIS SCREEN IS FOR ───────────────────────────────────────────────────
 * An applicant whose filing came back used to be told "แก้ไข" and left to work
 * out which of nine papers was the problem. This page lists ONLY the papers the
 * officer actually asked for, each with the officer's own reason and a due date,
 * and enables "ส่งกลับให้เจ้าหน้าที่ตรวจ" only when every one has been replaced.
 *
 * The replacement test mirrors the server (assertRevisionSlotsRefreshed): NEWER
 * than the request, not merely present — the paper was already attached when the
 * officer refused it.
 */
import { bangkokDateParts, type BangkokDateParts } from '@/lib/format/thai-date';

export interface RequestedDocument {
    slotId: string;
    /** The ministry's own name for the paper — never the slot id on screen. */
    labelTH: string;
    reason: string | null;
    dueDate: string | null;
    requestedAt: string;
    /** When the applicant's newest file for this slot was uploaded, if any. */
    uploadedAt: string | null;
}

export const REVISION_COPY_TH = Object.freeze({
    title: 'แก้ไขเอกสารตามที่เจ้าหน้าที่ขอ',
    intro: 'เจ้าหน้าที่ขอเอกสารเพิ่มเฉพาะรายการด้านล่าง รายการอื่นที่รับไปแล้วไม่ต้องส่งใหม่',
    reasonLabel: 'เหตุผลจากเจ้าหน้าที่',
    dueLabel: 'กำหนดส่ง',
    replaceCta: 'อัปโหลดฉบับใหม่',
    replaced: 'อัปโหลดฉบับใหม่แล้ว',
    stillNeeded: 'ยังไม่ได้อัปโหลดฉบับใหม่',
    submit: 'ส่งกลับให้เจ้าหน้าที่ตรวจ',
    blocked: 'ยังมีเอกสารที่ยังไม่ได้อัปโหลดฉบับใหม่',
    nothingRequested: 'ไม่มีรายการที่เจ้าหน้าที่ขอเพิ่มสำหรับคำขอนี้',
    reviewsUnavailable: 'ระบบอ่านรายการที่เจ้าหน้าที่ขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
});

/**
 * Has this paper actually been replaced since it was asked for?
 *
 * Strictly newer. A file uploaded at the same instant as the request cannot have
 * been a response to it, and treating it as one lets a filing through on a
 * coincidence — the same line the server draws.
 */
export function isReplaced(doc: RequestedDocument): boolean {
    if (!doc.uploadedAt) { return false; }
    const uploaded = new Date(doc.uploadedAt).getTime();
    const asked = new Date(doc.requestedAt).getTime();
    if (Number.isNaN(uploaded) || Number.isNaN(asked)) { return false; }
    return uploaded > asked;
}

export interface RevisionSubmitState {
    canSubmit: boolean;
    outstandingSlotIds: string[];
    blockedReason: string | null;
}

/**
 * May the applicant send the filing back?
 *
 * Mirrors the door: every requested paper replaced, and at least one request to
 * answer. An empty list does NOT enable the button — reaching this screen with
 * nothing outstanding means something is wrong, and sending the officer a filing
 * with no note of what changed wastes their reading rather than the applicant's.
 */
export function submitState(docs: RequestedDocument[]): RevisionSubmitState {
    const rows = Array.isArray(docs) ? docs : [];
    const outstandingSlotIds = rows.filter((d) => !isReplaced(d)).map((d) => d.slotId);
    return {
        canSubmit: rows.length > 0 && outstandingSlotIds.length === 0,
        outstandingSlotIds,
        blockedReason: outstandingSlotIds.length > 0 ? REVISION_COPY_TH.blocked : null,
    };
}

/**
 * Days left, counted from a date-only comparison.
 *
 * A deadline is a DAY, not an instant: comparing timestamps makes a paper due
 * today read as overdue from one minute past midnight, which is both wrong and
 * alarming to someone who still has the whole day.
 */
export function daysUntil(dueDate: string | null, now: Date = new Date()): number | null {
    if (!dueDate) { return null; }
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) { return null; }
    // Both ends are read as their Bangkok day (the day the deadline names).
    const dayOf = (d: Date) => {
        const p = bangkokDateParts(d) as BangkokDateParts;
        return Date.UTC(p.year, p.month - 1, p.day);
    };
    return Math.round((dayOf(due) - dayOf(now)) / 86400000);
}
