/**
 * The inbox holds three different KINDS of thing and today renders them alike.
 *
 * The screen decides colour and icon by switching on `type` against
 * 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER'. The back end writes that vocabulary at
 * only 17 call sites; everywhere else it writes one of 33 EVENT names, so
 * APPLICATION_REJECTED and PAYMENT_PHASE1_SUCCESS both fall to `default` and render
 * as the same blue info row. It also writes 'ERROR' where the screen waits for
 * 'DANGER', so the two most serious notices in the system render as neutral news.
 *
 * The fields that DO carry the distinction are already written on every row and
 * already on the wire (the door returns whole rows — no `select`):
 *
 *   kind      GENERAL | OFFICIAL_LETTER   — an official letter is a legal record: the
 *                                           back end already exempts it from a PDPA
 *                                           erasure request and from the weekly sweep
 *   priority  Int 0-3                     — mapped from NORMAL/HIGH/URGENT
 *
 * Rank is computed from those two CLOSED vocabularies and never from `type`, which is
 * open and grows: binding colour to event names is what put the screen a year behind
 * the back end in the first place.
 */
import {
    rankOf,
    deadlineOf,
    isPermanent,
    retentionOf,
    type InboxRow,
} from '../notification-rank';

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
    id: 'n1',
    title: 't',
    message: 'm',
    type: 'APPLICATION_REJECTED',
    createdAt: '2026-09-05T00:00:00.000Z',
    ...over,
});

describe('rankOf — an official letter outranks everything', () => {
    it('is OFFICIAL_LETTER whatever the priority says', () => {
        expect(rankOf(row({ kind: 'OFFICIAL_LETTER', priority: 0 }))).toBe('OFFICIAL_LETTER');
        expect(rankOf(row({ kind: 'OFFICIAL_LETTER', priority: 3 }))).toBe('OFFICIAL_LETTER');
    });

    it('reads the kind case-insensitively — the column is a plain String', () => {
        expect(rankOf(row({ kind: 'official_letter' }))).toBe('OFFICIAL_LETTER');
    });

    it('does not promote a GENERAL row that merely mentions a letter in its type', () => {
        // The trap this whole module exists to avoid: matching a shape, not a declaration.
        expect(rankOf(row({ kind: 'GENERAL', type: 'OFFICIAL_LETTER_SENT' }))).toBe('NOTICE');
    });
});

describe('rankOf — urgency comes from priority, never from type', () => {
    it('HIGH (2) and URGENT (3) are work the user must do', () => {
        expect(rankOf(row({ priority: 2 }))).toBe('ACTION_DUE');
        expect(rankOf(row({ priority: 3 }))).toBe('ACTION_DUE');
    });

    it('NORMAL (0) and MEDIUM (1) are notices', () => {
        expect(rankOf(row({ priority: 0 }))).toBe('NOTICE');
        expect(rankOf(row({ priority: 1 }))).toBe('NOTICE');
    });

    it('stays ACTION_DUE even with no deadline attached', () => {
        // Losing the urgency because metadata happens to lack a date would re-create
        // the bug in a new place: the row is urgent because the back end said so.
        expect(rankOf(row({ priority: 3, metadata: {} }))).toBe('ACTION_DUE');
    });

    it('a missing or unusable priority is a NOTICE, not a crash', () => {
        expect(rankOf(row({ priority: undefined }))).toBe('NOTICE');
        expect(rankOf(row({ priority: null }))).toBe('NOTICE');
        expect(rankOf(row({ priority: Number.NaN }))).toBe('NOTICE');
        expect(rankOf(row({ priority: 'URGENT' as unknown as number }))).toBe('NOTICE');
    });

    it('ignores `type` entirely — including the severity words the screen used to read', () => {
        // These four are still written by 17 call sites. They must not drive the rank,
        // or the open vocabulary is back in charge of the screen.
        for (const t of ['DANGER', 'ERROR', 'WARNING', 'SUCCESS']) {
            expect(rankOf(row({ type: t, priority: 0 }))).toBe('NOTICE');
        }
    });
});

describe('deadlineOf — the date is data, not prose', () => {
    it('reads metadata.deadline', () => {
        const d = deadlineOf(row({ metadata: { deadline: '2026-09-19T00:00:00.000Z' } }));
        expect(d?.toISOString()).toBe('2026-09-19T00:00:00.000Z');
    });

    it('accepts metadata delivered as a JSON string', () => {
        const d = deadlineOf(row({ metadata: '{"deadline":"2026-09-19T00:00:00.000Z"}' }));
        expect(d?.toISOString()).toBe('2026-09-19T00:00:00.000Z');
    });

    it('returns null rather than an Invalid Date', () => {
        // `metadata` is Json? — null, a non-object and legacy junk all reach here, and an
        // Invalid Date rendered through toLocaleDateString prints the word "Invalid".
        expect(deadlineOf(row({ metadata: null }))).toBeNull();
        expect(deadlineOf(row({ metadata: 'not json' }))).toBeNull();
        expect(deadlineOf(row({ metadata: 42 as unknown as object }))).toBeNull();
        expect(deadlineOf(row({ metadata: { deadline: 'tomorrow-ish' } }))).toBeNull();
        expect(deadlineOf(row({ metadata: { deadline: null } }))).toBeNull();
        expect(deadlineOf(row({}))).toBeNull();
    });

    it('also reads dueDate, which the payment reminders use', () => {
        const d = deadlineOf(row({ metadata: { dueDate: '2026-09-19T00:00:00.000Z' } }));
        expect(d?.toISOString()).toBe('2026-09-19T00:00:00.000Z');
    });
});

describe('retention — the screen must say what it already does silently', () => {
    it('an official letter is permanent', () => {
        const r = row({ kind: 'OFFICIAL_LETTER', isRead: true });
        expect(isPermanent(r)).toBe(true);
        expect(retentionOf(r)).toBe('PERMANENT');
    });

    it('everything else is swept 30 days after it is READ', () => {
        // job-scheduler.js:95-104 — createdAt older than 30 days AND isRead AND not an
        // official letter. An unread row is never swept, so nothing disappears that the
        // user has not seen; that is worth stating on the screen, not hiding.
        expect(retentionOf(row({ isRead: true }))).toBe('THIRTY_DAYS_AFTER_READ');
        expect(retentionOf(row({ isRead: false }))).toBe('KEPT_UNTIL_READ');
        expect(isPermanent(row({ kind: 'GENERAL' }))).toBe(false);
    });

    it('treats the legacy `read` flag as equivalent to isRead', () => {
        // Both inboxes already read `n.read || n.isRead`; the rule must agree with them.
        expect(retentionOf(row({ read: true }))).toBe('THIRTY_DAYS_AFTER_READ');
    });
});
