/**
 * What RANK a notification holds, decided from the two CLOSED vocabularies.
 *
 * The inbox screens used to switch on `type` against
 * 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER'. The back end writes those words at only
 * 17 call sites; everywhere else it writes one of 33 EVENT names, so
 * APPLICATION_REJECTED and PAYMENT_PHASE1_SUCCESS both landed on `default` and drew the
 * same blue info row. It also writes 'ERROR' where the screen waited for 'DANGER', so
 * the two most serious notices in the system drew as neutral news.
 *
 * `type` is an OPEN vocabulary and grows with every new feature; a screen that binds
 * colour to it needs editing every time, and demonstrably was not edited. `kind` and
 * `priority` are closed, small, already written on every row, and already on the wire
 * (the door returns whole rows — no `select`). So rank reads those, and `type` goes
 * back to choosing the words and the button, which is what it is good for.
 *
 * Design: docs/design/2026-09-05-notifications-design.md
 */

export type NotificationRank = 'OFFICIAL_LETTER' | 'ACTION_DUE' | 'NOTICE';

/** How long the platform keeps this row — a rule it already applies, silently. */
export type NotificationRetention = 'PERMANENT' | 'KEPT_UNTIL_READ' | 'THIRTY_DAYS_AFTER_READ';

export type InboxRow = {
    id: string;
    title: string;
    message: string;
    type?: string;
    createdAt: string;
    /** GENERAL | OFFICIAL_LETTER — shared/notification-kind.js */
    kind?: string | null;
    /** 0-3, mapped from NORMAL/MEDIUM/HIGH/URGENT — notification-service.js:277 */
    priority?: number | null;
    /** Json? — may be an object, a JSON string, null, or legacy junk. */
    metadata?: unknown;
    isRead?: boolean;
    read?: boolean;
    actionUrl?: string;
};

const OFFICIAL_LETTER = 'OFFICIAL_LETTER';

/** HIGH. Below this the row is news; at or above it the user has something to do. */
const ACTION_PRIORITY = 2;

/** Keys a deadline may arrive under. Revision uses `deadline`; payment uses `dueDate`. */
const DEADLINE_KEYS = ['deadline', 'dueDate'] as const;

/**
 * True only when `kind` IS the official-letter value — not when some other field merely
 * contains the words. The repo has been bitten five times by guards that matched a shape
 * rather than a declaration, so this compares the whole normalised value.
 */
function isOfficialLetter(row: InboxRow): boolean {
    return String(row?.kind ?? '').trim().toUpperCase() === OFFICIAL_LETTER;
}

/** `metadata` as a plain object, or null when it is anything else. */
function metadataObject(row: InboxRow): Record<string, unknown> | null {
    const raw = row?.metadata;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
    }
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return null;
        }
    }
    return null;
}

export function rankOf(row: InboxRow): NotificationRank {
    if (isOfficialLetter(row)) {
        return OFFICIAL_LETTER;
    }
    const priority = row?.priority;
    if (typeof priority === 'number' && Number.isFinite(priority) && priority >= ACTION_PRIORITY) {
        return 'ACTION_DUE';
    }
    return 'NOTICE';
}

/**
 * The due date as data rather than prose.
 *
 * `REVISION_REQUESTED` already prints a Thai date INSIDE its message text
 * (domain-helpers.js:213-227), which reads correctly but cannot be sorted, counted or
 * highlighted. The same date is in metadata; this reads it from there.
 *
 * Returns null rather than an Invalid Date: an Invalid Date sent through
 * toLocaleDateString renders the literal word "Invalid" to the user.
 */
export function deadlineOf(row: InboxRow): Date | null {
    const meta = metadataObject(row);
    if (!meta) {
        return null;
    }
    for (const key of DEADLINE_KEYS) {
        const value = meta[key];
        if (typeof value !== 'string' && typeof value !== 'number') {
            continue;
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return null;
}

/** Both inboxes already treat `read` and `isRead` as the same thing; so does this. */
function hasBeenRead(row: InboxRow): boolean {
    return Boolean(row?.isRead || row?.read);
}

/**
 * Official letters survive both the weekly sweep (job-scheduler.js:102) and a PDPA
 * erasure request (pdpa-erasure-service.js:834). The back end has already classified
 * them as a permanent record; this is the screen finally saying so.
 */
export function isPermanent(row: InboxRow): boolean {
    return isOfficialLetter(row);
}

/**
 * job-scheduler.js:95-104 deletes rows that are older than 30 days AND read AND not an
 * official letter. An UNREAD row is never swept, so nothing vanishes that the user has
 * not seen — which is worth telling them rather than leaving them to discover a gap.
 */
export function retentionOf(row: InboxRow): NotificationRetention {
    if (isPermanent(row)) {
        return 'PERMANENT';
    }
    return hasBeenRead(row) ? 'THIRTY_DAYS_AFTER_READ' : 'KEPT_UNTIL_READ';
}

/**
 * N6 — when an official letter was opened.
 *
 * The platform has always stamped `readAt` (both mark-read doors write it) and has
 * always returned it (the inbox query selects whole rows). Nobody ever showed it, so
 * the question "when was this letter opened?" had a stored answer and no way to ask.
 *
 * It matters for official letters specifically: a letter is a permanent legal record —
 * exempt from PDPA erasure and from the weekly sweep — and a deadline counted from
 * delivery is only defensible if the platform can say when delivery was acknowledged.
 *
 * Returns null for an unread row, and for a row whose stamp is unparseable rather than
 * guessing a date onto a legal record.
 */
export function readAtOf(row: InboxRow): Date | null {
    const raw = (row as { readAt?: unknown })?.readAt;
    if (raw instanceof Date) { return Number.isNaN(raw.getTime()) ? null : raw; }
    // Only a string is parsed. `new Date(12)` is a valid date in 1970 and
    // `new Date(String(12))` is a valid date in 2001 — a number arriving here means the
    // shape is wrong, and printing a confidently wrong date onto a legal record is worse
    // than printing nothing.
    if (typeof raw !== 'string' || raw.trim() === '') { return null; }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
