/**
 * The application wizard's local copy: its IndexedDB key, and one way to forget it.
 *
 * Round 5 (staging-walk-0930). The wizard keeps the applicant's answers, and the id of the
 * application they belong to, in a zustand store persisted to IndexedDB. Two moments must
 * empty it:
 *   - a filing was accepted: the next "ยื่นคำขอใหม่" must not open on that application
 *     (every save would name it and be refused 409, forever);
 *   - an explicit logout, or a sign-in as another account: on a shared device the next
 *     person must not rehydrate the previous person's answers.
 *
 * Round 5b: the wizard records whose answers it holds (`ownerUserId`, stamped by the store
 * from the signed-in user), so an expiry or an idle timeout, which also removes the stored
 * user, does not cost the same person their unsent edit. Only an explicit logout, or a
 * sign-in by someone else (claimWizardFor), empties it.
 *
 * This module stays light on purpose. The auth service runs on every page, including the
 * provider portal, and must not pull in the wizard store and its step configs. The store
 * registers its own in-memory reset here when it loads; when it has not loaded on this page
 * there is nothing in memory to reset, and only the persisted copy is removed.
 */
import { indexedDBStorage } from '@/lib/indexeddb-storage';

export const WIZARD_STORAGE_KEY = 'gacp_application_flow_state_v4';

/** Whose answers the wizard holds, and whether it holds any. */
export type WizardOwnership = { ownerUserId?: string | undefined; started: boolean };

const inMemoryResets = new Set<() => void>();
const inMemoryOwnership = new Set<() => WizardOwnership>();

/**
 * The wizard store calls this once, at load: how to empty it, and how to ask whose it is.
 * Returns an unregister function.
 */
export function registerWizardReset(reset: () => void, ownership?: () => WizardOwnership): () => void {
    inMemoryResets.add(reset);
    if (ownership) { inMemoryOwnership.add(ownership); }
    return () => {
        inMemoryResets.delete(reset);
        if (ownership) { inMemoryOwnership.delete(ownership); }
    };
}

/** Does this look like the wizard's persisted entry, and whose is it? */
export function ownershipOfPersisted(raw: string | null): WizardOwnership | null {
    if (!raw) { return null; }
    try {
        const state = (JSON.parse(raw) as { state?: Record<string, unknown> } | null)?.state ?? {};
        const owner = typeof state.ownerUserId === 'string' && state.ownerUserId ? state.ownerUserId : undefined;
        return { ownerUserId: owner, started: Boolean(state.requestType || state.plantId || state.applicationId) };
    } catch {
        return null;
    }
}

/**
 * Do these answers belong to someone other than `userId`? Stamped by another user: yes.
 * Unstamped but holding answers: unknown, so treated as someone else's (only a state
 * written before the stamp existed can be unstamped; see the store). Empty: nothing to protect.
 */
function heldForSomeoneElse(ownership: WizardOwnership | null, userId: string): boolean {
    if (!ownership) { return false; }
    if (ownership.ownerUserId) { return ownership.ownerUserId !== userId; }
    return ownership.started;
}

/**
 * Round 5b (reviewer P2) — a sign-in by `userId`. Empties the wizard only when it holds
 * someone else's answers. The same user signing back in after an expiry or an idle
 * timeout keeps them, and an edit still marked unsent is then sent by the autosave.
 */
export async function claimWizardFor(userId: string): Promise<void> {
    let foreign = false;
    inMemoryOwnership.forEach((read) => {
        try { if (heldForSomeoneElse(read(), userId)) { foreign = true; } } catch { /* unreadable: ask IndexedDB */ }
    });
    if (!foreign) {
        try {
            foreign = heldForSomeoneElse(ownershipOfPersisted(await indexedDBStorage.getItem(WIZARD_STORAGE_KEY)), userId);
        } catch {
            // IndexedDB unavailable: nothing persisted there to protect.
        }
    }
    if (foreign) { await forgetWizard(); }
}

/**
 * Empty the wizard: the in-memory store first (its persist middleware then writes the
 * empty state), then remove the persisted entry. Never throws: IndexedDB can be blocked
 * (private windows), and a sign-out must not fail because of it.
 */
export async function forgetWizard(): Promise<void> {
    inMemoryResets.forEach((reset) => {
        try { reset(); } catch { /* a reset that throws must not keep the persisted copy */ }
    });
    try {
        await indexedDBStorage.removeItem(WIZARD_STORAGE_KEY);
    } catch {
        // IndexedDB unavailable: nothing was persisted there either.
    }
}
