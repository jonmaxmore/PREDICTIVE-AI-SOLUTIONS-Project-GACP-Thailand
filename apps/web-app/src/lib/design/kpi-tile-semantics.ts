/**
 * kpi-tile-semantics.ts — X3-FIX-B M-3
 *
 * **Semantic colour contract for KPI tiles** across the dashboard,
 * coordinator, and audits surfaces. The X3-B audit observed that
 * 4 hues are used on KPI tiles with no documented contract — making
 * future changes risk creating colour drift between similar concepts
 * (e.g. "scheduled this week" green on one screen, blue on another).
 *
 * This file fixes the meaning of each colour so designers and code
 * reviewers can settle the question "what colour should this tile be?"
 * by mapping the tile's underlying concept to one of the four tones
 * below.
 *
 * ┌──────────────┬─────────────┬──────────────────────────────────────┐
 * │ Tone         │ Tailwind    │ Meaning                              │
 * ├──────────────┼─────────────┼──────────────────────────────────────┤
 * │ success      │ primary     │ Approved / completed / on-track      │
 * │              │ (gov-green) │ "ตรวจเสร็จวันนี้", "อนุมัติแล้ว"     │
 * ├──────────────┼─────────────┼──────────────────────────────────────┤
 * │ warning      │ amber       │ Pending / awaiting action / soon-due │
 * │              │             │ "รอผล", "รอใบเสร็จ"                  │
 * ├──────────────┼─────────────┼──────────────────────────────────────┤
 * │ danger       │ rose        │ Overdue / failed / destructive       │
 * │              │             │ "ข้อบกพร่องรุนแรง", "เกินกำหนด"     │
 * ├──────────────┼─────────────┼──────────────────────────────────────┤
 * │ info         │ blue        │ Neutral count / scheduled / planning │
 * │              │             │ "นัดสัปดาห์นี้", "นัดวันนี้"          │
 * └──────────────┴─────────────┴──────────────────────────────────────┘
 *
 * **Note on scope (X3-B I-004 file-boundary discipline):** The X3-B
 * audit flagged that touching every existing KPI tile call-site to
 * thread a `tone` prop would balloon the file count of this fix to
 * 10+ files (out-of-budget for an X3 iteration). The full migration
 * is therefore deferred to **X3.5 / Post-X codemod (L-6 sibling)**.
 *
 * What IS in scope for X3-FIX-B:
 *   1. This file — the canonical contract that future tile work must
 *      conform to.
 *   2. The CAR findings panel (M-4) was the most-incorrect application
 *      of tone (amber → should be danger/rose). That single panel has
 *      already been migrated in this iteration.
 *   3. New tile components SHOULD import `KpiTileTone` and
 *      `KPI_TILE_CLASS_BY_TONE` from this file rather than re-deriving
 *      colour Tailwind classes inline.
 *
 * The constants are exported as `as const` so TypeScript can narrow
 * the union of allowed tone names at every call-site.
 */

export type KpiTileTone = 'success' | 'warning' | 'danger' | 'info';

/**
 * Tailwind class strings used by a KPI tile of a given tone. Each
 * value is the FULL class set for a tile (border + bg + text colours
 * for both the eyebrow / value pair).
 *
 * Pattern matches the dashboard tile in `audits/client-view.tsx`
 * lines 408-424: rounded-xl border bg-{tint} text-{ink} blocks.
 */
export const KPI_TILE_CLASS_BY_TONE: Record<KpiTileTone, {
    container: string;
    eyebrow: string;
    value: string;
}> = {
    success: {
        container: 'rounded-xl border border-primary/10 bg-primary/5 p-4',
        eyebrow: 'text-[10px] font-bold uppercase tracking-widest text-primary',
        value: 'text-2xl font-black text-primary',
    },
    warning: {
        container: 'rounded-xl border border-amber-100 bg-amber-50 p-4',
        eyebrow: 'text-[10px] font-bold uppercase tracking-widest text-amber-700',
        value: 'text-2xl font-black text-amber-700',
    },
    danger: {
        container: 'rounded-xl border border-rose-100 bg-rose-50 p-4',
        eyebrow: 'text-[10px] font-bold uppercase tracking-widest text-rose-700',
        value: 'text-2xl font-black text-rose-700',
    },
    info: {
        container: 'rounded-xl border border-blue-100 bg-blue-50 p-4',
        eyebrow: 'text-[10px] font-bold uppercase tracking-widest text-blue-700',
        value: 'text-2xl font-black text-blue-700',
    },
} as const;

/**
 * Inverse map — given a KPI label or concept name, what tone applies?
 * Use this as a quick lookup when migrating an existing tile site.
 *
 * The mapping is intentionally narrow: only the most common label
 * stems are seeded. When in doubt, refer to the meaning column in
 * the table above.
 */
export const KPI_TONE_BY_CONCEPT: Record<string, KpiTileTone> = {
    // success / approved / completed
    completed: 'success',
    approved: 'success',
    passed: 'success',
    auditPassed: 'success',
    auditPassedToday: 'success',
    onTrack: 'success',

    // warning / pending / awaiting action
    pending: 'warning',
    awaitingResult: 'warning',
    pendingReceipt: 'warning',
    soonDue: 'warning',
    rescheduleBacklog: 'warning',

    // danger / overdue / destructive
    overdue: 'danger',
    failed: 'danger',
    rejected: 'danger',
    majorFinding: 'danger',
    majorTriggers: 'danger',
    car: 'danger',

    // info / neutral / scheduled
    scheduled: 'info',
    scheduledToday: 'info',
    scheduledThisWeek: 'info',
    upcoming: 'info',
    total: 'info',
} as const;
