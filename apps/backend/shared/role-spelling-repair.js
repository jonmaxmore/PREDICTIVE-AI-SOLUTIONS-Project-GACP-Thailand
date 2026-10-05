'use strict';

/**
 * Decide whether a stored `users.role` value may be rewritten to its canonical
 * spelling — and, crucially, when it may NOT be.
 *
 * WHY THIS EXISTS (W4 review round, 2026-08-22)
 * ---------------------------------------------
 * The seed needs to repair rows it created before migration 20260801000000,
 * which hold legacy spellings ('HEALTH', 'ACCOUNTANT', …) that every narrowed
 * role filter now misses. The obvious way — putting `role` in the upsert's
 * `update:` clause — is wrong, because the seed's own idea of a role is a
 * FIXTURE, not the truth about a live row:
 *
 *   `scripts/migrate-account-role.js` deliberately splits the legacy union role
 *   ACCOUNT into ACCOUNT_DTAM / ACCOUNT_PLATFORM, one audit-logged decision per
 *   account. A blind `update: { role: 'account' }` silently reverts that split
 *   on the next re-seed, with no audit row and nothing in the output to notice.
 *
 * So the repair is narrowed to what it actually is: a SPELLING repair. A value
 * is rewritten only when it names the SAME canonical role the seed intends and
 * merely spells it the old way. Anything that normalises to a DIFFERENT
 * canonical role — a migrated split, a promotion, anything an operator did on
 * purpose — is left exactly as it is, and so is anything that does not
 * normalise at all (an unknown or quarantined value is never something to
 * overwrite blind).
 *
 * Pure function, no I/O: the caller does the write and the logging.
 */

const { normalizeRole } = require('./canonical-rbac');

/**
 * @param {string|null|undefined} storedRole  the value currently in users.role
 * @param {string} seedRole                   the role this fixture wants (any spelling)
 * @returns {{ write: string|null, reason: string }}
 *   `write` is the canonical value to store, or null when the row must not be
 *   touched. `reason` is a short machine-ish tag for the seed's log line.
 */
function resolveRoleSpellingRepair(storedRole, seedRole) {
    const target = normalizeRole(seedRole);
    if (!target) {
        // The fixture itself names a role that does not exist — a seed bug, and
        // one that would create an account that can never log in.
        throw new Error(`seed role "${seedRole}" is not a canonical role`);
    }

    const stored = typeof storedRole === 'string' ? storedRole : null;
    if (!stored) {
        return { write: null, reason: 'NO_STORED_ROLE_LEAVE_ALONE' };
    }
    if (stored === target) {
        return { write: null, reason: 'ALREADY_CANONICAL' };
    }

    const storedCanonical = normalizeRole(stored);
    if (!storedCanonical) {
        // Unknown / quarantined value. It is broken, but it is not ours to
        // guess at — report it, do not overwrite it.
        return { write: null, reason: 'UNKNOWN_STORED_ROLE_LEAVE_ALONE' };
    }
    if (storedCanonical !== target) {
        // A DIFFERENT canonical role. The ACCOUNT → ACCOUNT_DTAM /
        // ACCOUNT_PLATFORM split lands here, and so does any deliberate
        // promotion. Never revert one of those.
        return { write: null, reason: `DIFFERENT_ROLE_LEAVE_ALONE(${storedCanonical})` };
    }

    return { write: target, reason: `SPELLING_REPAIR(${stored}->${target})` };
}

module.exports = { resolveRoleSpellingRepair };
