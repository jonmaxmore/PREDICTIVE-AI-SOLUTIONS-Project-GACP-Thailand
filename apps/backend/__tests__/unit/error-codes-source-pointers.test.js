/**
 * error-codes-source-pointers.test.js — one-fee residue sweep, fix round 1
 * (2026-09-26, coordinator decision after review Important-2).
 *
 * `shared/error-codes.js` `source` pointers are hand-maintained `<path>:<line>`
 * strings. This class of drift has now broken three times on one file alone
 * (`services/pdf/invoice-template-service.js`): commit 371db8b3 fixed it once,
 * `6e5358fb` (this sweep) fixed `QUOTATION_PHASE_NOT_PRICED` but missed its
 * sibling `INVALID_ISSUER_SIDE` (same file, same deleting commit) — fixed in
 * this fix-round commit — because the only existing check for line accuracy
 * (`quotation-gate-error-codes.test.js`) covers 4 of the 395 catalogued codes,
 * a narrower blast radius than the edit that broke it.
 *
 * Coverage: every code whose `source` is `<path>:<line>` — confirmed uniform
 * for all 395 entries (grep against the regex below returns 0 non-matches) —
 * checked for two things:
 *   1. the file exists;
 *   2. the cited line, **or a line within ±2 of it** (the coordinator's own
 *      tolerance), contains the code's own name as a substring (every
 *      catalogue entry's `code` field equals its object key — pinned
 *      separately by `error-codes-catalog.test.js` — so the key IS the string
 *      to search for).
 *
 * Running this check for the first time (2026-09-26) found **209 of 395**
 * pre-existing pointers already broken this way — 16 name a file that no
 * longer exists, 193 point at a line whose ±2 window does not mention the
 * code. This is a real, large, PRE-EXISTING debt, not something this fix
 * round introduced or can responsibly hand-fix in one pass — spot-checking
 * confirmed real drift (e.g. `INVOICE_LISTING_FORBIDDEN`'s cited file no
 * longer contains that string anywhere), not a flaw in this check's window.
 *
 * Per L4 (ratchet ลงทางเดียว): `KNOWN_PREEXISTING_DRIFT` below is the frozen
 * baseline of that debt, dated 2026-09-26. This test:
 *   - fails loud on any pointer OUTSIDE the baseline that drifts (catches
 *     exactly the INVALID_ISSUER_SIDE-class regression this test exists for);
 *   - fails if the baseline itself no longer matches reality (so a silent
 *     re-drift of an already-known-bad pointer, or an accidental fix that
 *     forgets to shrink the list, both surface);
 *   - never grows: raising the baseline is an operator+log decision (L6), not
 *     something this test may do to pass.
 * Fixing the other 208 is a dedicated cleanup task (the backlog), most
 * likely by re-running `scripts/extract-error-codes.js` against the current
 * tree and reviewing each relocation — not a one-line fix like this round's.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ERROR_CODES } = require('../../shared/error-codes');

const BACKEND_ROOT = path.join(__dirname, '..', '..');
const SOURCE_PATTERN = /^(.+):(\d+)$/;
const WINDOW = 2;

const fileLineCache = new Map();

function linesOf(relPath) {
    if (!fileLineCache.has(relPath)) {
        const abs = path.join(BACKEND_ROOT, relPath);
        fileLineCache.set(
            relPath,
            fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n') : null,
        );
    }
    return fileLineCache.get(relPath);
}

/**
 * Frozen baseline of pre-existing source-pointer drift, captured 2026-09-26
 * (see the file header). `INVALID_ISSUER_SIDE` is deliberately NOT in this
 * list — this fix round corrected it (1173 → 1144). Shrinking this list (as
 * pointers get fixed) is always welcome; growing it silently is not — an
 * addition here without a matching fix commit is exactly the regression this
 * test exists to catch.
 */
const KNOWN_PREEXISTING_DRIFT = new Set([
    'ACCOUNT_LOCKED', 'ALREADY_ACTIVE', 'ALREADY_PAID', 'AMBIGUOUS_INVITEE', 'AMOUNT_MISMATCH',
    'AMOUNT_VERIFICATION_REQUIRED', 'APPLICANT_VALIDATION_FAILED', 'APPLICATION_DELETED', 'APPLICATION_INCOMPLETE', 'APPLICATION_NOT_EDITABLE',
    'APPLICATION_NOT_FOUND', 'APPLICATION_NOT_JUDGEABLE', 'AUDIT_APPLICATION_MISMATCH', 'AUDIT_AUDITOR_MISMATCH', 'AUDIT_NOT_FOUND', 'AUDIT_STATUS_INVALID',
    'AUTH_AUTOPROVISION_DISABLED', 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN', 'AUTH_FAILED', 'AUTH_IDP_PROFILE_INCOMPLETE', 'AUTH_LINKING_PENDING', 'AUTH_PROVIDER_DISABLED',
    'AUTH_PROVIDER_NOT_CONFIGURED', 'AUTH_PROVIDER_UNKNOWN', 'AUTH_STATE_INVALID', 'AUTH_STATE_SECRET_MISSING', 'BANK_ACCOUNT_MANAGE_FORBIDDEN', 'BANK_ACCOUNT_READ_FORBIDDEN',
    'BANK_RECONCILIATION_FORBIDDEN', 'BATCH_NUMBER_CONFLICT', 'BUNDLE_APPLICATION_NOT_DRAFT', 'BUNDLE_TERMINAL_APPLICATION', 'CANNOT_DEMOTE_OWNER', 'CANNOT_REVOKE_OWNER',
    'CAPABILITY_DENIED', 'CERTIFICATION_EVALUATOR_UNKNOWN', 'CERTIFICATION_SOD_VIOLATION', 'CHECKLIST_ITEMS_REQUIRED', 'CHECKLIST_ITEM_UNKNOWN', 'CONCURRENCY_CONFLICT',
    'CONFLICT', 'CONSENT_REQUIRED', 'CRITICAL_CHECKLIST_FAILURE', 'CROSS_TENANT_WRITE', 'CSRF_MISMATCH', 'CYCLE_FARM_MISMATCH',
    'CYCLE_FROZEN', 'CYCLE_PLANT_COUNT_ZERO', 'CYCLE_PLOT_AREA_EXCEEDED', 'CYCLE_PLOT_AREA_ZERO', 'CYCLE_PLOT_UNKNOWN', 'DAILY_CASH_FORBIDDEN',
    'DECLARATIONS_REQUIRED', 'DISCLOSURE_STATE_REQUIRED', 'DISCLOSURE_UPDATE_FAILED', 'DOCUMENT_CHECK_INCOMPLETE', 'DOCUMENT_CHECK_NOTHING_REQUESTED', 'DOCUMENT_DECISION_WRONG_STATE',
    'DOCUMENT_REVIEW_FAILED', 'DUPLICATE_PHOTO', 'DUPLICATE_PURCHASE_INVOICE',
    'EVIDENCE_CAPTURE_UNAVAILABLE', 'FORBIDDEN_BOOK_SIDE', 'HEALTH_ROLE_REQUIRED', 'IDENTITY_CONFLICT', 'IDENTITY_UNVERIFIED', 'IMMUTABLE_FIELD',
    'INACTIVE_ACCOUNT', 'INCOMPLETE_CHECKLIST', 'INSUFFICIENT_PHOTOS', 'INVALID_ACCOUNT_TYPE', 'INVALID_CATEGORY', 'INVALID_CREDENTIALS',
    'INVALID_CYCLE_STATUS', 'INVALID_FILE_TYPE', 'INVALID_INVITE_CHANNEL', 'INVALID_PASSWORD', 'INVALID_PERMISSION', 'INVALID_PHASE',
    'INVALID_PROVIDER_ID', 'INVALID_PROVIDER_ROLE', 'INVALID_QUOTATION_STATUS', 'INVALID_REVIEWER_SIDE', 'INVALID_ROLE', 'INVALID_SLIP_STATE',
    'INVALID_STATE_FOR_UPLOAD', 'INVALID_STATUS', 'INVALID_TAX_ID', 'INVALID_TOKEN', 'INVALID_WORKSPACE_TYPE', 'INVOICE_LISTING_FORBIDDEN',
    'LOT_WEIGHT_QUOTA_EXCEEDED', 'METHOD_NOT_ALLOWED', 'MISSING_CREDENTIALS', 'MISSING_TARGET', 'NON_CANONICAL_STATUS', 'NOT_INVITED',
    'NOT_OWNER', 'NOT_PENDING', 'NOT_THE_ASSIGNED_REVIEWER', 'NO_DEFAULT_ORG', 'NO_IDENTITY', 'NO_ONSITE_AUDIT',
    'NO_ORGANIZATION', 'NO_REPLACEMENT', 'NO_TOKEN', 'ONSITE_NOT_AVAILABLE', 'PATH_TRAVERSAL_BLOCKED',
    'PAYMENT_SLIP_READ_FORBIDDEN', 'PAYMENT_SLIP_REVIEW_FORBIDDEN', 'PAYMENT_TERMS_NOT_ACCEPTED', 'PAYMENT_TERMS_NOT_WITHDRAWABLE', 'PDPA_ALREADY_DELETED', 'PDPA_ERASURE_BAD_STATUS',
    'PDPA_ERASURE_EXPIRED', 'PDPA_ERASURE_INVALID_TOKEN', 'PDPA_ERASURE_IN_PROGRESS', 'PDPA_ERASURE_NOT_FOUND', 'PDPA_LEGAL_HOLD', 'PDPA_PASSWORD_REQUIRED',
    'PHOTO_FILE_REQUIRED', 'PHOTO_GPS_REQUIRED', 'PLANTING_REQUIRES_CERTIFICATE', 'PLOT_ALREADY_HAS_OPEN_CYCLE', 'POSTED_CN_IRREVERSIBLE', 'PRISMA_UNAVAILABLE',
    'PROVIDER_ID_EDIT_FORBIDDEN', 'PROVIDER_ROLE_REQUIRED', 'PURCHASE_INVOICE_DELETED', 'PURCHASE_INVOICE_NOT_FOUND', 'QR_REQUIRES_ACTIVE_CERTIFICATE', 'QUOTATION_EXPIRED',
    'QUOTATION_GATE_UNAVAILABLE', 'QUOTATION_ISSUE_FAILED', 'QUOTATION_NOT_ACCEPTED', 'QUOTATION_NOT_FOUND', 'QUOTATION_NOT_ISSUED', 'QUOTATION_NUMBER_DB_UNAVAILABLE',
    'RATE_LIMIT_EXCEEDED', 'RECEIPT_SEQUENCE_MODEL_MISSING', 'REFUND_ALREADY_COMPLETED', 'REFUND_FAILED', 'REFUND_NOT_FOUND', 'REQUEST_FAILED',
    'REQUIREMENTS_RESOLUTION_FAILED', 'RESOLVE_CODE_REQUIRED', 'RESOLVE_FAILED', 'REVIEW_DUE_DATE_INVALID', 'REVIEW_REASON_REQUIRED', 'REVIEW_SLOT_NOT_ATTACHED',
    'REVISION_DEADLINE_EXCEEDED', 'REVISION_INCOMPLETE', 'REVISION_RESUBMIT_WRONG_STATE', 'ROLE_ADMIN_CANNOT_BE_LAST', 'SAME_USER',
    'SELF_DISABLE_FORBIDDEN', 'SELF_PERMISSION_CHANGE_FORBIDDEN', 'SELF_ROLE_CHANGE_FORBIDDEN', 'SERVER_ERROR', 'SESSION_REVOKED', 'SIGNED_URL_BAD_KEY',
    'SIGNED_URL_KEY_UNAVAILABLE', 'SLIP_ALREADY_PROCESSED', 'SNAPSHOT_REQUIRED', 'STEP_PREREQUISITE_UNMET', 'STORAGE_CLOUD_UNAVAILABLE', 'STORAGE_UPLOAD_FAILED',
    'TARGET_ALREADY_OWNER', 'TARGET_NOT_MEMBER', 'TOKEN_EXPIRED', 'TOKEN_INVALID', 'TOKEN_MISSING', 'TOKEN_NO_JTI',
    'TOKEN_PAYLOAD_INVALID', 'TOKEN_REVOKED', 'TRACE_BASE_URL_REQUIRED_IN_PROD', 'UNBALANCED_TOTALS', 'UNKNOWN_MILESTONE', 'UNSAFE_FILENAME',
    'UPLOAD_REJECTED', 'USER_NOT_FOUND', 'VERIFICATION_REQUIRED', 'WAIVER_ALREADY_DECIDED', 'WAIVER_ALREADY_PENDING', 'WAIVER_ALREADY_USED',
    'WAIVER_BATCH_APPROVER_REQUIRED', 'WAIVER_BATCH_BUGREF_REQUIRED', 'WAIVER_BATCH_EMPTY', 'WAIVER_BUGREF_ALREADY_REMEDIATED', 'WAIVER_DENY_NOTE_REQUIRED',
    'WAIVER_FEE_NOT_SETTLED', 'WAIVER_NOT_ASSIGNED', 'WAIVER_NOT_EXPIRED', 'WAIVER_ORIGIN_UNKNOWN', 'WAIVER_REASON_CODE_INVALID', 'WAIVER_REASON_REQUIRED',
    'WAIVER_REOPEN_REQUIRED', 'WAIVER_ROLE_FORBIDDEN', 'WAIVER_STATE_DRIFT', 'WEBHOOK_PROCESSING_FAILED', 'WHT_CERTIFICATE_ALREADY_RECORDED',
]);

/** `{ key, relPath, lineNum }` for every source matching the uniform `<path>:<line>` form. */
function parseableEntries() {
    const parsed = [];
    const unparseable = [];
    for (const [key, entry] of Object.entries(ERROR_CODES)) {
        const m = SOURCE_PATTERN.exec(entry.source);
        if (!m) {
            unparseable.push(`${key}: source is not "<path>:<line>" (${JSON.stringify(entry.source)})`);
            continue;
        }
        parsed.push({ key, relPath: m[1], lineNum: Number(m[2]) });
    }
    return { parsed, unparseable };
}

/** True if the file exists and its ±WINDOW lines around lineNum mention `key`. */
function pointerIsAccurate({ key, relPath, lineNum }) {
    const lines = linesOf(relPath);
    if (lines === null) return false;
    const start = Math.max(0, lineNum - 1 - WINDOW);
    const end = Math.min(lines.length, lineNum - 1 + WINDOW + 1);
    return lines.slice(start, end).join('\n').includes(key);
}

describe('shared/error-codes.js — every source pointer', () => {
    const { parsed, unparseable } = parseableEntries();

    it('the source format is uniform enough to check mechanically (report if not)', () => {
        // Fallback per the coordinator's own instruction: if this ever fails,
        // the check above should be widened to cover whatever new shape
        // appeared — not silently skip the codes that no longer parse.
        expect(unparseable).toEqual([]);
    });

    it('no NEW pointer has drifted beyond the known 2026-09-26 baseline (catches the INVALID_ISSUER_SIDE class of regression)', () => {
        const newlyBad = [];
        for (const entry of parsed) {
            if (KNOWN_PREEXISTING_DRIFT.has(entry.key)) continue; // pre-existing, tracked below
            if (!pointerIsAccurate(entry)) {
                newlyBad.push(`${entry.key}: ${entry.relPath}:${entry.lineNum} (±${WINDOW}) does not mention "${entry.key}"`);
            }
        }
        if (newlyBad.length > 0) {
            throw new Error(
                `${newlyBad.length} source pointer(s) OUTSIDE the known baseline have drifted:\n${newlyBad.join('\n')}`,
            );
        }
    });

    it('the baseline names only codes that actually still need fixing (no over- or under-claim)', () => {
        // Two failure shapes on purpose, reported separately:
        //   - a listed code that now passes (fixed but the list was not
        //     shrunk) — shrink the baseline, don't leave a stale entry;
        //   - a listed code that no longer exists in the catalogue at all
        //     (renamed/removed) — same fix, remove the stale entry.
        const staleFixed = [];
        const staleGone = [];
        for (const codeName of KNOWN_PREEXISTING_DRIFT) {
            const entry = parsed.find((p) => p.key === codeName);
            if (!entry) {
                staleGone.push(codeName);
                continue;
            }
            if (pointerIsAccurate(entry)) staleFixed.push(codeName);
        }
        if (staleFixed.length > 0 || staleGone.length > 0) {
            throw new Error(
                [
                    staleFixed.length > 0 ? `${staleFixed.length} baseline entr(y/ies) are already fixed, shrink KNOWN_PREEXISTING_DRIFT: ${staleFixed.join(', ')}` : null,
                    staleGone.length > 0 ? `${staleGone.length} baseline entr(y/ies) no longer exist in ERROR_CODES, remove from KNOWN_PREEXISTING_DRIFT: ${staleGone.join(', ')}` : null,
                ].filter(Boolean).join('\n'),
            );
        }
    });

    it('INVALID_ISSUER_SIDE is fixed by this round and is not in the baseline', () => {
        expect(KNOWN_PREEXISTING_DRIFT.has('INVALID_ISSUER_SIDE')).toBe(false);
        const entry = parsed.find((p) => p.key === 'INVALID_ISSUER_SIDE');
        expect(entry).toBeDefined();
        expect(pointerIsAccurate(entry)).toBe(true);
    });

    it('every parseable source file exists for baseline entries too (so a MISSING file is never silently swallowed)', () => {
        const missingFiles = [];
        for (const entry of parsed) {
            if (linesOf(entry.relPath) === null) missingFiles.push(`${entry.key}: ${entry.relPath}`);
        }
        // Every currently-missing-file code is expected to be in the baseline
        // (16 as of 2026-09-26) — a NEW missing-file pointer is a regression.
        const unexpected = missingFiles.filter((m) => !KNOWN_PREEXISTING_DRIFT.has(m.split(':')[0]));
        if (unexpected.length > 0) {
            throw new Error(`${unexpected.length} NEW pointer(s) name a file that does not exist:\n${unexpected.join('\n')}`);
        }
    });
});
