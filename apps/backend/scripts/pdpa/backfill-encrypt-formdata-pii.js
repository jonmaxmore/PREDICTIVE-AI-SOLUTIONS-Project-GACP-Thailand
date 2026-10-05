#!/usr/bin/env node
/**
 * PDPA STAGE-formData / ROUND-2 — national-ID encrypt backfill (JSON-leaf +
 * by-column scalar across Application / Invoice / Certificate / Entity /
 * PurchaseInvoice).
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md. This closes the
 * LAST live plaintext national-ID locations after STAGE A / A.2 / B (which
 * encrypted/tokenized the structured SCALAR columns — User / Entity /
 * Certificate — and are LIVE on prod). The remaining plaintext national IDs live
 * inside Prisma `Json` columns the per-model column encrypt-hooks do NOT walk:
 *
 *   - Application.formData         (id_card / tax_id / idCard / taxId /
 *                                   presidentIdCard / directorIdCard /
 *                                   communityRegNumber — the wizard's data).
 *   - Application.workflowHistory  (GAP 1) — a SEPARATE top-level Json column
 *                                   the status-transition writers populate with
 *                                   the actor's national ID (actorId /
 *                                   actorHealthId / provider providerId).
 *   - Application.previewData      (GAP 1) — a render snapshot built FROM
 *                                   formData, so it mirrors the same leaves.
 *   - Invoice.metadata             (GAP 2) — wht-service.js recordWhtCertificate
 *                                   writes the WHT counterparty's 13-digit Thai
 *                                   tax ID (issuedByTaxId) here.
 *
 * ROUND-2 (close-natid-round2, 2026-06-30) EXTENDS the backfill to ALSO cover the
 * newly-protected columns — mirroring the by-column-scalar vs JSON-leaf split:
 *
 *   - Certificate.issuedBy / signedBy   (by-column SCALAR) — the issuer/signer
 *                                   identity. Pre-existing rows issued by an API
 *                                   path stamped a 13-digit providerId here.
 *   - Entity.juristicId                 (by-column SCALAR) — the JURISTIC 13-digit
 *                                   registration number (now encrypted at rest).
 *   - Entity.payload                    (JSON-leaf) — nests director.idCard /
 *                                   president.idCard (caught by the Mod-11 net).
 *   - PurchaseInvoice.supplierTaxId     (by-column SCALAR) — supplier 13-digit
 *                                   TIN. The backfill ALSO populates the keyed
 *                                   `supplierTaxIdHmac` lookup column (computed
 *                                   from the plaintext BEFORE encrypting it) so
 *                                   dedup + the @@unique keep working.
 *   - Entity.thaiCitizenId              (by-column SCALAR) — already covered by
 *                                   the STAGE B3 user/entity scalar backfill, but
 *                                   re-asserted here so the cross-model 0-check is
 *                                   exhaustive over EVERY covered column.
 *
 * ROUND-4 (close-natid-round4, 2026-06-30) further EXTENDS the backfill to cover:
 *
 *   - Organization.taxId               (by-column SCALAR) — the TENANT's 13-digit
 *                                   Thai tax ID (now encrypted at rest). The
 *                                   backfill ALSO populates the PRE-EXISTING keyed
 *                                   `taxIdHash` @unique column (computed from the
 *                                   plaintext BEFORE encrypting it) so tenant-TIN
 *                                   uniqueness keeps working. No migration — the
 *                                   taxIdHash column + unique already exist.
 *
 * This script encrypts those leaves IN PLACE on existing rows:
 *   - Deep-walks each row's JSON column(s) (utils/formdata-pii.js
 *     `encryptFormDataPii`) and wraps each national-ID-class leaf in `enc:v1:`
 *     ciphertext (via the SAME ENCRYPTION_KEY the serving process uses).
 *   - Once flipped ON, the B1 generic `decryptResultTree` read walker
 *     auto-decrypts the leaves on every Prisma read (a parsed Json column is
 *     just nested plain objects/arrays in the result tree).
 *
 * ## Discipline (matches the User / national-ID / B2 hmac backfills)
 *
 *   - Uses `basePrisma` — the UN-extended client. basePrisma bypasses tenant
 *     scope, the soft-delete filter AND the PDPA encrypt extension (see
 *     services/prisma-database.js export note), so it sees EVERY tenant's rows
 *     and we encrypt MANUALLY via `encryptFormDataPii` (never double-encrypt
 *     through the extension). No withoutTenantScope wrapper needed.
 *   - Idempotent: `encryptFormDataPii` is a no-op on already-`enc:v1:`-prefixed
 *     leaves + null/empty; `hasPlaintextPii` skips rows that need no write.
 *     Re-running is a no-op; a crash mid-run resumes via cursor pagination.
 *   - Selects rows by `id` ONLY (never by the plaintext being encrypted — a
 *     WHERE on an about-to-be / already-encrypted leaf would be a logic trap).
 *     Pages by id and re-tests the JSON in JS.
 *   - Batched (cursor pagination), `--dry-run`, `--batch-size`, `--max-rows`.
 *   - FINAL ASSERTION: 0 rows still hold a plaintext national-ID-class leaf in
 *     ANY covered Json column (formData + workflowHistory + previewData on
 *     applications, metadata on invoices). A real run exits non-zero if any
 *     plaintext remains.
 *
 * ## Operational sequence (STAGE-formData)
 *
 *   1. Deploy the image (utils/formdata-pii.js + the `application`/`invoice`
 *      extension hooks) with `ENABLE_PDPA_FIELD_ENCRYPTION` still OFF (no
 *      behaviour change — the hooks are inert until the flag is ON).
 *      NOTE: STAGE A/A.2/B already require the flag ON in prod; this stage
 *      ships under the SAME flag, so in prod the flag is already ON and the
 *      hooks activate with the deploy. Run this backfill in the deploy window
 *      BEFORE/IMMEDIATELY-AROUND the flag state you target on staging; on prod
 *      (flag already ON) run it right after deploy so new writes encrypt and
 *      existing rows are backfilled. Coordinate with owner.
 *   2. `node apps/backend/scripts/pdpa/backfill-encrypt-formdata-pii.js --dry-run`
 *      (reports how many rows WOULD be encrypted + what plaintext would remain).
 *   3. `node apps/backend/scripts/pdpa/backfill-encrypt-formdata-pii.js`
 *      (real run — must end "0 plaintext remaining").
 *   Rollback at any point = flip ENABLE_PDPA_FIELD_ENCRYPTION OFF (KEEP the key
 *   — the enc:v1: prefix lets the read walker pass both plaintext and ciphertext
 *   leaves through unchanged).
 *
 * ## KEY CONSISTENCY
 *
 * This backfill encrypts with the SAME `ENCRYPTION_KEY` the serving process
 * uses. A key MISMATCH between backfill-time and serve-time would silently
 * surface '[PII_DECRYPT_FAILED]' to real users. Do NOT rotate ENCRYPTION_KEY
 * around this backfill — it ALSO keys the live `*Hmac` ID-lookup columns.
 *
 * NOTE: run-once ops. Do NOT auto-run. First live run MUST be a `--dry-run` on
 * staging (golden rule #2 / #7).
 *
 * ## CLI flags
 *
 *   --dry-run       Count rows to encrypt, do not write
 *   --batch-size N  Rows per cursor page (default 100)
 *   --max-rows N    Stop after processing N rows per model (default unlimited)
 *   --verbose       Log per-row progress (default: per-batch only)
 *
 * ## Exit codes
 *
 *   0 — success (real run: assertion held; dry-run: always 0)
 *   1 — runtime error OR (real run) plaintext still remaining
 *   2 — invalid CLI flags
 */

'use strict';

const path = require('path');

// Reuse the audited CLI parser from the Phase-1 user backfill — identical
// --dry-run / --batch-size / --max-rows / --verbose semantics.
const {
    parseArgs,
} = require(path.join(__dirname, 'backfill-encrypt-user-pii'));

// The JSON columns each model carries that can hold a national-ID-class leaf.
// Mirrors APPLICATION_JSON_PII_COLUMNS / INVOICE_JSON_PII_COLUMNS in
// services/prisma-pdpa-extension.js (kept local to avoid pulling the extension
// — and thus the @prisma/client require — into the backfill's test surface).
const APPLICATION_JSON_PII_COLUMNS = ['formData', 'workflowHistory', 'previewData'];
const INVOICE_JSON_PII_COLUMNS = ['metadata'];

// ROUND-2 — by-column SCALAR national-ID columns (mirror CERTIFICATE_PII_COLUMNS
// / ENTITY_PII_COLUMNS / PURCHASE_INVOICE_PII_COLUMNS in the extension). These
// are plain string columns, NOT Json, so they encrypt with encryptValue (whole
// value) instead of the deep-walk encryptFormDataPii.
//
// SHOULD-#4 (batch-2 adversarial-verify fast-follow): revokedReason + deleteReason
// are ALSO whole-column encrypted-forward by the extension's CERTIFICATE_PII_COLUMNS,
// so legacy pre-fix rows stay plaintext. They MUST be in this list or the backfill
// skips them AND countRemainingScalarPlaintext (which iterates this SAME list)
// reports a FALSE-GREEN "0 plaintext" while a DB dump still recovers them. (The
// extension also encrypts `address`; it is a non-national-ID PII column and is
// intentionally out of THIS national-ID backfill's scope — tracked separately.)
const CERTIFICATE_SCALAR_PII_COLUMNS = ['issuedBy', 'signedBy', 'revokedReason', 'deleteReason'];
const ENTITY_SCALAR_PII_COLUMNS = ['thaiCitizenId', 'juristicId'];
const ENTITY_JSON_PII_COLUMNS = ['payload'];
const PURCHASE_INVOICE_SCALAR_PII_COLUMNS = ['supplierTaxId'];
// ROUND-4 (close-natid-round4, 2026-06-30) — Organization.taxId (tenant TIN,
// by-column SCALAR). The backfill ALSO populates the PRE-EXISTING keyed
// `taxIdHash` @unique column (computed from the plaintext BEFORE encrypting it)
// so tenant-TIN uniqueness keeps working — mirrors the PurchaseInvoice
// supplierTaxIdHmac derive-extra path. No migration: taxIdHash already exists.
const ORGANIZATION_SCALAR_PII_COLUMNS = ['taxId'];

/**
 * True when ANY of the row's covered Json columns still holds a plaintext
 * national-ID leaf. `hasPlaintextPiiFn` is the SAME utils/formdata-pii.js
 * `hasPlaintextPii` (key-allowlist OR Mod-11 value-net) used by the formData
 * stage; here we run it over EACH column in `columns`.
 */
function rowHasPlaintext(row, columns, hasPlaintextPiiFn, versionPrefix) {
    for (const col of columns) {
        if (hasPlaintextPiiFn(row[col], versionPrefix)) { return true; }
    }
    return false;
}

/**
 * Encrypt the covered Json columns on a row, returning a write-`data` object
 * containing ONLY the columns that actually held a plaintext national-ID leaf
 * (so the UPDATE touches the minimum set — a column with no plaintext leaf is
 * left out, never needlessly rewritten). `encryptFormDataPii` always returns a
 * structurally-NEW object, so a plain reference check cannot tell "unchanged"
 * apart; the `hasPlaintextPiiFn` per-column gate is the authoritative
 * needs-encryption signal (the SAME predicate `rowHasPlaintext` uses to decide
 * the row needs a write at all).
 */
function buildEncryptedData(row, columns, encryptFormDataPiiFn, hasPlaintextPiiFn, versionPrefix) {
    const data = {};
    for (const col of columns) {
        const value = row[col];
        if (value === null || typeof value !== 'object') { continue; }
        if (!hasPlaintextPiiFn(value, versionPrefix)) { continue; }
        data[col] = encryptFormDataPiiFn(value);
    }
    return data;
}

/**
 * Pure orchestration: cursor-paginate a model's rows by id, deep-walk each
 * covered Json column, and encrypt the national-ID-class leaves on rows that
 * still hold a plaintext leaf. Extracted from main() so unit tests can drive it
 * with a fake client + fake encrypt/has helpers.
 *
 * @param {object} args
 * @param {object} args.delegate              the Prisma model delegate (e.g.
 *                                             client.application) — has
 *                                             findMany + update.
 * @param {string[]} args.columns             the Json columns to encrypt.
 * @param {string} args.label                 a label for log lines
 *                                             (e.g. 'applications').
 * @returns {Promise<object>} stats
 */
async function runModelBackfill({
    delegate,
    columns,
    label,
    versionPrefix,
    encryptFormDataPiiFn,
    hasPlaintextPiiFn,
    batchSize,
    maxRows,
    dryRun,
    verbose,
    logger = console,
}) {
    const stats = {
        label,
        pagesScanned: 0,
        rowsScanned: 0,
        rowsRequiringBackfill: 0,
        rowsUpdated: 0,
        rowsSkipped: 0,
    };

    // id + the covered Json columns ONLY — never select/filter by a plaintext
    // leaf.
    const select = { id: true };
    for (const col of columns) { select[col] = true; }

    let cursor = null;
    while (stats.rowsScanned < maxRows) {
        const take = Math.min(batchSize, maxRows - stats.rowsScanned);
        const findArgs = {
            take,
            orderBy: { id: 'asc' },
            select,
            where: { isDeleted: false },
        };
        if (cursor) {
            findArgs.cursor = { id: cursor };
            findArgs.skip = 1;
        }
        const batch = await delegate.findMany(findArgs);
        if (batch.length === 0) { break; }

        stats.pagesScanned += 1;
        stats.rowsScanned += batch.length;
        cursor = batch[batch.length - 1].id;

        for (const row of batch) {
            if (!rowHasPlaintext(row, columns, hasPlaintextPiiFn, versionPrefix)) {
                stats.rowsSkipped += 1;
                continue;
            }
            stats.rowsRequiringBackfill += 1;
            if (dryRun) {
                if (verbose) {
                    logger.log(`[dry-run] would encrypt ${label} ${row.id} national-ID leaves`);
                }
                continue;
            }
            const data = buildEncryptedData(
                row, columns, encryptFormDataPiiFn, hasPlaintextPiiFn, versionPrefix,
            );
            await delegate.update({ where: { id: row.id }, data });
            stats.rowsUpdated += 1;
            if (verbose) {
                logger.log(`[ok] encrypted ${label} ${row.id} national-ID leaves`);
            }
        }

        logger.log(
            `[${label} batch ${stats.pagesScanned}] scanned=${batch.length} `
            + `cumulative_scanned=${stats.rowsScanned} `
            + `updated=${stats.rowsUpdated} `
            + `skipped=${stats.rowsSkipped} `
            + `needs_backfill=${stats.rowsRequiringBackfill}`,
        );

        if (batch.length < take) { break; } // last page
    }

    return stats;
}

/**
 * Backwards-compatible wrapper around `runModelBackfill` for the original
 * formData-only application backfill signature (kept so the existing tests +
 * any external caller keep working). Encrypts ALL covered application Json
 * columns (formData + workflowHistory + previewData), not just formData.
 *
 * @param {object} args  — accepts `client` (uses client.application) and the
 *                         same encrypt/has helpers + flags as before.
 * @returns {Promise<object>} stats (shape unchanged: no `label` consumer relies
 *                            on its absence, and the field is additive).
 */
async function runFormDataBackfill({
    client,
    versionPrefix,
    encryptFormDataPiiFn,
    hasPlaintextPiiFn,
    batchSize,
    maxRows,
    dryRun,
    verbose,
    logger = console,
}) {
    return runModelBackfill({
        delegate: client.application,
        columns: APPLICATION_JSON_PII_COLUMNS,
        label: 'applications',
        versionPrefix,
        encryptFormDataPiiFn,
        hasPlaintextPiiFn,
        batchSize,
        maxRows,
        dryRun,
        verbose,
        logger,
    });
}

// ── ROUND-2 — by-column SCALAR backfill ─────────────────────────────────────

/**
 * True when a SCALAR string column still holds plaintext (a non-empty string
 * NOT already `enc:v1:`-prefixed). Mirrors the column-encrypt extension's
 * `encryptValue` no-op rules: null/undefined/empty/non-string/already-prefixed
 * are NOT plaintext-needing-encryption.
 */
function scalarColumnIsPlaintext(value, versionPrefix) {
    return typeof value === 'string'
        && value.length > 0
        && !value.startsWith(versionPrefix);
}

/**
 * True when ANY covered SCALAR column on the row still holds plaintext.
 */
function rowHasScalarPlaintext(row, columns, versionPrefix) {
    for (const col of columns) {
        if (scalarColumnIsPlaintext(row[col], versionPrefix)) { return true; }
    }
    return false;
}

/**
 * Cursor-paginate a model's rows by id and encrypt the covered SCALAR national-ID
 * columns (whole-value `encryptValueFn`) on rows that still hold a plaintext
 * value. Optionally derives EXTRA columns (e.g. PurchaseInvoice.supplierTaxIdHmac
 * from the PLAINTEXT value, computed BEFORE encryption) via `deriveExtraData`.
 * Same discipline as runModelBackfill: select by id ONLY, idempotent (skips
 * already-encrypted), --dry-run aware, batched.
 *
 * @param {object} args
 * @param {object} args.delegate           Prisma model delegate (findMany + update)
 * @param {string[]} args.columns          the scalar columns to encrypt
 * @param {string} args.label              log label
 * @param {(plain:string)=>string} args.encryptValueFn  whole-value encrypt (idempotent)
 * @param {(row:object)=>object} [args.deriveExtraData]  extra write-data derived
 *   from the row's PLAINTEXT columns (run before encryption; e.g. the HMAC). Only
 *   merged into the UPDATE when the row needs a backfill.
 */
async function runScalarColumnBackfill({
    delegate,
    columns,
    label,
    versionPrefix,
    encryptValueFn,
    deriveExtraData = null,
    batchSize,
    maxRows,
    dryRun,
    verbose,
    logger = console,
}) {
    const stats = {
        label,
        pagesScanned: 0,
        rowsScanned: 0,
        rowsRequiringBackfill: 0,
        rowsUpdated: 0,
        rowsSkipped: 0,
    };

    const select = { id: true };
    for (const col of columns) { select[col] = true; }

    let cursor = null;
    while (stats.rowsScanned < maxRows) {
        const take = Math.min(batchSize, maxRows - stats.rowsScanned);
        const findArgs = {
            take,
            orderBy: { id: 'asc' },
            select,
            where: { isDeleted: false },
        };
        if (cursor) {
            findArgs.cursor = { id: cursor };
            findArgs.skip = 1;
        }
        const batch = await delegate.findMany(findArgs);
        if (batch.length === 0) { break; }

        stats.pagesScanned += 1;
        stats.rowsScanned += batch.length;
        cursor = batch[batch.length - 1].id;

        for (const row of batch) {
            if (!rowHasScalarPlaintext(row, columns, versionPrefix)) {
                stats.rowsSkipped += 1;
                continue;
            }
            stats.rowsRequiringBackfill += 1;
            if (dryRun) {
                if (verbose) {
                    logger.log(`[dry-run] would encrypt ${label} ${row.id} scalar national-ID columns`);
                }
                continue;
            }
            // Derive extra columns (e.g. the HMAC) from the PLAINTEXT BEFORE
            // encrypting the scalar values.
            const data = deriveExtraData ? { ...deriveExtraData(row) } : {};
            for (const col of columns) {
                if (scalarColumnIsPlaintext(row[col], versionPrefix)) {
                    data[col] = encryptValueFn(row[col]);
                }
            }
            await delegate.update({ where: { id: row.id }, data });
            stats.rowsUpdated += 1;
            if (verbose) {
                logger.log(`[ok] encrypted ${label} ${row.id} scalar national-ID columns`);
            }
        }

        logger.log(
            `[${label} batch ${stats.pagesScanned}] scanned=${batch.length} `
            + `cumulative_scanned=${stats.rowsScanned} `
            + `updated=${stats.rowsUpdated} `
            + `skipped=${stats.rowsSkipped} `
            + `needs_backfill=${stats.rowsRequiringBackfill}`,
        );

        if (batch.length < take) { break; } // last page
    }

    return stats;
}

/**
 * Post-run assertion for SCALAR columns: count rows whose covered scalar
 * column(s) STILL hold a plaintext (non-`enc:v1:`) value. Pages by id, tests in
 * JS (same reason as the JSON variant — Prisma can't portably filter the prefix).
 */
async function countRemainingScalarPlaintext({
    delegate,
    columns,
    versionPrefix,
    batchSize = 500,
}) {
    const select = { id: true };
    for (const col of columns) { select[col] = true; }
    let remaining = 0;
    let cursor = null;
    for (;;) {
        const findArgs = {
            take: batchSize,
            orderBy: { id: 'asc' },
            select,
            where: { isDeleted: false },
        };
        if (cursor) { findArgs.cursor = { id: cursor }; findArgs.skip = 1; }
        const rows = await delegate.findMany(findArgs);
        if (rows.length === 0) { break; }
        cursor = rows[rows.length - 1].id;
        for (const row of rows) {
            if (rowHasScalarPlaintext(row, columns, versionPrefix)) { remaining += 1; }
        }
        if (rows.length < batchSize) { break; }
    }
    return remaining;
}

/**
 * Hard post-run assertion: count rows whose covered Json column(s) STILL contain
 * a plaintext national-ID-class leaf. Pages by id and tests in JS (Prisma cannot
 * portably filter the `enc:v1:` prefix inside a Json column). Cheap at pilot
 * scale.
 *
 * @returns {Promise<number>} remaining count
 */
async function countRemainingPlaintext({
    delegate,
    client,
    columns = APPLICATION_JSON_PII_COLUMNS,
    versionPrefix,
    hasPlaintextPiiFn,
    batchSize = 500,
}) {
    // Back-compat: callers may pass `client` (uses client.application) OR the
    // explicit `delegate`. The formData stage's existing tests pass `client`.
    const model = delegate || (client && client.application);
    const select = { id: true };
    for (const col of columns) { select[col] = true; }

    let remaining = 0;
    let cursor = null;
    for (;;) {
        const findArgs = {
            take: batchSize,
            orderBy: { id: 'asc' },
            select,
            where: { isDeleted: false },
        };
        if (cursor) { findArgs.cursor = { id: cursor }; findArgs.skip = 1; }
        const rows = await model.findMany(findArgs);
        if (rows.length === 0) { break; }
        cursor = rows[rows.length - 1].id;
        for (const row of rows) {
            if (rowHasPlaintext(row, columns, hasPlaintextPiiFn, versionPrefix)) {
                remaining += 1;
            }
        }
        if (rows.length < batchSize) { break; }
    }
    return remaining;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // basePrisma = un-extended (no tenant scope, no soft-delete filter, no PDPA
    // encrypt extension) so we encrypt manually and see every tenant's rows.
    const prismaDb = require(path.join(__dirname, '..', '..', 'services', 'prisma-database'));
    const basePrisma = prismaDb.basePrisma || prismaDb.prisma;

    const {
        VERSION_PREFIX,
        encryptFormDataPii,
        hasPlaintextPii,
    } = require(path.join(__dirname, '..', '..', 'utils', 'formdata-pii'));
    // ROUND-2 — whole-value scalar encrypt (idempotent on already-`enc:v1:`) +
    // the keyed HMAC for the PurchaseInvoice lookup column. Required at run time
    // (encrypt-key); pulled here, not at module top, to keep the backfill's test
    // surface importable without @prisma/client.
    const { computeLookupHmac } = require(path.join(__dirname, '..', '..', 'utils', 'field-encryption'));
    const { encryptValue: encryptScalarValue } = require(path.join(__dirname, '..', '..', 'utils', 'formdata-pii'));

    console.log('────────────────────────────────────────────────────────');
    console.log('PDPA STAGE-formData / ROUND-2 — national-ID encrypt backfill (JSON-leaf + scalar)');
    console.log(`mode: ${args.dryRun ? 'DRY-RUN' : 'WRITE'}`);
    console.log(`batch-size: ${args.batchSize}`);
    console.log(`max-rows: ${args.maxRows === Infinity ? 'unlimited' : args.maxRows}`);
    console.log(`application JSON columns: ${APPLICATION_JSON_PII_COLUMNS.join(', ')}`);
    console.log(`invoice JSON columns: ${INVOICE_JSON_PII_COLUMNS.join(', ')}`);
    console.log(`certificate scalar columns: ${CERTIFICATE_SCALAR_PII_COLUMNS.join(', ')}`);
    console.log(`entity scalar columns: ${ENTITY_SCALAR_PII_COLUMNS.join(', ')} + JSON: ${ENTITY_JSON_PII_COLUMNS.join(', ')}`);
    console.log(`purchase-invoice scalar columns: ${PURCHASE_INVOICE_SCALAR_PII_COLUMNS.join(', ')} (+ supplierTaxIdHmac)`);
    console.log(`organization scalar columns: ${ORGANIZATION_SCALAR_PII_COLUMNS.join(', ')} (+ taxIdHash)`);
    console.log('────────────────────────────────────────────────────────');

    const startedAt = Date.now();

    const sharedOpts = {
        versionPrefix: VERSION_PREFIX,
        encryptFormDataPiiFn: encryptFormDataPii,
        hasPlaintextPiiFn: hasPlaintextPii,
        batchSize: args.batchSize,
        maxRows: args.maxRows,
        dryRun: args.dryRun,
        verbose: args.verbose,
    };
    const scalarSharedOpts = {
        versionPrefix: VERSION_PREFIX,
        encryptValueFn: encryptScalarValue,
        batchSize: args.batchSize,
        maxRows: args.maxRows,
        dryRun: args.dryRun,
        verbose: args.verbose,
    };

    // 1) Applications — formData + workflowHistory + previewData.
    const appStats = await runModelBackfill({
        delegate: basePrisma.application,
        columns: APPLICATION_JSON_PII_COLUMNS,
        label: 'applications',
        ...sharedOpts,
    });

    // 2) Invoices — metadata (WHT counterparty tax ID).
    const invoiceStats = await runModelBackfill({
        delegate: basePrisma.invoice,
        columns: INVOICE_JSON_PII_COLUMNS,
        label: 'invoices',
        ...sharedOpts,
    });

    // 3) Certificates — issuedBy / signedBy (by-column SCALAR).
    const certStats = await runScalarColumnBackfill({
        delegate: basePrisma.certificate,
        columns: CERTIFICATE_SCALAR_PII_COLUMNS,
        label: 'certificates',
        ...scalarSharedOpts,
    });

    // 4) Entities — thaiCitizenId / juristicId (SCALAR) + payload (JSON-leaf).
    const entityScalarStats = await runScalarColumnBackfill({
        delegate: basePrisma.entity,
        columns: ENTITY_SCALAR_PII_COLUMNS,
        label: 'entities (scalar)',
        ...scalarSharedOpts,
    });
    const entityJsonStats = await runModelBackfill({
        delegate: basePrisma.entity,
        columns: ENTITY_JSON_PII_COLUMNS,
        label: 'entities (payload)',
        ...sharedOpts,
    });

    // 5) PurchaseInvoices — supplierTaxId (SCALAR) + populate supplierTaxIdHmac
    //    (computed from the PLAINTEXT TIN BEFORE encryption).
    const purchaseInvoiceStats = await runScalarColumnBackfill({
        delegate: basePrisma.purchaseInvoice,
        columns: PURCHASE_INVOICE_SCALAR_PII_COLUMNS,
        label: 'purchase-invoices',
        deriveExtraData: (row) => {
            // Only set the HMAC when it is missing AND the plaintext is still
            // readable (not yet encrypted). computeLookupHmac is deterministic.
            const raw = row.supplierTaxId;
            if (typeof raw === 'string' && raw.length > 0 && !raw.startsWith(VERSION_PREFIX)) {
                return { supplierTaxIdHmac: computeLookupHmac(raw) };
            }
            return {};
        },
        ...scalarSharedOpts,
    });

    // 6) Organizations — taxId (SCALAR) + populate the PRE-EXISTING keyed
    //    taxIdHash @unique (computed from the PLAINTEXT tenant TIN BEFORE
    //    encryption). Mirrors the PurchaseInvoice derive-extra path; no
    //    migration since taxIdHash already exists in the schema + DB.
    const organizationStats = await runScalarColumnBackfill({
        delegate: basePrisma.organization,
        columns: ORGANIZATION_SCALAR_PII_COLUMNS,
        label: 'organizations',
        deriveExtraData: (row) => {
            const raw = row.taxId;
            if (typeof raw === 'string' && raw.length > 0 && !raw.startsWith(VERSION_PREFIX)) {
                return { taxIdHash: computeLookupHmac(raw) };
            }
            return {};
        },
        ...scalarSharedOpts,
    });

    // FINAL ASSERTION across ALL covered models — 0 plaintext national ID in any
    // covered column (JSON leaf OR scalar).
    const remainingApps = await countRemainingPlaintext({
        delegate: basePrisma.application,
        columns: APPLICATION_JSON_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
        hasPlaintextPiiFn: hasPlaintextPii,
    });
    const remainingInvoices = await countRemainingPlaintext({
        delegate: basePrisma.invoice,
        columns: INVOICE_JSON_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
        hasPlaintextPiiFn: hasPlaintextPii,
    });
    const remainingCerts = await countRemainingScalarPlaintext({
        delegate: basePrisma.certificate,
        columns: CERTIFICATE_SCALAR_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
    });
    const remainingEntityScalar = await countRemainingScalarPlaintext({
        delegate: basePrisma.entity,
        columns: ENTITY_SCALAR_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
    });
    const remainingEntityJson = await countRemainingPlaintext({
        delegate: basePrisma.entity,
        columns: ENTITY_JSON_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
        hasPlaintextPiiFn: hasPlaintextPii,
    });
    const remainingPurchaseInvoices = await countRemainingScalarPlaintext({
        delegate: basePrisma.purchaseInvoice,
        columns: PURCHASE_INVOICE_SCALAR_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
    });
    const remainingOrganizations = await countRemainingScalarPlaintext({
        delegate: basePrisma.organization,
        columns: ORGANIZATION_SCALAR_PII_COLUMNS,
        versionPrefix: VERSION_PREFIX,
    });
    const remaining = remainingApps + remainingInvoices + remainingCerts
        + remainingEntityScalar + remainingEntityJson + remainingPurchaseInvoices
        + remainingOrganizations;

    const elapsedMs = Date.now() - startedAt;

    const remainingPlaintext = {
        applications: remainingApps,
        invoices: remainingInvoices,
        certificates: remainingCerts,
        entitiesScalar: remainingEntityScalar,
        entitiesPayload: remainingEntityJson,
        purchaseInvoices: remainingPurchaseInvoices,
        organizations: remainingOrganizations,
        total: remaining,
    };

    console.log('────────────────────────────────────────────────────────');
    console.log(`Done in ${elapsedMs}ms`);
    console.log(JSON.stringify({
        applications: appStats,
        invoices: invoiceStats,
        certificates: certStats,
        entitiesScalar: entityScalarStats,
        entitiesPayload: entityJsonStats,
        purchaseInvoices: purchaseInvoiceStats,
        organizations: organizationStats,
        remainingPlaintext,
    }, null, 2));
    console.log('────────────────────────────────────────────────────────');

    if (args.dryRun) {
        console.log(`[dry-run] rows that WOULD remain plaintext after a real run: ${remaining} `
            + `(${JSON.stringify(remainingPlaintext)})`);
        return;
    }

    if (remaining > 0) {
        console.error(
            `[backfill-encrypt-formdata-pii] ASSERTION FAILED: ${remaining} row(s) still hold a `
            + `plaintext national-ID-class value (${JSON.stringify(remainingPlaintext)}). `
            + 'The flag MUST NOT be (left) flipped ON.',
        );
        process.exit(1);
    }
    console.log('[assertion] 0 rows still hold a plaintext national-ID-class value across ALL covered '
        + 'models (applications formData/workflowHistory/previewData, invoices metadata, certificates '
        + 'issuedBy/signedBy, entities thaiCitizenId/juristicId/payload, purchase-invoices supplierTaxId, '
        + 'organizations taxId).');
}

// Exported for tests; the IIFE only fires when invoked from the CLI.
module.exports = {
    APPLICATION_JSON_PII_COLUMNS,
    INVOICE_JSON_PII_COLUMNS,
    // ROUND-2 — scalar + entity-payload column lists.
    CERTIFICATE_SCALAR_PII_COLUMNS,
    ENTITY_SCALAR_PII_COLUMNS,
    ENTITY_JSON_PII_COLUMNS,
    PURCHASE_INVOICE_SCALAR_PII_COLUMNS,
    // ROUND-4 — Organization.taxId scalar column list.
    ORGANIZATION_SCALAR_PII_COLUMNS,
    runModelBackfill,
    runFormDataBackfill,
    countRemainingPlaintext,
    // ROUND-2 — by-column scalar backfill + assertion.
    scalarColumnIsPlaintext,
    rowHasScalarPlaintext,
    runScalarColumnBackfill,
    countRemainingScalarPlaintext,
};

if (require.main === module) {
    main().then(
        () => process.exit(0),
        (err) => {
            console.error('[backfill-encrypt-formdata-pii] FATAL:', err && err.stack ? err.stack : err);
            process.exit(1);
        },
    );
}
