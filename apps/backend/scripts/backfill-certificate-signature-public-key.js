#!/usr/bin/env node
/**
 * RULING 2 (2026-08-22) — backfill `certificates.signaturePublicKey`.
 *
 * Pins the verifying PEM onto every already-signed certificate that has none,
 * so those rows survive key rotation and machine moves like newly-issued ones do.
 *
 * WHAT MAKES THIS SAFE
 * --------------------
 * The obvious backfill — "set every signed row to the current public key,
 * it is the only key that could have signed them" — is an ASSUMPTION. This
 * script does not make it. For each candidate row it runs a real RSA verify of
 * `signature` over `documentHash` with the candidate key, and pins the key only
 * where that verify PASSES. A row that does not verify is REPORTED and left
 * exactly as it was: pinning a key that does not verify a signature would turn a
 * verifiable-somewhere certificate into a permanently-invalid one, which is the
 * opposite of the point.
 *
 * Idempotent: only touches rows where `signature IS NOT NULL AND
 * signaturePublicKey IS NULL`. Running it twice changes nothing the second time.
 *
 * Read-only by default. Nothing is written without `--apply`.
 *
 *   node apps/backend/scripts/backfill-certificate-signature-public-key.js
 *   node apps/backend/scripts/backfill-certificate-signature-public-key.js --apply
 *
 * Prints certificate numbers and public-key fingerprints only. No private key,
 * no passphrase, no PEM body is ever written to the output.
 */

'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const {
    getSignatureService,
    fingerprintPublicKey,
} = require('../services/crypto/signature-service');

const CERT_KEY_NAMESPACE = 'rsa:gacp-certificate';

async function main() {
    const apply = process.argv.includes('--apply');
    const prisma = new PrismaClient();

    try {
        const signatureService = getSignatureService();
        const candidateKey = await signatureService.getPublicKeyForNamespace(CERT_KEY_NAMESPACE);
        if (!candidateKey) {
            throw new Error('no signing public key is available; refusing to backfill');
        }
        const fingerprint = fingerprintPublicKey(candidateKey);
        console.log(`mode              : ${apply ? 'APPLY (writes)' : 'DRY RUN (read-only)'}`);
        console.log(`candidate key     : sha256 ${fingerprint}`);

        // Distribution first: the operator needs to see whether more than one
        // key id is in play before trusting a single-key backfill.
        const distribution = await prisma.$queryRaw`
            SELECT "signatureKeyId", count(*)::int AS n
            FROM "certificates"
            WHERE "signature" IS NOT NULL
            GROUP BY 1 ORDER BY n DESC`;
        console.log('signatureKeyId    :', JSON.stringify(distribution));

        const rows = await prisma.certificate.findMany({
            where: { signature: { not: null }, signaturePublicKey: null },
            select: {
                id: true, certificateNumber: true, documentHash: true,
                signature: true, signatureKeyId: true,
            },
        });
        console.log(`candidate rows    : ${rows.length}`);

        const pinned = [];
        const unproven = [];
        for (const row of rows) {
            if (!row.documentHash) {
                unproven.push({ certificateNumber: row.certificateNumber, why: 'no documentHash to verify against' });
                continue;
            }
            const ok = await signatureService.verifyWithLocalKey(
                row.documentHash, row.signature, candidateKey,
            );
            if (!ok) {
                unproven.push({ certificateNumber: row.certificateNumber, why: 'signature does not verify with the candidate key' });
                continue;
            }
            if (apply) {
                await prisma.certificate.update({
                    where: { id: row.id },
                    data: { signaturePublicKey: candidateKey },
                });
            }
            pinned.push(row.certificateNumber);
        }

        console.log(`${apply ? 'pinned' : 'would pin'}         : ${pinned.length}`);
        for (const n of pinned) { console.log(`  + ${n}`); }
        console.log(`left untouched    : ${unproven.length}`);
        for (const u of unproven) { console.log(`  ! ${u.certificateNumber} — ${u.why}`); }

        if (unproven.length > 0) {
            console.log(
                '\nRows above were NOT modified. Each one was signed by a key this box does not hold. '
                + 'Recover that key and re-run, or record them as unverifiable — do not pin a key that '
                + 'does not verify them.',
            );
        }
        process.exitCode = 0;
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error(`backfill failed: ${err.message}`);
    process.exitCode = 1;
});
