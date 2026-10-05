/**
 * Bug 4.1 — pure id-selection helpers for the health billing page.
 *
 * The backend `/applications/my` endpoint maps every health application through
 * `mapHealthApplication` (apps/backend/routes/api/helpers/applications-helpers.js)
 * which emits the identifier as `id`. It used to emit `_id`, a name the PostgreSQL
 * schema never had, so reading `.id` yielded undefined: loadStatement never fired
 * (permanent spinner) and every picker button rendered `key={undefined}`
 * (colliding React keys).
 *
 * These helpers are the single source of truth for deriving the billing target,
 * and are unit-tested so the read can't silently drift again.
 */

export type MyApplication = {
    id: string;
    applicationNumber: string;
    status?: string;
};

/**
 * The id used to key a picker button. Reads `id` (the shape emitted by
 * mapHealthApplication). Returns the applicationNumber as a defensive fallback
 * so a malformed row never produces a `key={undefined}` collision.
 */
export function billingAppKey(app: MyApplication | null | undefined): string {
    if (!app) return '';
    return app.id || app.applicationNumber || '';
}

/**
 * The id of the application to load a statement for on initial render — the
 * first application in the list. Returns null for an empty/malformed list so
 * the caller can drop out of the loading state instead of spinning forever.
 */
export function pickBillingAppId(
    list: MyApplication[] | null | undefined,
): string | null {
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[0]?.id || null;
}
