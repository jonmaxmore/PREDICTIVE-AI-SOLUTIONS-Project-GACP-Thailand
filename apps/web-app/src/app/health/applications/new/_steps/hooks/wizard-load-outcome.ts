/**
 * W1-WIZARD — pure outcome classification for the wizard's gating fetches.
 *
 * The api-client (src/lib/api/api-client.ts) NEVER rejects: every non-2xx
 * and every network/timeout failure comes back as a resolved
 * `{ success: false, ... }` envelope. The step shell used to ignore that
 * flag — a 503 on /applications/config silently fell back to default
 * steps, and a 503 on /applications/draft was indistinguishable from
 * "farmer has no draft" — so backend outages produced either a spinner
 * with no exit or a silently wrong/blank form. These helpers make the
 * "backend answered" vs "backend unreachable" distinction explicit so the
 * shell can render the graceful amber retry state (same discipline as the
 * public verify page's FetchOutcome).
 */

/** Envelope slice these helpers need — matches ApiResponse<T>. */
interface Envelope<T> {
    success: boolean;
    data?: T | undefined;
    error?: string | undefined;
    status?: number | undefined;
}

export type ConfigOutcome<S> =
    | { kind: 'ok'; steps: S[] }
    | { kind: 'unavailable' };

/**
 * Config fetch → active wizard steps.
 *
 * - `success: false` (503 / network / timeout) → 'unavailable'. The caller
 *   must surface an error + retry, NOT silently use defaults: the config
 *   decides which steps exist for the chosen plant, and guessing wrong
 *   means the farmer fills in (or skips) the wrong sections.
 * - `success: true` with a non-empty `steps` array → ALL_STEPS filtered to
 *   those step numbers (exact pre-existing semantics, including a
 *   non-intersecting list yielding an empty result, which the shell
 *   reports as "step not found").
 * - `success: true` without steps → the full default list: the backend
 *   answered and simply has no per-plant override.
 */
export function resolveActiveSteps<S extends { stepNumber: number }>(
    response: Envelope<{ steps?: number[] | undefined }>,
    allSteps: readonly S[],
): ConfigOutcome<S> {
    if (!response.success) {
        // Definitive 4xx (e.g. 403 role mismatch): the backend DID answer —
        // an endless "temporary glitch, retry" card would be a false claim.
        // Fall back to the default step list (pre-W1 behavior for answered
        // requests); the session/role machinery owns what happens next.
        if (response.status !== undefined && response.status < 500) {
            return { kind: 'ok', steps: [...allSteps] };
        }
        return { kind: 'unavailable' };
    }
    const rawSteps = response.data?.steps;
    if (Array.isArray(rawSteps) && rawSteps.length > 0) {
        return { kind: 'ok', steps: allSteps.filter((step) => rawSteps.includes(step.stepNumber)) };
    }
    return { kind: 'ok', steps: [...allSteps] };
}

export type DraftOutcome<D> =
    | { kind: 'draft'; draft: D }
    | { kind: 'empty' }
    | { kind: 'unavailable' };

/**
 * Draft fetch → resume / blank / unavailable.
 *
 * A genuine "no draft" is HTTP 200 `{success:true, data:null}` (backend
 * routes/api/applications/applications.js GET /draft) — after api-client
 * unwrapping (`body.data ?? body`) the caller sees the envelope echo with
 * no `formData`. So:
 * - `success: false` is ALWAYS infrastructure (503 / network), never
 *   "no draft" → 'unavailable'; rendering a blank form here would hide a
 *   farmer's server-side draft and invite a duplicate application.
 * - `success: true` without a usable `formData.plantId` → 'empty' (blank
 *   form is correct).
 * - otherwise → the draft, ready to rehydrate the store.
 */
export function classifyDraftResponse<D extends { formData?: { plantId?: unknown } | undefined }>(
    response: Envelope<D>,
): DraftOutcome<D> {
    if (!response.success) {
        // Definitive 4xx: the backend answered — there is no accessible
        // draft for this caller. A blank form is correct; only 5xx/network
        // (status undefined) may claim "unavailable, retry".
        if (response.status !== undefined && response.status < 500) {
            return { kind: 'empty' };
        }
        return { kind: 'unavailable' };
    }
    const draft = response.data;
    if (!draft || !draft.formData || !draft.formData.plantId) {
        return { kind: 'empty' };
    }
    return { kind: 'draft', draft };
}
