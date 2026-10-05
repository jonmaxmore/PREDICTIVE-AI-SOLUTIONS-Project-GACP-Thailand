#!/usr/bin/env node
'use strict';
/**
 * Set ONE certificate's business dates for the G4 timeline — and nothing else.
 *
 * GOALS §G4.3 (operator-set): day 1 = 1 มกราคม พ.ศ. 2567 = 2024-01-01 in the database;
 * `Certificate.issuedDate` moves there, expiry moves with it (3 years), and `createdAt`
 * is NEVER touched — it stays the only honest record of when the row was really made
 * (G4.0 rule 3). There is no UI for this by design: no farmer or officer may move an
 * issuance date, so the walk's one sanctioned adjustment happens here, guarded, with
 * the before/after written to the evidence pack.
 *
 * Guards, all fatal:
 *   - exactly one certificate matches the number given;
 *   - the target date is exactly what GOALS names (2024-01-01) — this script cannot be
 *     reused to set arbitrary dates without editing it, on purpose;
 *   - the row carries NEITHER a signature NOR a documentHash (see below);
 *   - createdAt is read before and asserted identical after.
 *
 * WHY the signature/hash guard, and why it REFUSES instead of re-signing:
 *   `issuedDate` and `expiryDate` are INSIDE buildCertificateDocumentHash's canonical
 *   field list (certificate-service.js certificateCanonicalJson). Writing them after the
 *   row was signed leaves the stored hash describing a row that no longer exists, so the
 *   public verifier reports TAMPERED — which is correct behaviour: a verifier cannot tell
 *   an innocent backdate from forgery, and that indistinguishability is the entire value
 *   of the hash. That is exactly what this script did to GACP-TH-2569-CAE820 on 2026-08-25.
 *   Re-signing would clear the symptom and create a far worse power: any maintenance script
 *   could mint a new authoritative version of a government certificate. Issuance is the only
 *   place allowed to sign, under its own evidence gate. So a signed row is simply off-limits
 *   here — backdate the scenario BEFORE issuance, or press a fresh walk.
 *
 * Usage: node scripts/g4/set-certificate-business-date.js <certificateNumber> <evidenceDir>
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');

const ISSUED = new Date('2024-01-01T00:00:00.000Z'); // GOALS G4.3 — the only date allowed
const VALID_YEARS = 3;

async function main() {
    const [certNumber, evidenceDir] = process.argv.slice(2);
    if (!certNumber || !evidenceDir) {
        console.error('usage: set-certificate-business-date.js <certificateNumber> <evidenceDir>');
        process.exit(2);
    }
    const u = new URL(process.env.DATABASE_URL);
    u.port = '6543'; u.searchParams.set('pgbouncer', 'true'); u.searchParams.set('connection_limit', '1');
    const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

    const before = await prisma.certificate.findMany({
        where: { certificateNumber: certNumber },
        select: {
            id: true, certificateNumber: true, issuedDate: true, expiryDate: true,
            createdAt: true, status: true, signature: true, documentHash: true,
        },
    });
    if (before.length !== 1) {
        console.error(`FATAL: expected exactly 1 certificate for ${certNumber}, found ${before.length} — refusing`);
        process.exit(1);
    }
    const b = before[0];

    // Both columns are checked, not just `signature`: a row can carry a documentHash
    // while its signing attempt is still in flight, and the hash alone is enough for the
    // public verifier to call this row TAMPERED once the dates move.
    if (b.signature || b.documentHash) {
        const carries = [b.signature && 'signature', b.documentHash && 'documentHash'].filter(Boolean).join(' + ');
        console.error(
            `FATAL: ${certNumber} carries ${carries} — refusing.\n`
            + '  issuedDate/expiryDate are inside buildCertificateDocumentHash, so writing them here\n'
            + '  would make the public verifier report this certificate TAMPERED.\n'
            + '  This script will not re-sign: only issuance may sign a certificate. Backdate the\n'
            + '  scenario before issuance, or press a fresh walk.',
        );
        process.exit(1);
    }

    const expiry = new Date(ISSUED);
    expiry.setFullYear(expiry.getFullYear() + VALID_YEARS);

    const updated = await prisma.certificate.update({
        where: { id: b.id },
        data: { issuedDate: ISSUED, expiryDate: expiry },
        select: { certificateNumber: true, issuedDate: true, expiryDate: true, createdAt: true, status: true },
    });

    if (updated.createdAt.getTime() !== b.createdAt.getTime()) {
        console.error('FATAL: createdAt changed — this must never happen');
        process.exit(1);
    }

    // The guard above already proved both are null; record that fact rather than the
    // columns themselves, so the evidence pack never carries crypto material.
    const { signature: _sig, documentHash: _hash, ...beforeForEvidence } = b;

    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'issued-date-change.json'), JSON.stringify({
        rule: 'GOALS G4.3 — day 1 = 2024-01-01 (พ.ศ. 2567); createdAt untouched (G4.0 rule 3)',
        unsignedAtChangeTime: 'signature and documentHash were both null — verified before the write',
        before: beforeForEvidence,
        after: updated,
        changedAt: new Date().toISOString(),
    }, null, 2));

    console.log(`${certNumber}: issuedDate ${b.issuedDate.toISOString().slice(0, 10)} → ${updated.issuedDate.toISOString().slice(0, 10)}, ` +
        `expiry → ${updated.expiryDate.toISOString().slice(0, 10)}, createdAt unchanged (${b.createdAt.toISOString()})`);
    await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
