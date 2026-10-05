/**
 * Boot-time Production Secret Sentinel Guard (W2-C, Iter W2)
 *
 * Defence-in-depth: refuse server boot when a production-required secret is
 * missing, holds the `PENDING_FINANCE_CONFIRMATION` sentinel, or is shorter
 * than its declared `minLength`.
 *
 * Background
 * ----------
 * `apps/backend/scripts/check-secrets.js` is the *deploy-time* gate — it runs
 * before the container starts. If an operator skips the gate (manual deploy,
 * emergency restart, drift between secret manager and runtime env), the
 * server would historically boot and silently use a sentinel value, e.g.
 * print `PENDING_FINANCE_CONFIRMATION` on a customer receipt or attempt to
 * route money to a placeholder account.
 *
 * This module closes that gap: same SECRETS_CATALOG, evaluated at boot.
 *
 * Behaviour by NODE_ENV
 * ---------------------
 * - production: any error → `process.exit(1)` after writing a clear Thai +
 *   English message per offending secret to stderr; references
 *   `docs/operations/cutover-checklist-2026-05-17.md` for the runbook step.
 * - development / test / anything else: silent no-op so local dev workflow
 *   (where `PENDING_FINANCE_CONFIRMATION` is intentional until Finance
 *   confirms) is not disturbed.
 *
 * Per I-014: this module does NOT add new SECRETS_CATALOG entries. It only
 * consumes `validateSecretsForEnvironment()` from `config/secrets.js`. If a
 * future iteration adds a new `required: 'production'` entry to the catalog,
 * this guard automatically covers it (no edits here required).
 *
 * @module config/boot-secret-guard
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateSecretsForEnvironment, getSecret } = require('./secrets');
const { isSigningKeyRequired, getExpectedSigningKeyFingerprint } = require('./signing-key-policy');
// ONE definition of the fingerprint, shared with the runtime guard and the
// verify response. Re-deriving it here (as the first round did) invites exactly
// the drift the CRLF normalisation exists to prevent: a guard that calls the
// mounted key fine and a verifier that then calls the same key a stranger.
// DEFAULT_KEY_DIR comes from the same module so the guard cannot end up
// checking a different directory from the one the service will read.
const { fingerprintPublicKey, DEFAULT_KEY_DIR } = require('../services/crypto/signature-service');

const CUTOVER_RUNBOOK = 'docs/operations/cutover-checklist-2026-05-17.md';
const SIGNING_KEY_RUNBOOK = 'apps/backend/keys/README.md';

/**
 * Translate a single error record from `validateSecretsForEnvironment` into
 * a human-actionable Thai + English block for stderr. Each block is prefixed
 * with `[OPERATOR_INTERVENTION_REQUIRED]` (English) and
 * `[ต้องดำเนินการโดยผู้ดูแลระบบ]` (Thai) so log search tools find both.
 *
 * @param {{name: string, reason: string, spec: object, actualLength?: number}} err
 * @returns {string[]} lines to write (no trailing newline)
 */
function formatBlock(err) {
    const lines = [];
    const { name, reason, spec, actualLength } = err;
    const description = (spec && spec.description) || '';

    lines.push('[OPERATOR_INTERVENTION_REQUIRED] ' + name + ' — ' + reason);
    lines.push('[ต้องดำเนินการโดยผู้ดูแลระบบ] ' + name + ' — ' + reason);

    if (reason === 'MISSING_OR_PENDING') {
        lines.push(
            '  EN: ' + name + ' is missing or holds the sentinel '
            + '"PENDING_FINANCE_CONFIRMATION". Production boot refused.',
        );
        lines.push(
            '  TH: ตัวแปร ' + name + ' ยังไม่ตั้งค่า หรือยังเป็นค่า sentinel '
            + '"PENDING_FINANCE_CONFIRMATION" ระบบ production ปฏิเสธการเริ่มทำงาน',
        );
        lines.push(
            '  Action: set ' + name + ' via the secret manager '
            + '(current value is sentinel placeholder).',
        );
        lines.push(
            '  Action (TH): กำหนดค่า ' + name + ' ผ่าน secret manager '
            + '(ปัจจุบันยังเป็น sentinel placeholder)',
        );
    } else if (reason === 'TOO_SHORT') {
        const need = spec && spec.minLength;
        lines.push(
            '  EN: ' + name + ' is shorter than the required minimum '
            + '(' + actualLength + ' < ' + need + ' chars). Production boot refused.',
        );
        lines.push(
            '  TH: ตัวแปร ' + name + ' มีความยาวน้อยกว่าที่กำหนด '
            + '(' + actualLength + ' < ' + need + ' ตัวอักษร) ระบบ production ปฏิเสธการเริ่มทำงาน',
        );
        lines.push('  Action: regenerate ' + name + ' with a value of at least ' + need + ' characters.');
        lines.push('  Action (TH): สร้างค่า ' + name + ' ใหม่ ความยาวอย่างน้อย ' + need + ' ตัวอักษร');
    } else {
        // Unknown future reason — still emit a useful block.
        lines.push('  EN: ' + name + ' failed boot-time secret validation (reason: ' + reason + ').');
        lines.push('  TH: ตัวแปร ' + name + ' ไม่ผ่านการตรวจสอบตอนเริ่มระบบ (เหตุผล: ' + reason + ')');
        lines.push('  Action: review the secret in the secret manager.');
    }

    if (description) {
        lines.push('  Purpose: ' + description);
    }
    return lines;
}

/**
 * Validate production-required secrets at boot.
 *
 * In production: exits 1 with stderr diagnostics if any secret is
 * MISSING_OR_PENDING / TOO_SHORT.
 *
 * In non-production: writes a warning to stderr per error and returns; does
 * NOT call `process.exit` so the dev/test workflow continues.
 *
 * @param {object} [opts]
 * @param {object} [opts.env=process.env] - environment to read NODE_ENV from
 *   (and which `validateSecretsForEnvironment` will read). Override is for
 *   tests — production callers should pass nothing.
 * @param {function} [opts.exit=process.exit] - exit function (test injection)
 * @param {{write: function}} [opts.stderr=process.stderr] - stream (test injection)
 * @returns {{ok: boolean, errors: Array, skipped: boolean}} for callers that
 *   want to introspect (e.g. tests). In production, this function will have
 *   called `exit(1)` before returning when `ok` is false.
 */
function validateProductionSecretsAtBoot(opts) {
    const options = opts || {};
    const env = options.env || process.env;
    const exit = options.exit || process.exit;
    const stderr = options.stderr || process.stderr;

    const nodeEnv = env.NODE_ENV;

    // Non-production: deliberate no-op. Dev/test workflows intentionally hold
    // sentinel values until Finance confirms the real account number.
    if (nodeEnv !== 'production') {
        return { ok: true, errors: [], skipped: true };
    }

    const errors = validateSecretsForEnvironment('production');

    if (!errors || errors.length === 0) {
        return { ok: true, errors: [], skipped: false };
    }

    const blocks = errors.map((err) => formatBlock(err).join('\n'));

    // Controlled-pilot escape hatch for the cutover/finance secrets below.
    // When an operator EXPLICITLY sets
    // ALLOW_PENDING_SECRETS=true we downgrade the hard boot-refusal to a loud
    // warning, so a controlled pilot can run the current code while Finance is
    // still confirming the real cutover secrets (platform bank account, SMTP,
    // SMS). The secrets are still pending — any receipt or notification that
    // consumes them will be WRONG or non-functional — so the flag MUST be
    // removed (and real values set) before the financial go-live. This is NOT a
    // default: without the flag, production still refuses to boot.
    if (String(env.ALLOW_PENDING_SECRETS || '') === 'true') {
        const warnHeader = [
            '',
            '================================================================',
            '  [PENDING_SECRETS_BYPASS_ACTIVE] ALLOW_PENDING_SECRETS=true',
            '  [ข้ามชั่วคราวสำหรับ pilot] ALLOW_PENDING_SECRETS=true',
            '  ' + errors.length + ' production secret(s) are still pending — boot ALLOWED with warnings.',
            '  ⚠ Receipts / notifications that use these will be WRONG or non-functional.',
            '  ⚠ Set the real values and REMOVE this flag before financial cutover.',
            '  Runbook: ' + CUTOVER_RUNBOOK,
            '================================================================',
            '',
        ];
        stderr.write(warnHeader.join('\n') + '\n');
        for (const block of blocks) {
            stderr.write(block + '\n\n');
        }
        return { ok: false, errors, skipped: false, bypassed: true };
    }

    // Production + at least one error → refuse boot with actionable diagnostics.
    const header = [
        '',
        '================================================================',
        '  [OPERATOR_INTERVENTION_REQUIRED] Production boot refused',
        '  [ต้องดำเนินการโดยผู้ดูแลระบบ] ระบบ production ปฏิเสธการเริ่มทำงาน',
        '  ' + errors.length + ' production-required secret(s) failed validation.',
        '  Runbook: ' + CUTOVER_RUNBOOK,
        '================================================================',
        '',
    ];
    stderr.write(header.join('\n') + '\n');

    for (const block of blocks) {
        stderr.write(block + '\n\n');
    }

    stderr.write(
        'Fix the above secret(s) in the production secret manager, then restart.\n'
        + '(Controlled-pilot only: set ALLOW_PENDING_SECRETS=true to boot with warnings instead.)\n'
        + 'See ' + CUTOVER_RUNBOOK + ' for the cutover sequence.\n',
    );

    exit(1);

    // Unreachable in production (process.exit), but kept for test introspection
    // where `exit` is a mock that does not actually terminate.
    return { ok: false, errors, skipped: false };
}

/**
 * Inspect the certificate signing key WITHOUT loading the async signature
 * service, and without ever returning key material.
 *
 * Deliberately synchronous: it runs at the top of server.js, before the express
 * app is built, so "refuse to boot" means the process never starts serving
 * rather than "starts, then fails the first issuance".
 *
 * @param {string} keyDir
 * @returns {{ok: boolean, reason?: string, detail?: string, fingerprint?: string}}
 */
function inspectSigningKey(keyDir) {
    const publicKeyPath = path.join(keyDir, 'public.pem');
    const privateKeyPath = path.join(keyDir, 'private.pem');

    let publicPem;
    let privatePem;
    try {
        publicPem = fs.readFileSync(publicKeyPath, 'utf8');
        privatePem = fs.readFileSync(privateKeyPath, 'utf8');
    } catch (err) {
        return { ok: false, reason: 'KEY_UNREADABLE', detail: err.message };
    }

    // Prove the pair can actually sign — a private.pem encrypted under a
    // passphrase nobody has any more reads perfectly and only fails later, at
    // issuance, where the old code turned it into an unsigned certificate.
    let passphrase;
    try {
        passphrase = getSecret('RSA_PRIVATE_KEY_PASSPHRASE');
    } catch (err) {
        return { ok: false, reason: 'PASSPHRASE_UNAVAILABLE', detail: err.message };
    }
    try {
        const probe = 'boot-secret-guard:signing-key-probe';
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(probe);
        signer.end();
        const sig = signer.sign({ key: privatePem, passphrase }, 'hex');
        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(probe);
        verifier.end();
        if (!verifier.verify(publicPem, sig, 'hex')) {
            return { ok: false, reason: 'KEY_PAIR_MISMATCH', detail: 'private.pem does not match public.pem' };
        }
    } catch (err) {
        return { ok: false, reason: 'KEY_UNUSABLE', detail: err.message };
    }

    // sha256 of a PUBLIC key — safe to print, and the operator needs it to see
    // which key the box is actually holding.
    const fingerprint = fingerprintPublicKey(publicPem);
    const expected = getExpectedSigningKeyFingerprint();
    if (expected && expected !== fingerprint) {
        return {
            ok: false,
            reason: 'FINGERPRINT_MISMATCH',
            detail: `expected ${expected}, mounted key is ${fingerprint}`,
            fingerprint,
        };
    }
    return { ok: true, fingerprint };
}

/**
 * RULING 2 (2026-08-22) — refuse to boot when the certificate signing key is
 * missing, unusable, or not the key the operator pinned.
 *
 * Why a boot guard and not just a runtime check: the retired behaviour was that
 * a missing key was replaced by a freshly generated one. That does not fail —
 * it succeeds at the wrong thing. Every certificate signed with the previous
 * key silently stops verifying, and nobody finds out until a citizen or an
 * inspector scans an old certificate. A machine move is exactly when this
 * happens and exactly when nobody is looking for it.
 *
 * Scope: only where a key is REQUIRED (production, or REQUIRE_SIGNING_KEY=true).
 * Development stays free to generate a throwaway key — loudly, in
 * signature-service.ensureLocalKeys.
 *
 * NOTE: `ALLOW_PENDING_SECRETS` deliberately does NOT bypass this guard. That
 * escape hatch exists so a pilot can run while Finance confirms bank details;
 * a wrong signing key is not a pending value, it is an invalid certificate.
 *
 * @param {object} [opts]
 * @param {object} [opts.env=process.env]
 * @param {function} [opts.exit=process.exit]
 * @param {{write: function}} [opts.stderr=process.stderr]
 * @param {string} [opts.keyDir] - defaults to the signature service's key dir
 * @returns {{ok: boolean, skipped: boolean, reason?: string, fingerprint?: string}}
 */
function validateSigningKeyAtBoot(opts) {
    const options = opts || {};
    const exit = options.exit || process.exit;
    const stderr = options.stderr || process.stderr;

    const keyDir = options.keyDir || DEFAULT_KEY_DIR;

    // Where a key is NOT required (development), boot is never refused — a box that
    // mints its throwaway key on first use is normal and dying here would be worse
    // than the bug. But it used to say NOTHING, and that silence is a real defect:
    // on 2026-09-05 this box's private.pem had been encrypted under a passphrase that
    // no longer existed, and the first mention of it was a 503 at the moment an
    // officer pressed "ผ่านการตรวจ" — the application rolled back in front of them,
    // for a fault that had been sitting on disk since the previous boot.
    //
    // So: still inspect, still report, refuse nothing, touch nothing.
    if (!isSigningKeyRequired()) {
        const devResult = inspectSigningKey(keyDir);
        if (!devResult.ok && devResult.reason !== 'KEY_UNREADABLE') {
            // KEY_UNREADABLE here means "no key file yet", which is the ordinary
            // first-boot state; anything else means a key EXISTS and cannot be used.
            stderr.write(
                `[signing-key] ${devResult.reason} — the signing key in ${keyDir} exists but cannot be used, `
                + 'so certificate issuance will fail when an audit is passed. Nothing was changed on disk. '
                + 'Set RSA_PRIVATE_KEY_PASSPHRASE to the passphrase it was encrypted with, or move the key '
                + `aside deliberately (see ${keyDir}/README.md) — never delete it before checking what it signed. `
                + `Detail: ${devResult.detail}\n`,
            );
        }
        return { ok: true, skipped: true, devVerdict: devResult };
    }

    const result = inspectSigningKey(keyDir);
    if (result.ok) {
        return { ok: true, skipped: false, fingerprint: result.fingerprint };
    }

    stderr.write([
        '',
        '================================================================',
        '  [OPERATOR_INTERVENTION_REQUIRED] Boot refused — certificate signing key',
        '  [ต้องดำเนินการโดยผู้ดูแลระบบ] ปฏิเสธการเริ่มระบบ เพราะกุญแจลงลายมือชื่อใบรับรองใช้งานไม่ได้',
        '  Reason: ' + result.reason,
        '  Detail: ' + result.detail,
        '  Key directory: ' + keyDir,
        '',
        '  EN: The signing key could not be loaded and used. The server will NOT',
        '      generate a replacement: a new key invalidates every certificate',
        '      already signed with the old one.',
        '  TH: ระบบโหลดกุญแจลงลายมือชื่อไม่ได้ และจะไม่สร้างกุญแจใหม่ให้',
        '      เพราะกุญแจใหม่จะทำให้ใบรับรองที่ออกไปแล้วทั้งหมดตรวจสอบไม่ผ่าน',
        '  Action: mount the existing key read-only at ' + keyDir + ' (private.pem +',
        '      public.pem), set RSA_PRIVATE_KEY_PASSPHRASE, and restart.',
        '  Action (TH): เมาต์กุญแจเดิมแบบอ่านอย่างเดียวไว้ที่ ' + keyDir,
        '      ตั้งค่า RSA_PRIVATE_KEY_PASSPHRASE แล้วเริ่มระบบใหม่',
        '  Runbook: ' + SIGNING_KEY_RUNBOOK,
        '================================================================',
        '',
    ].join('\n') + '\n');

    exit(1);

    // Unreachable in production (process.exit); kept so tests that inject a
    // non-terminating `exit` can introspect the verdict.
    return { ok: false, skipped: false, reason: result.reason };
}

module.exports = {
    validateProductionSecretsAtBoot,
    validateSigningKeyAtBoot,
    inspectSigningKey,
    formatBlock,
    CUTOVER_RUNBOOK,
    SIGNING_KEY_RUNBOOK,
};
