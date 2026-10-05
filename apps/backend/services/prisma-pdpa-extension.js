/**
 * Prisma PDPA Field-Encryption Extension
 *
 * System deep-dive Tier 5 — DBA F-01 + Security C-1 (2026-05-15):
 * Iter 27 (PDPA Phase 2, 2026-05-16):
 *
 * Transparent at-rest encryption for PDPA-sensitive User columns. Uses
 * Prisma `$extends` to intercept query operations and wrap them with
 * `field-encryption.js`'s AES-256-GCM cipher. New writes store the
 * ciphertext with a `enc:v1:` version prefix; legacy plaintext rows pass
 * through unchanged on read (backward compatible).
 *
 * ## Phase 1 scope (original, 2026-05-15)
 *
 * ONLY columns that are NEVER used in WHERE clauses across the codebase.
 * Repo grep confirmed these are display-only PII (caller filters by FK
 * `userId`, then reads these columns for rendering — never queries by
 * value):
 *
 *   - `idCard` (Thai national ID image / scan reference)
 *   - `taxId` (corporate tax ID)
 *   - `laserCode` (Thai ID laser code — schema comment said "Encrypted" but never was)
 *   - `communityRegistrationNo`
 *   - `address`, `province`, `district`, `subdistrict`, `zipCode`
 *
 * ## Phase 2 scope (Iter 27, 2026-05-16)
 *
 * Iter 27 audited the remaining PII fields against `grep -rn "where:"`:
 *   - `phoneNumber`: zero WHERE matches across `apps/backend/**` — safe to
 *     encrypt. ADDED to Phase 2.
 *   - `email`: heavily WHERE-filtered (login, password reset, lookup).
 *     Encryption requires migrating callers to a parallel `emailHash`
 *     column (HMAC-SHA-256) for the lookup path. NOT yet wired — the
 *     extension hashes only at write time when an `emailHash` column
 *     is present on the schema; the plaintext `email` column stays as
 *     today until a follow-up migration adds the lookup column + flips
 *     callers over. See `prisma/schema/auth.prisma` TODO.
 *   - `Certificate.applicantName` + `Certificate.address`: display fields
 *     on the certificate render path; no WHERE matches. ADDED to Phase 2.
 *   - `Application.formData` (JSON): contains free-form applicant PII
 *     blobs (applicantName, applicantPhone, ...) AND — the LAST live
 *     plaintext national ID after STAGE A/A.2/B — the 13-digit ID under the
 *     national-ID-class keys id_card / tax_id / idCard / taxId /
 *     presidentIdCard / directorIdCard / communityRegNumber.
 *     STAGE-formData (national-id-detokenize RFC) adds a per-model
 *     `application` create/update/updateMany/upsert hook that DEEP-WALKS the
 *     formData Json value and encrypts ONLY those national-ID-class leaves
 *     (via utils/formdata-pii.js `encryptFormDataPii`) — NOT the whole column
 *     (column-level JSON encryption would defeat all Prisma JSON filtering,
 *     e.g. metrics-service.js `$queryRaw formData->>'plantId'`). Decrypt on
 *     read is the generic B1 `decryptResultTree` walker (a parsed Json column
 *     is nested plain objects/arrays in the result tree). Names/phone/address
 *     stay plaintext (deferred-PII decision). See
 *     `docs/security/pdpa-erasure-2026-05-16.md` + utils/formdata-pii.js header.
 *
 * ## NOT in Phase 1/2 (would break queries)
 *
 *   - `healthId` (heavily WHERE-filtered for applicant lookups)
 *   - `providerId` (WHERE-filtered for DTAM staff lookups)
 *   - `email` (still plaintext — see above)
 *
 * These three require a future migration that:
 *   1. Updates every `findFirst({ where: { healthId: 'x' } })` call site
 *      to use `findFirst({ where: { healthIdHash: hashData('x') } })`
 *      first (look up by deterministic HMAC), then verify the decrypted
 *      column matches expected. The `healthIdHash` column already exists
 *      in the schema for exactly this purpose.
 *   2. Then adds healthId / providerId / email to the encryption list.
 *
 * ## Env gate
 *
 * `ENABLE_PDPA_FIELD_ENCRYPTION=true` enables the extension. Default
 * (off) is the legacy plaintext behavior — the extension factory just
 * returns the input client untouched.
 */

const logger = require('../shared/logger');
const { encrypt, decrypt, hashData } = require('../utils/field-encryption');
// STAGE-formData (national-id-detokenize RFC) — the deep-walk leaf encrypt for
// the Application.formData Json column. Lives in utils/ (pure data transform,
// no Prisma coupling) so it is trivially unit-testable and importing it here
// creates no cycle.
const { encryptFormDataPii } = require('../utils/formdata-pii');

// Columns safe to encrypt in Phase 1 (never used in WHERE clauses).
// Re-verify with `grep -rn "where:.*<column>" apps/backend/` before adding.
//
// NOTE (STAGE B3, 2026-06-29): these two historical "phase" lists are kept
// as the original audit anchors (Iter 27 anchor test asserts against them
// verbatim). They are NO LONGER the runtime encrypt set on their own —
// STAGE B3 re-derives the authoritative ACTIVE set (`ALL_USER_PII_COLUMNS`)
// as (Phase1 ∪ Phase2 ∪ Phase3-national-ID) MINUS the columns that a B3
// grep-audit found are searched / sorted / grouped on the RAW value
// (`DEFERRED_PII_COLUMNS`). Encrypting one of those would silently break a
// search/sort/group (AES-GCM is random-IV → no WHERE-equality / contains /
// orderBy / groupBy / raw-SQL JOIN possible).
const PHASE_1_PII_COLUMNS = Object.freeze([
    'idCard',
    'taxId',
    'laserCode',
    'communityRegistrationNo',
    'address',
    'province',
    'district',
    'subdistrict',
    'zipCode',
]);

// Iter 27 — Phase 2 additions for User. The Phase 1 list is kept stable
// because the original anchor-list test asserts against it; Phase 2 is a
// SEPARATE list so the audit story is explicit. The runtime treats both
// lists as a single set when encrypting/decrypting.
const PHASE_2_USER_PII_COLUMNS = Object.freeze([
    'phoneNumber',
    'firstName',
    'lastName',
]);

// STAGE B3 (detokenize RFC, 2026-06-29) — the NATIONAL-ID-class columns this
// cutover actually targets (the whole point of the RFC: the Thai 13-digit ID
// must not be recoverable from a Postgres dump). Each grep-verified to be
// looked-up ONLY by the parallel keyed `*Hmac`/`*Hash` columns (login + every
// lookup goes through `user-lookup-service.js`, which prefers
// `healthIdHmac`/`providerIdHmac`), and otherwise display-only — NEVER a raw
// WHERE-equality / orderBy / groupBy / raw-SQL JOIN on the value:
//   - healthId  : raw WHERE only in user-lookup-service.js:143 (fail-SAFE
//                 fallback — returns null on an encrypted value, primary path
//                 is healthIdHmac/Hash); no orderBy/groupBy/raw-SQL.
//   - providerId: raw WHERE only in user-lookup-service.js:184 (same fail-safe
//                 fallback); no orderBy/groupBy/raw-SQL.
//   - idCard (column `idCard_deprecated`): zero WHERE/orderBy/groupBy/raw-SQL.
//   - taxId / communityRegistrationNo / laserCode: zero WHERE/orderBy/groupBy.
const PHASE_3_NATIONAL_ID_COLUMNS = Object.freeze([
    'healthId',
    'providerId',
    'idCard',
    'taxId',
    'communityRegistrationNo',
    'laserCode',
]);

// STAGE B3 — DEFERRED: columns present in the historical Phase 1/2 lists that
// a B3 grep-audit proved are searched / sorted / grouped on the RAW value, so
// they CANNOT be encrypted without silently breaking those queries. Removed
// from the active set for THIS cutover (the goal is the NATIONAL ID at rest
// with minimal blast radius — err toward DEFER). Evidence (file:line):
//   - province   : raw `GROUP BY u.province` in metrics-service.js:131
//                  (applicantsByProvince dashboard).
//   - firstName  : contains-search admin/users.js:163 +
//                  provider/applications.js:206; orderBy:{firstName} in
//                  provider-user-service.js:246,362.
//   - lastName   : contains-search admin/users.js:164 +
//                  provider/applications.js:207; orderBy:{lastName}.
//   - phoneNumber: WHERE-equality entity-service.js:1349
//                  (`where:{ phoneNumber: v }`).
// (Encrypting any of these is a follow-up that requires a parallel hash/token
//  lookup or relaxing the search — NOT in scope for the national-ID cutover.)
const DEFERRED_PII_COLUMNS = Object.freeze([
    'province',
    'firstName',
    'lastName',
    'phoneNumber',
]);

// Authoritative ACTIVE encrypt set for `User`, used by BOTH the runtime hook
// bodies AND the encrypt-backfill script. Order does not matter — the loops
// iterate once per column. De-duplicated and with DEFERRED columns removed.
const ALL_USER_PII_COLUMNS = Object.freeze(
    [
        ...PHASE_1_PII_COLUMNS,
        ...PHASE_2_USER_PII_COLUMNS,
        ...PHASE_3_NATIONAL_ID_COLUMNS,
    ].filter((col, idx, arr) => arr.indexOf(col) === idx && !DEFERRED_PII_COLUMNS.includes(col)),
);

// Per-model encryption scope. `User` is the original target; `Certificate`
// gained address in Iter 27 to align with the cert-render PDPA disclosure
// surface.
//
// STAGE B3 — `applicantName` is DEFERRED: it is contains-searched on
// `prisma.certificate.findMany` in interoperability.js:249
// (`{ applicantName: { contains: search } }`), so encrypting it would break
// the registry search. `Certificate.address` has zero WHERE/contains/orderBy/
// groupBy → kept.
//
// ROUND-2 (close-natid-round2, 2026-06-30) — `issuedBy` + `signedBy` ADDED.
// These two scalar columns hold the issuer/signer identity. The AUDIT_PASSED
// single-auditor auto-issue path stamps `actorId = req.user.id` (a User UUID,
// NOT a national ID — application-status-writer.js / audit-onsite-service.js),
// but the two API callers (provider/auditor.js final-approve + provider/
// handlers/workflow-side-effects.js APPROVED hook) pass
// `req.user.providerId || req.user.id` → a 13-digit national ID when a
// providerId is present. Encrypting the columns makes that ID unrecoverable
// from a Postgres dump; the ROUND-2 source fix (stamp req.user.id at those two
// callers) eliminates it at the WRITE so it never reaches a rendered surface
// either (see cert_display_finding in the handoff). Grep-verified there is NO
// WHERE / orderBy / groupBy / distinct on `Certificate.issuedBy` or
// `Certificate.signedBy` anywhere (the only reads — certificate-service.js
// documentHash canonical, interoperability-trace-events.js actorId, admin
// cert detail-view "ออกโดย" — are display-only; decrypt-on-read via the B1
// walker keeps them working). The documentHash is computed over the
// PRE-encryption `certData` (the encrypt hook runs at the prisma boundary,
// after the hash is built), so the integrity hash is unaffected.
//
// B2 (PDPA-LEAK cluster, carpet-bomb-inversion-audit-2026-07-06) —
// `revokedReason` ADDED. It is OPERATOR FREE TEXT written plaintext at revoke
// (certificate-service.js revokeCertificate / reverse-pass), and was in NO
// encrypt set → a reviewer who types an applicant's 13-digit national ID into
// the reason leaked it into a Postgres dump AND onto the public trust API. This
// is the whole-column-encrypt half (mirrors ApplicationComment.content /
// Invoice.notes): the encrypt runs at the extension boundary on write, so no
// cert-service edit is needed. Grep-verified there is NO WHERE / orderBy /
// groupBy / distinct on `Certificate.revokedReason` (the revocation feed filters
// on revokedAt/status; computeTrustStatus reads it only as a truthiness flag;
// every projection is display-only + decrypt-on-read via the B1 walker), so
// whole-column encrypt is query-safe. The PUBLIC-projection half — masking the
// decrypted value before it is broadcast on /verify + the partner feeds — lives
// in interoperability-core.js (buildTrustRecord / buildCertificateEnvelope) +
// interoperability.js (revocation feed), because the extended client decrypts it
// back to plaintext before it reaches the route.
// SHOULD-B2b (2026-07-06) — `deleteReason` ADDED. The A2 audit-pass-reversal
// void (certificate-service.js revokeCertificateForApplication:1022) writes the
// operator comment ("Audit pass reversed: <comment>") into BOTH `revokedReason`
// AND `deleteReason`; only `revokedReason` was encrypted → a dump grep of \d{13}
// recovered a national ID from the plaintext `deleteReason`. Whole-column encrypt
// at the write hook (no cert-service edit). Grep-verified `Certificate.deleteReason`
// is never used in a WHERE / orderBy / groupBy / distinct (sole writer is the
// data.deleteReason above), so this is query-safe; legacy rows pass through the
// B1 read walker unchanged.
const CERTIFICATE_PII_COLUMNS = Object.freeze([
    'address',
    'issuedBy',
    'signedBy',
    'revokedReason',
    'deleteReason',
]);

// STAGE B3 — Entity encryption scope. `Entity.thaiCitizenId` is a SECOND
// plaintext national ID (entity-service.js:262 writes `thaiCitizenId:
// user.healthId`). Grep-verified display-only / hash-looked-up: dedup +
// personal-entity resolution use `thaiCitizenIdHash` (legacy raw SHA-256) or
// the B2 keyed `thaiCitizenIdHmac` (entity-service.js:240-242,888-889), NEVER a
// raw WHERE/orderBy/groupBy on `thaiCitizenId`. Decrypt-on-read is already
// generic via the B1 `decryptResultTree` walker (covers nested
// application→entity / entityMembership→entity includes).
//
// ROUND-2 (close-natid-round2, 2026-06-30) — `juristicId` ADDED. It is the
// JURISTIC entity's Thai 13-digit registration number (a same-class national
// ID the codebase already protects on User.taxId). entity-service.js dedups +
// looks up JURISTIC entities ONLY by the parallel `juristicIdHash`
// (`findFirst({ where: { type, juristicIdHash } })`, entity-service.js:1095-1097;
// `@@unique([type, juristicIdHash])`, entity.prisma:110), NEVER a raw WHERE /
// orderBy / groupBy on the plaintext `juristicId` (grep-verified: the only
// `juristicId` reads — applicant-resolver, entities/index, vat-report-service —
// are display-only, decrypted by the B1 walker on read). So encrypting the
// plaintext column is dedup-safe.
const ENTITY_PII_COLUMNS = Object.freeze([
    'thaiCitizenId',
    'juristicId',
]);

// ROUND-2 (close-natid-round2, 2026-06-30) — Entity JSON column scope. The
// `payload` Json column (entity.prisma:68 — the ONLY Json column on Entity)
// carries the structured juristic/community extras built by
// entity-service.js buildJuristicPayload / buildCommunityPayload, which nest a
// 13-digit national ID under `director.idCard` (juristic) and
// `president.idCard` (community). Those keys are NOT in the formData key
// allowlist, but the Mod-11 VALUE-net in encryptFormDataPii catches any
// 13-digit Thai-ID-valid STRING leaf under ANY key, so it covers them. No code
// does a value-equality JSON-path query on Entity.payload (it is read whole for
// display + decrypted by the B1 walker), so deep-walking it is query-safe.
// Mirrors APPLICATION_JSON_PII_COLUMNS exactly.
const ENTITY_JSON_PII_COLUMNS = Object.freeze([
    'payload',
]);

// Version marker — every new encrypted value starts with this string.
// Legacy plaintext rows lack it and pass through unchanged on read.
// If the cipher algorithm ever changes, bump the version (e.g. 'enc:v2:').
const VERSION_PREFIX = 'enc:v1:';

// Bug 7.4 adversarial-verify finding 1: decryptValue runs per encrypted leaf
// inside the read walker (decryptResultTree), so on a key-rotation / corrupt-
// key fault a single bulk read would emit O(rows × PII-columns) identical error
// lines — enough to fill the shared droplet's disk (→ Redis AOF write fail →
// auth 401, a documented prior incident). This counter throttles the log to the
// FIRST failure + every 1000th thereafter, so the fault is still surfaced
// loudly without flooding.
let decryptFailureCount = 0;

function encryptValue(plain) {
    if (plain === null || plain === undefined) {return plain;}
    if (typeof plain !== 'string') {return plain;}
    if (plain === '') {return plain;}
    if (plain.startsWith(VERSION_PREFIX)) {return plain;} // already encrypted, idempotent
    const ciphertext = encrypt(plain);
    return VERSION_PREFIX + ciphertext;
}

function decryptValue(stored) {
    if (stored === null || stored === undefined) {return stored;}
    if (typeof stored !== 'string') {return stored;}
    if (!stored.startsWith(VERSION_PREFIX)) {return stored;} // legacy plaintext, pass through
    let plain;
    try {
        plain = decrypt(stored.slice(VERSION_PREFIX.length));
    } catch (_err) {
        // decrypt() is not supposed to throw (field-encryption.js catches
        // internally and returns null) — but be defensive if that ever changes.
        plain = null;
    }
    // Bug 7.2: field-encryption.decrypt() returns `null` (NOT a throw) on any
    // failure — rotated key, auth-tag mismatch, corrupt ciphertext. The old
    // try/catch marker was therefore UNREACHABLE and this fell through to
    // returning null, silently dropping the fail-safe. Detect the null-return
    // explicitly. Fail SAFE: return a marker (not the raw ciphertext — that
    // would leak format info; not null — that hides the failure) and log the
    // cause so ops notice a key/ciphertext problem (gold rule #3).
    if (plain === null || plain === undefined) {
        // Throttled — see decryptFailureCount note above (do NOT log per leaf).
        decryptFailureCount += 1;
        if (decryptFailureCount === 1 || decryptFailureCount % 1000 === 0) {
            logger.error(`[pdpa] field decrypt FAILED (rotated key / corrupt ciphertext?) — returning [PII_DECRYPT_FAILED] marker [occurrence #${decryptFailureCount}]`);
        }
        return '[PII_DECRYPT_FAILED]';
    }
    return plain;
}

function encryptUserDataPayload(data) {
    if (!data || typeof data !== 'object') {return data;}
    const result = { ...data };
    for (const col of ALL_USER_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = encryptValue(result[col]);
        }
    }
    return result;
}

function decryptUserRow(row) {
    if (!row || typeof row !== 'object') {return row;}
    const result = { ...row };
    for (const col of ALL_USER_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = decryptValue(result[col]);
        }
    }
    return result;
}

// NOTE: the former `decryptUserRows` / `decryptCertificateRows` array helpers
// were removed in STAGE B1 — the generic `decryptResultTree` walker (below) is
// now the single decrypt path on read, so per-model array fan-out is dead. The
// single-row `decryptUserRow` / `decryptCertificateRow` helpers are kept (and
// still exported) for the encrypt-backfill script + the by-column unit tests.

// STAGE B1 — generic nested-relation decrypt walker
//
// The per-model decrypt helpers above only touch the TOP-LEVEL row. A User /
// Certificate / Entity loaded via a NESTED include from another model
// (application.findMany include applicant, invoice→applicant,
// entityMembership→user, certificate→user, ...) is NOT covered by them — so
// once B3 encrypts healthId/providerId those nested PII fields would come back
// as raw `enc:v1:...` ciphertext to ~25+ finance/reviewer/export read paths.
//
// Encrypted values are SELF-IDENTIFYING (the `enc:v1:` prefix) and
// `decryptValue` is a no-op on any non-prefixed value, so a blanket "decrypt
// any enc:v1: leaf in the result tree" is robust + relation-name-agnostic: it
// covers nested applicant/user/submitter/reviewer/auditor/owner AND Entity AND
// any future relation with no call-site enumeration. Because decryptValue is
// idempotent on plaintext, the walker never double-decrypts and is harmless if
// a (legacy) per-model decrypt already ran on part of the tree.
//
// Performance: the walk is IN PLACE (no deep clone). It skips every leaf that
// CANNOT be an enc:v1: string (numbers/booleans/null/undefined/Date/Decimal
// and any non-plain object), only ever recursing into plain objects + arrays.
// A WeakSet seen-set short-circuits cycles and shared refs; a MAX_DEPTH guard
// bounds pathological nesting. Cost is O(nodes visited) with a single string
// `startsWith` test per string leaf — negligible next to the SQL + Prisma
// hydration that already produced the tree. For a findMany of thousands of
// rows this is a single extra in-memory pass over the already-materialized
// objects (no allocation, no clone).

// Guard against degenerate / adversarial nesting. Prisma include depth is
// bounded in practice well under this; the cap only protects against a
// runaway recursion, never a real query shape.
const MAX_WALK_DEPTH = 100;

// Only PLAIN objects (and arrays) are containers we descend into. Class
// instances Prisma can return — Date, Prisma.Decimal (decimal.js), Buffer —
// are leaves: they are never enc:v1: strings and must be returned by reference
// untouched (descending into a Decimal's internals would be both wrong and
// wasteful).
function isPlainObject(value) {
    if (value === null || typeof value !== 'object') {return false;}
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * Recursively decrypt every `enc:v1:`-prefixed string leaf in a Prisma result
 * tree, IN PLACE. No-op on primitives and non-plain objects. Returns the same
 * (mutated) reference it was given.
 *
 * @param {*} node      the value to walk (object, array, or any leaf)
 * @param {WeakSet}     [seen] cycle / shared-ref guard (internal)
 * @param {number}      [depth] current recursion depth (internal)
 */
function decryptResultTree(node, seen = new WeakSet(), depth = 0) {
    // Leaves: decrypt a self-identifying ciphertext string, otherwise return
    // as-is. Numbers/booleans/null/undefined/non-prefixed strings all short
    // out here without touching the cipher.
    if (typeof node === 'string') {
        return node.startsWith(VERSION_PREFIX) ? decryptValue(node) : node;
    }
    if (node === null || typeof node !== 'object') {return node;}

    // Depth guard + cycle/shared-ref guard. We only ever put container objects
    // (plain objects / arrays) into the seen-set, so a shared LEAF is fine.
    if (depth >= MAX_WALK_DEPTH) {return node;}
    if (seen.has(node)) {return node;}

    if (Array.isArray(node)) {
        seen.add(node);
        for (let i = 0; i < node.length; i++) {
            const el = node[i];
            if (typeof el === 'string') {
                if (el.startsWith(VERSION_PREFIX)) {node[i] = decryptValue(el);}
            } else if (el !== null && typeof el === 'object') {
                decryptResultTree(el, seen, depth + 1);
            }
        }
        return node;
    }

    // Non-plain objects (Date, Prisma.Decimal, Buffer, custom class instances)
    // are leaves — never enc:v1: and unsafe to descend into.
    if (!isPlainObject(node)) {return node;}

    seen.add(node);
    for (const key of Object.keys(node)) {
        const val = node[key];
        if (typeof val === 'string') {
            if (val.startsWith(VERSION_PREFIX)) {node[key] = decryptValue(val);}
        } else if (val !== null && typeof val === 'object') {
            decryptResultTree(val, seen, depth + 1);
        }
    }
    return node;
}

function encryptCertificateDataPayload(data) {
    if (!data || typeof data !== 'object') {return data;}
    const result = { ...data };
    for (const col of CERTIFICATE_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = encryptValue(result[col]);
        }
    }
    return result;
}

function decryptCertificateRow(row) {
    if (!row || typeof row !== 'object') {return row;}
    const result = { ...row };
    for (const col of CERTIFICATE_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = decryptValue(result[col]);
        }
    }
    return result;
}

// STAGE B3 / ROUND-2 — Entity encrypt-on-write payload. Two parts:
//   1. by-column scalars (ENTITY_PII_COLUMNS = thaiCitizenId + juristicId) —
//      mirrors the user / certificate helpers.
//   2. JSON-leaf (ENTITY_JSON_PII_COLUMNS = payload) — deep-walk the Json value
//      via encryptFormDataPii (Mod-11 value-net catches director.idCard /
//      president.idCard under any key), mirroring encryptApplicationDataPayload
//      EXACTLY (handle the Prisma `{ set: ... }` write shape via
//      encryptJsonColumnValue; copy-on-first-write so a payload that touches
//      NEITHER a scalar PII column NOR a JSON column returns the SAME reference
//      → flag-OFF parity + minimal allocation).
// `encryptJsonColumnValue` is defined below `encryptEntityDataPayload` in source
// order but is hoisted (function declaration), so referencing it here is safe.
function encryptEntityDataPayload(data) {
    if (!data || typeof data !== 'object') {return data;}
    let result = data;
    // 1. scalar by-column
    for (const col of ENTITY_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            const encrypted = encryptValue(result[col]);
            if (encrypted !== result[col]) {
                if (result === data) { result = { ...data }; }
                result[col] = encrypted;
            }
        }
    }
    // 2. JSON-leaf deep-walk
    for (const col of ENTITY_JSON_PII_COLUMNS) {
        if (!(col in result)) { continue; }
        const encrypted = encryptJsonColumnValue(result[col]);
        if (encrypted !== result[col]) {
            if (result === data) { result = { ...data }; }
            result[col] = encrypted;
        }
    }
    return result;
}

// STAGE B3 — single-row Entity decrypt (exported for the encrypt-backfill
// script + by-column unit tests; the read path uses the generic
// decryptResultTree walker, which already covers Entity nested includes).
function decryptEntityRow(row) {
    if (!row || typeof row !== 'object') {return row;}
    const result = { ...row };
    for (const col of ENTITY_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = decryptValue(result[col]);
        }
    }
    return result;
}

// ROUND-2 (close-natid-round2, 2026-06-30) — PurchaseInvoice scalar by-column
// scope. `supplierTaxId` is the supplier's Thai 13-digit TIN (ม.86/4), the
// same national-ID class the codebase already protects (User.taxId /
// Entity.juristicId). It previously sat plaintext in `purchase_invoices`
// AND in `audit_logs.metadata` (purchase-invoice-service.js safeAudit) — both
// dump-readable.
//
// DEDUP / UNIQUE divergence (verified, NOT the prompt's assumed hash lookup):
// the pre-ROUND-2 dedup did a RAW `findFirst({ where: { supplierTaxId,
// invoiceNumber } })` AND the table carried `@@unique([supplierTaxId,
// invoiceNumber])`. A random-IV AES-GCM column cannot carry either (each write
// of the same TIN encrypts differently → the WHERE never matches + the UNIQUE
// never trips). ROUND-2 therefore mirrors the EXACT precedent every other
// encrypted national-ID column uses: a parallel keyed-HMAC lookup column
// `supplierTaxIdHmac` (computeLookupHmac) carries dedup + the
// `@@unique([supplierTaxIdHmac, invoiceNumber])`; the dedup WHERE is rewritten
// to the hash; the plaintext column is then safe to encrypt. See
// purchase-invoice-service.js + the add_purchase_invoice_supplier_tax_hmac /
// drop_purchase_invoice_plaintext_tax_unique migrations.
const PURCHASE_INVOICE_PII_COLUMNS = Object.freeze([
    'supplierTaxId',
]);

// ROUND-2 — PurchaseInvoice encrypt-on-write payload (by-column). Mirrors the
// user / certificate / entity scalar helpers.
function encryptPurchaseInvoiceDataPayload(data) {
    if (!data || typeof data !== 'object') {return data;}
    const result = { ...data };
    for (const col of PURCHASE_INVOICE_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = encryptValue(result[col]);
        }
    }
    return result;
}

// ROUND-2 — single-row PurchaseInvoice decrypt (exported for the encrypt-
// backfill script + by-column unit tests; the read path uses the generic
// decryptResultTree walker, which already covers PurchaseInvoice reads via the
// $allModels catch-all + the explicit per-model read hooks below).
function decryptPurchaseInvoiceRow(row) {
    if (!row || typeof row !== 'object') {return row;}
    const result = { ...row };
    for (const col of PURCHASE_INVOICE_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = decryptValue(result[col]);
        }
    }
    return result;
}

// ROUND-4 (close-natid-round4, 2026-06-30) — Organization scalar by-column
// scope. `Organization.taxId` (tenancy.prisma:54) is the TENANT's billing-
// identity Thai 13-digit tax ID — the same national-ID class the codebase
// already protects on User.taxId / Entity.juristicId / PurchaseInvoice
// .supplierTaxId. It previously sat plaintext in `organizations.taxId` (written
// by routes/api/platform-admin/organizations.js create + update), so a Postgres
// dump leaked it.
//
// DEDUP / UNIQUE finding (verified against tenancy.prisma + the
// 20260427120000_add_organization_table migration — NOT assumed):
//   - The plaintext `taxId` column has NO @unique.
//   - A parallel keyed-hash column `taxIdHash String? @unique` ALREADY EXISTS
//     in the schema (tenancy.prisma:55) AND in the DB (UNIQUE INDEX
//     `organizations_taxIdHash_key`, migration line 58) — it was provisioned
//     up-front but never populated by the route.
//   - No code path does a RAW `where:{ taxId }` dedup/lookup on Organization
//     (grep-verified: the only `organization`+`taxId` hits are the schema, this
//     comment, and the speculative P2002 409 message string — never a query).
// → Because the keyed-hash UNIQUE column + index ALREADY EXIST, NO migration is
//   needed (unlike PurchaseInvoice, which had to ADD supplierTaxIdHmac + swap
//   the unique). The ROUND-4 fix is: (1) encrypt the plaintext `taxId` column
//   here with random-IV AES-GCM (dedup-safe — the uniqueness invariant lives on
//   the deterministic keyed `taxIdHash`, not the ciphertext), and (2) populate
//   `taxIdHash = computeLookupHmac(taxId)` at the create + update write sites in
//   organizations.js so the pre-existing @unique actually enforces tenant-TIN
//   uniqueness. Grep-verified there is NO WHERE / orderBy / groupBy on the
//   plaintext `Organization.taxId`. Decrypt-on-read is the generic B1
//   `decryptResultTree` walker (the $allModels catch-all + the explicit
//   per-model read hooks below).
const ORGANIZATION_PII_COLUMNS = Object.freeze([
    'taxId',
]);

// ROUND-4 — Organization encrypt-on-write payload (by-column). Mirrors the
// user / certificate / entity / purchaseInvoice scalar helpers EXACTLY.
function encryptOrganizationDataPayload(data) {
    if (!data || typeof data !== 'object') {return data;}
    const result = { ...data };
    for (const col of ORGANIZATION_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = encryptValue(result[col]);
        }
    }
    return result;
}

// ROUND-4 — single-row Organization decrypt (exported for the encrypt-backfill
// script + by-column unit tests; the read path uses the generic
// decryptResultTree walker, which already covers Organization reads via the
// $allModels catch-all + the explicit per-model read hooks below).
function decryptOrganizationRow(row) {
    if (!row || typeof row !== 'object') {return row;}
    const result = { ...row };
    for (const col of ORGANIZATION_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = decryptValue(result[col]);
        }
    }
    return result;
}

// Wave-3 chatter (verify F2, 2026-07-02) — ApplicationComment.content is FREE
// TEXT a staffer can paste a national/juristic/tax ID into (e.g. "เลขบัตร
// 1100000000008 ไม่ตรงกับใบสมัคร"). The Mod-11 value-net only catches a leaf
// whose WHOLE value is a 13-digit ID, so an ID mid-sentence would slip the
// net — hence WHOLE-COLUMN encrypt, like the by-column scalar helpers.
// `content` is never searched / sorted / grouped (reads filter on
// applicationId + internalOnly + isDeleted only), so encrypting the full
// string is safe. PRE-EXISTING rows (revision/CAR transition comments — the
// model predates the Wave-3 chatter composer) stay plaintext and pass
// through decryptValue unchanged on read; the 2026-06-30 national-ID-at-rest
// sweep data-grep'd prod and found 0 13-digit IDs in them, so no backfill —
// this hook closes the FORWARD path (free-text composer). Reads auto-decrypt
// via the B1 decryptResultTree walker.
const APPLICATION_COMMENT_PII_COLUMNS = Object.freeze([
    'content',
]);

function encryptApplicationCommentDataPayload(data) {
    if (!data || typeof data !== 'object') {return data;}
    const result = { ...data };
    for (const col of APPLICATION_COMMENT_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            result[col] = encryptValue(result[col]);
        }
    }
    return result;
}

// STAGE-formData — Application / ApplicationDraft Json-leaf encrypt-on-write
// payload. Unlike the by-column User/Certificate/Entity helpers, the targeted
// columns are Json columns whose national-ID leaves are nested arbitrarily
// deep, so we deep-walk each column VALUE via `encryptFormDataPii` (the
// idempotent deep-walk + national-ID-key allowlist + Mod-11 value-net). Only
// the targeted JSON keys present on the write payload are touched; every other
// column passes through unchanged. The B1 `decryptResultTree` walker already
// auto-decrypts the leaves on read (a parsed Json column is just nested plain
// objects/arrays in the result tree), so there is NO matching by-column decrypt
// helper here.
//
// JSON columns that can carry a Thai 13-digit national ID (gap-close 2026-06-29
// — schema-verified against prisma/schema/application.prisma):
//   - formData        : the wizard's free-form applicant data (id_card / tax_id
//                       / idCard / taxId / presidentIdCard / directorIdCard /
//                       communityRegNumber). ORIGINAL STAGE-formData target.
//   - workflowHistory  : a SEPARATE top-level Json column the status-transition
//                       writers populate with the actor's national ID
//                       (actorId / actorHealthId — HEALTH portal id is 13-digit;
//                       provider workflow handlers stamp req.user.providerId,
//                       itself a 13-digit national ID). LATENT GAP 1 — the old
//                       hook only walked `formData`, leaving these plaintext.
//   - previewData      : a render SNAPSHOT built FROM formData on
//                       /preview (preview.js buildPreviewData → application
//                       .update), so it mirrors the SAME applicant national-ID
//                       leaves; covering it closes the derived-copy leak.
// (ApplicationDraft only has `formData`; the other keys are simply absent on a
//  draft write payload and the `key in result` guard skips them.)
//
// The Mod-11 value-net inside encryptFormDataPii makes adding a column SAFE: it
// only ever wraps a STRING leaf that is a valid 13-digit Thai national ID (or a
// national-ID-class key), never a number/timestamp/non-ID string — so walking a
// non-formData JSON column cannot over-encrypt a non-ID value. No code does a
// value-equality JSON-path query on these columns (the only raw formData read,
// metrics-service.js `formData->>'plantId'`, is a plant name, never a 13-digit
// value; the workflowHistory GIN index is a structural containment index, not a
// national-ID value-equality lookup).
const APPLICATION_JSON_PII_COLUMNS = Object.freeze([
    'formData',
    'workflowHistory',
    'previewData',
]);

// Deep-walk-encrypt ONE Json column value, defensively handling Prisma's JSON
// write-helper `{ set: <value> }` shape (the write sites in this codebase always
// assign a bare object, but stay defensive). A null/undefined/scalar value is a
// safe pass-through (encryptFormDataPii is a no-op on non-objects too, but the
// `{ set }` branch must be handled before that).
function encryptJsonColumnValue(value) {
    if (value === null || typeof value !== 'object') { return value; }
    if (!Array.isArray(value) && typeof value.set !== 'undefined') {
        return { ...value, set: encryptFormDataPii(value.set) };
    }
    return encryptFormDataPii(value);
}

function encryptApplicationDataPayload(data) {
    if (!data || typeof data !== 'object') { return data; }
    let result = data;
    for (const col of APPLICATION_JSON_PII_COLUMNS) {
        // Only walk a column that is PRESENT and an object/array value. A
        // missing column, or a scalar / Prisma DbNull / JsonNull, is left
        // untouched (the `key in data` guard mirrors the by-column helpers).
        if (!(col in result)) { continue; }
        const encrypted = encryptJsonColumnValue(result[col]);
        if (encrypted !== result[col]) {
            // Copy-on-first-write so a payload with no walkable column returns
            // the SAME reference (flag-OFF parity + minimal allocation).
            if (result === data) { result = { ...data }; }
            result[col] = encrypted;
        }
    }
    return result;
}

// Invoice.metadata Json-leaf encrypt-on-write payload (gap-close GAP 2,
// 2026-06-29). wht-service.js recordWhtCertificate writes a PLAINTEXT 13-digit
// Thai tax ID (the WHT counterparty's `issuedByTaxId`) into Invoice.metadata
// (Json) — see wht-service.js:455. The Invoice model previously had NO encrypt
// hook, so this national ID sat plaintext in a dump. We deep-walk the metadata
// Json value via encryptFormDataPii — the Mod-11 value-net catches the 13-digit
// tax ID under ANY key (issuedByTaxId is not in the formData key allowlist, but
// the value-net does not need it to be). Mirrors the application hook structure.
//
// Invoice JSON columns checked (prisma/schema/billing.prisma): `items` (legacy
// line-item array — money/description, never a national ID), `signatureMetadata`
// (signer userId + base64 signature + pdf hash — no national ID), and `metadata`.
// Only `metadata` can carry a national ID (the WHT tax ID), so it is the only
// column walked. The Mod-11 value-net keeps walking metadata safe (no money /
// status / id-shaped non-ID string is 13 Mod-11-valid digits and gets touched
// by accident; e.g. an invoice id `INV-...` is not 13 digits). No code does a
// value-equality JSON-path query on Invoice.metadata.
const INVOICE_JSON_PII_COLUMNS = Object.freeze([
    'metadata',
]);

// B1 (PDPA-LEAK cluster, carpet-bomb-inversion-audit-2026-07-06) — `Invoice.notes`
// is a plain-scalar FREE-TEXT column an operator appends a hold/forfeit/release
// reason or receipt note to (invoice-finance-ops.js holdInvoice/releaseHold/
// forfeitRevenue + invoice-service.js issueReceipt). A staffer can paste an
// applicant's 13-digit national ID mid-sentence into that reason, so a Postgres
// dump grep of \d{13} recovers it. The Mod-11 JSON value-net only catches a leaf
// whose WHOLE value is a 13-digit ID, so a mid-string ID slips it — hence
// WHOLE-COLUMN encrypt, exactly like APPLICATION_COMMENT_PII_COLUMNS.content.
// `notes` is never searched / sorted / grouped (grep-verified 2026-07-06: the
// only `notes:{contains}` in the codebase is on prisma.QUOTE, not Invoice; the
// invoice reads append-then-write only), so encrypting the full string is
// query-safe. PRE-EXISTING plaintext rows pass through decryptValue unchanged on
// read. Reads auto-decrypt via the B1 decryptResultTree walker. The append sites
// read the (already-decrypted) `invoice.notes` through the extended client and
// write the concatenation back, so the whole re-write is re-encrypted here at the
// prisma boundary (idempotent — encryptValue is a no-op on an already enc:v1:
// value).
const INVOICE_PII_COLUMNS = Object.freeze([
    'notes',
]);

function encryptInvoiceDataPayload(data) {
    if (!data || typeof data !== 'object') { return data; }
    let result = data;
    // 1. scalar whole-column (notes — operator free-text hold/forfeit/receipt reason)
    for (const col of INVOICE_PII_COLUMNS) {
        if (col in result && typeof result[col] === 'string') {
            const encrypted = encryptValue(result[col]);
            if (encrypted !== result[col]) {
                if (result === data) { result = { ...data }; }
                result[col] = encrypted;
            }
        }
    }
    // 2. JSON-leaf (metadata — WHT counterparty tax ID)
    for (const col of INVOICE_JSON_PII_COLUMNS) {
        if (!(col in result)) { continue; }
        const encrypted = encryptJsonColumnValue(result[col]);
        if (encrypted !== result[col]) {
            if (result === data) { result = { ...data }; }
            result[col] = encrypted;
        }
    }
    return result;
}

/**
 * Compute a deterministic HMAC for a lookup column (e.g. `emailHash`).
 *
 * Returns the input unchanged when `value` is not a string; returns null
 * for empty strings. Callers should write the result into the parallel
 * `*Hash` column at write time so a subsequent encryption migration of
 * the plaintext column can proceed without breaking existing readers.
 *
 * @param {string} value
 * @returns {string|null}
 */
function hashForLookup(value) {
    if (value === null || value === undefined) {return value;}
    if (typeof value !== 'string') {return value;}
    if (value === '') {return null;}
    return hashData(value);
}

/**
 * Wraps a Prisma client with the PDPA field-encryption extension.
 * Returns the input client UNCHANGED when ENABLE_PDPA_FIELD_ENCRYPTION
 * env var is not set to 'true' — opt-in by design.
 *
 * ## Two responsibilities, two hook kinds (STAGE B1, 2026-06-29)
 *
 * 1. ENCRYPT-on-write — must be BY-COLUMN (the write path has to know which
 *    columns to encrypt), so it stays as per-model `create/update/updateMany/
 *    upsert` hooks for `user` + `certificate`. UNCHANGED from Iter 27.
 *    (B3 will add healthId/providerId + an `entity` hook to this surface —
 *    NOT here, NOT now.)
 *
 * 2. DECRYPT-on-read — now a SINGLE generic path: `decryptResultTree`, the
 *    recursive `enc:v1:` leaf walker. Decryption no longer needs a column
 *    list because encrypted values are self-identifying. This is what makes
 *    NESTED-relation PII (application→applicant, invoice→applicant,
 *    entityMembership→user, certificate→user, Entity, future relations)
 *    round-trip — the per-model `decryptUserRow`/`decryptCertificateRow`
 *    helpers only ever touched the top-level row and missed every include.
 *
 * ## Why both a per-model hook AND $allModels.$allOperations
 *
 * Prisma `$extends` resolves the MOST-SPECIFIC matching hook: a per-model
 * `user.findMany` wins over `$allModels.$allOperations` for `user.findMany`.
 * So `user` + `certificate` keep explicit per-model hooks (they ALSO carry
 * the encrypt-on-write logic) and run the walker on their own result; every
 * OTHER model is decrypted by the `$allModels.$allOperations` catch-all. The
 * net effect is one decrypt function (`decryptResultTree`) reached from two
 * registration points — no model is double-walked (specific vs catch-all are
 * mutually exclusive per Prisma's dispatch), and the walker is idempotent
 * regardless.
 */
function createPdpaEncryptedClient(prismaClient) {
    if (process.env.ENABLE_PDPA_FIELD_ENCRYPTION !== 'true') {
        return prismaClient;
    }

    // Encrypt the write payload (by-column), run the query, then decrypt the
    // ENTIRE returned tree generically — picks up any included relations on a
    // user/certificate query too (e.g. user.findMany include certificates).
    const encryptThenWalk = (encryptPayload) =>
        async function encryptThenWalkHook({ args, query }) {
            if (args && args.data) {args.data = encryptPayload(args.data);}
            if (args && args.create) {args.create = encryptPayload(args.create);}
            if (args && args.update) {args.update = encryptPayload(args.update);}
            const result = await query(args);
            return decryptResultTree(result);
        };

    // Read-only hook: no payload to encrypt, just decrypt the result tree.
    const walkOnly = async function walkOnlyHook({ args, query }) {
        const result = await query(args);
        return decryptResultTree(result);
    };

    const userEncrypt = encryptThenWalk(encryptUserDataPayload);
    const certEncrypt = encryptThenWalk(encryptCertificateDataPayload);
    // STAGE B3 / ROUND-2 — Entity.thaiCitizenId + juristicId (scalar) +
    // payload (JSON-leaf) encrypt-on-write.
    const entityEncrypt = encryptThenWalk(encryptEntityDataPayload);
    // STAGE-formData — Application formData/workflowHistory/previewData
    // Json-leaf encrypt-on-write.
    const applicationEncrypt = encryptThenWalk(encryptApplicationDataPayload);
    // GAP 2 — Invoice.metadata Json-leaf encrypt-on-write (WHT tax ID).
    const invoiceEncrypt = encryptThenWalk(encryptInvoiceDataPayload);
    // ROUND-2 — PurchaseInvoice.supplierTaxId encrypt-on-write (by-column).
    const purchaseInvoiceEncrypt = encryptThenWalk(encryptPurchaseInvoiceDataPayload);
    // ROUND-4 — Organization.taxId encrypt-on-write (by-column).
    const organizationEncrypt = encryptThenWalk(encryptOrganizationDataPayload);
    // Wave-3 chatter — ApplicationComment.content whole-column encrypt.
    const applicationCommentEncrypt = encryptThenWalk(encryptApplicationCommentDataPayload);

    return prismaClient.$extends({
        name: 'pdpa-field-encryption',
        query: {
            // Generic decrypt for EVERY model/operation. The per-model hooks
            // below shadow this for user/certificate (Prisma specificity), but
            // it covers application/invoice/quotation/entity/...
            // and any future model whose includes pull in encrypted PII.
            $allModels: {
                async $allOperations({ args, query }) {
                    const result = await query(args);
                    return decryptResultTree(result);
                },
            },
            user: {
                // ENCRYPT-on-write (by-column) + generic decrypt of the result.
                create: userEncrypt,
                update: userEncrypt,
                updateMany: async ({ args, query }) => {
                    if (args && args.data) {args.data = encryptUserDataPayload(args.data);}
                    return query(args); // batch payload — no rows returned to walk
                },
                upsert: userEncrypt,
                // READ — generic decrypt (covers nested includes on a user query).
                findUnique: walkOnly,
                findUniqueOrThrow: walkOnly,
                findFirst: walkOnly,
                findFirstOrThrow: walkOnly,
                findMany: walkOnly,
            },
            certificate: {
                create: certEncrypt,
                update: certEncrypt,
                updateMany: async ({ args, query }) => {
                    if (args && args.data) {args.data = encryptCertificateDataPayload(args.data);}
                    return query(args);
                },
                upsert: certEncrypt,
                findUnique: walkOnly,
                findUniqueOrThrow: walkOnly,
                findFirst: walkOnly,
                findFirstOrThrow: walkOnly,
                findMany: walkOnly,
            },
            // STAGE B3 — Entity.thaiCitizenId (second plaintext national ID).
            // ENCRYPT-on-write by-column + generic decrypt of the result tree.
            // Decrypt of NESTED Entity includes (application→entity,
            // entityMembership→entity) is also handled by the $allModels
            // catch-all above; these per-model hooks ONLY add the encrypt-on-
            // write logic for the entity model itself.
            entity: {
                create: entityEncrypt,
                update: entityEncrypt,
                updateMany: async ({ args, query }) => {
                    if (args && args.data) {args.data = encryptEntityDataPayload(args.data);}
                    return query(args);
                },
                upsert: entityEncrypt,
                findUnique: walkOnly,
                findUniqueOrThrow: walkOnly,
                findFirst: walkOnly,
                findFirstOrThrow: walkOnly,
                findMany: walkOnly,
            },
            // STAGE-formData — Application.formData JSON national-ID leaves
            // (id_card / tax_id / idCard / taxId / presidentIdCard /
            // directorIdCard / communityRegNumber). The formData column is the
            // LAST live plaintext national-ID location after STAGE A/A.2/B.
            //
            // ENCRYPT-on-write deep-walks the formData Json value (by-key leaf
            // encrypt), so EVERY write site that flows through the extended
            // prisma client is covered by this single chokepoint — including the
            // implicit RE-WRITE paths that read existing (B1-decrypted) formData
            // and write it back: application-status-writer.js `formDataPatch`,
            // the provider form-fields merge, the admin status-override
            // formData, draft saves, prepare, and submit. Wiring each call site
            // by hand would miss those re-write paths and silently re-store
            // plaintext, so the encrypt MUST live here (symmetric with B1's
            // generic decrypt-on-read).
            //
            // DECRYPT-on-read is the generic $allModels.$allOperations
            // decryptResultTree walker above — a parsed Json column is nested
            // plain objects/arrays in the result tree and the walker decrypts
            // any enc:v1: leaf, so no application-specific read hook is needed.
            application: {
                create: applicationEncrypt,
                update: applicationEncrypt,
                updateMany: async ({ args, query }) => {
                    if (args && args.data) {args.data = encryptApplicationDataPayload(args.data);}
                    return query(args);
                },
                upsert: applicationEncrypt,
                // READ — generic decrypt of the result tree (covers the
                // formData Json leaves + any nested applicant/entity include on
                // an application query). Mirrors the user/certificate/entity
                // convention so dispatch is explicit (specific hook wins over
                // the $allModels catch-all, but the body is identical).
                findUnique: walkOnly,
                findUniqueOrThrow: walkOnly,
                findFirst: walkOnly,
                findFirstOrThrow: walkOnly,
                findMany: walkOnly,
            },
            // Wave-3 chatter (verify F2) — ApplicationComment.content WHOLE-
            // COLUMN encrypt-on-write (free text can carry a mid-sentence
            // national ID the Mod-11 leaf-net cannot see). Reads decrypt via
            // the generic walker; the explicit read hooks mirror the
            // application convention (specific hook wins over the catch-all
            // but the body is identical). The applicant leak-guard WHERE
            // (`internalOnly: false`) filters a plain boolean column, so
            // encrypting `content` does not affect it.
            applicationComment: {
                create: applicationCommentEncrypt,
                update: applicationCommentEncrypt,
                updateMany: async ({ args, query }) => {
                    if (args && args.data) {args.data = encryptApplicationCommentDataPayload(args.data);}
                    return query(args);
                },
                upsert: applicationCommentEncrypt,
                findUnique: walkOnly,
                findUniqueOrThrow: walkOnly,
                findFirst: walkOnly,
                findFirstOrThrow: walkOnly,
                findMany: walkOnly,
            },
            // STAGE-formData — ApplicationDraft.formData (the wizard's TRANSIENT
            // draft, a separate model, deleted on submit). The wizard writes the
            // same id_card/tax_id leaves here before submit, so a draft-in-flight
            // would otherwise sit plaintext in a dump. Cover it with the SAME
            // applicationEncrypt payload (encryptApplicationDataPayload keys on
            // `formData`, present on both models); reads auto-decrypt via the
            // $allModels walker.
            applicationDraft: {
                create: applicationEncrypt,
                update: applicationEncrypt,
                updateMany: async ({ args, query }) => {
                    if (args && args.data) {args.data = encryptApplicationDataPayload(args.data);}
                    return query(args);
                },
                upsert: applicationEncrypt,
                findUnique: walkOnly,
                findUniqueOrThrow: walkOnly,
                findFirst: walkOnly,
                findFirstOrThrow: walkOnly,
                findMany: walkOnly,
            },
            // GAP 2 (gap-close 2026-06-29) — Invoice.metadata JSON national-ID
            // leaf (the WHT counterparty tax ID written by wht-service.js
            // recordWhtCertificate). The Invoice model had NO encrypt hook, so
            // this national ID sat plaintext in a dump. ENCRYPT-on-write
            // deep-walks Invoice.metadata (by-value Mod-11 net) so EVERY write
            // through the extended client is covered — including the WHT
            // re-write path that reads the existing (B1-decrypted) metadata and
            // writes the merged object back (wht-service.js builds nextMetadata
            // from `...invoice.metadata` then prisma.invoice.update). DECRYPT
            // on read is the generic $allModels.$allOperations decryptResultTree
            // walker; the explicit read hooks mirror the application convention
            // (specific hook wins over the catch-all but the body is identical).
            invoice: {
                create: invoiceEncrypt,
                update: invoiceEncrypt,
                updateMany: async ({ args, query }) => {
                    if (args && args.data) {args.data = encryptInvoiceDataPayload(args.data);}
                    return query(args);
                },
                upsert: invoiceEncrypt,
                findUnique: walkOnly,
                findUniqueOrThrow: walkOnly,
                findFirst: walkOnly,
                findFirstOrThrow: walkOnly,
                findMany: walkOnly,
            },
            // ROUND-2 (close-natid-round2, 2026-06-30) — PurchaseInvoice
            // .supplierTaxId (supplier's 13-digit Thai TIN, ม.86/4). The model
            // previously had NO encrypt hook, so the TIN sat plaintext in
            // `purchase_invoices`. ENCRYPT-on-write by-column (the dedup /
            // uniqueness invariant moved to the keyed `supplierTaxIdHmac`
            // column — see purchase-invoice-service.js + migrations — so the
            // plaintext column is safe to encrypt with random-IV AES-GCM).
            // DECRYPT on read is the generic $allModels.$allOperations
            // decryptResultTree walker; the explicit read hooks mirror the
            // invoice convention (specific hook wins over the catch-all but the
            // body is identical, so VAT-report / list reads decrypt the TIN).
            purchaseInvoice: {
                create: purchaseInvoiceEncrypt,
                update: purchaseInvoiceEncrypt,
                updateMany: async ({ args, query }) => {
                    if (args && args.data) {args.data = encryptPurchaseInvoiceDataPayload(args.data);}
                    return query(args);
                },
                upsert: purchaseInvoiceEncrypt,
                findUnique: walkOnly,
                findUniqueOrThrow: walkOnly,
                findFirst: walkOnly,
                findFirstOrThrow: walkOnly,
                findMany: walkOnly,
            },
            // ROUND-4 (close-natid-round4, 2026-06-30) — Organization.taxId
            // (tenant's 13-digit Thai tax ID). The model previously had NO
            // encrypt hook, so the TIN sat plaintext in `organizations`.
            // ENCRYPT-on-write by-column (the dedup / uniqueness invariant lives
            // on the PRE-EXISTING keyed `taxIdHash` @unique column — populated at
            // the organizations.js write sites — so the plaintext column is safe
            // to encrypt with random-IV AES-GCM; no migration needed). DECRYPT on
            // read is the generic $allModels.$allOperations decryptResultTree
            // walker; the explicit read hooks mirror the purchaseInvoice
            // convention (specific hook wins over the catch-all but the body is
            // identical, so platform-admin org list/detail reads decrypt the
            // TIN). Organization is a GLOBAL/platform model (NOT tenant-scoped),
            // and these handlers run under withoutTenantScope — the PDPA hook is
            // orthogonal to tenant scope, so it applies on every read/write.
            organization: {
                create: organizationEncrypt,
                update: organizationEncrypt,
                updateMany: async ({ args, query }) => {
                    if (args && args.data) {args.data = encryptOrganizationDataPayload(args.data);}
                    return query(args);
                },
                upsert: organizationEncrypt,
                findUnique: walkOnly,
                findUniqueOrThrow: walkOnly,
                findFirst: walkOnly,
                findFirstOrThrow: walkOnly,
                findMany: walkOnly,
            },
        },
    });
}

module.exports = {
    createPdpaEncryptedClient,
    // Exported for the backfill script + tests:
    PHASE_1_PII_COLUMNS,
    PHASE_2_USER_PII_COLUMNS,
    // STAGE B3:
    PHASE_3_NATIONAL_ID_COLUMNS,
    DEFERRED_PII_COLUMNS,
    ENTITY_PII_COLUMNS,
    ALL_USER_PII_COLUMNS,
    CERTIFICATE_PII_COLUMNS,
    VERSION_PREFIX,
    encryptValue,
    decryptValue,
    encryptUserDataPayload,
    decryptUserRow,
    encryptCertificateDataPayload,
    decryptCertificateRow,
    // STAGE B3 / ROUND-2 — Entity encrypt/decrypt helpers (backfill + tests).
    encryptEntityDataPayload,
    decryptEntityRow,
    // ROUND-2 — Entity payload Json-leaf column list (backfill + tests).
    ENTITY_JSON_PII_COLUMNS,
    // ROUND-2 — PurchaseInvoice.supplierTaxId by-column encrypt/decrypt helpers
    // + column list (backfill + by-column tests).
    PURCHASE_INVOICE_PII_COLUMNS,
    encryptPurchaseInvoiceDataPayload,
    decryptPurchaseInvoiceRow,
    // ROUND-4 — Organization.taxId by-column encrypt/decrypt helpers + column
    // list (backfill + by-column tests).
    ORGANIZATION_PII_COLUMNS,
    encryptOrganizationDataPayload,
    decryptOrganizationRow,
    // Wave-3 chatter (verify F2):
    APPLICATION_COMMENT_PII_COLUMNS,
    encryptApplicationCommentDataPayload,
    // STAGE-formData / GAP 1 — Application formData/workflowHistory/previewData
    // Json-leaf encrypt-on-write payload (exported for the write-site test).
    encryptApplicationDataPayload,
    APPLICATION_JSON_PII_COLUMNS,
    // GAP 2 — Invoice.metadata Json-leaf encrypt-on-write payload + column list.
    encryptInvoiceDataPayload,
    INVOICE_JSON_PII_COLUMNS,
    // B1 (PDPA-LEAK) — Invoice.notes whole-column scalar encrypt column list.
    INVOICE_PII_COLUMNS,
    // STAGE B1 — generic nested-relation decrypt walker (exported for tests).
    decryptResultTree,
    hashForLookup,
};
