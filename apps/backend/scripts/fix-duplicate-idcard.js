/**
 * Fix duplicate idCard - remove from old Applicant accounts
 *
 * PDPA-AWARE — recurring-ish admin operation kept around in case the old Applicant1-3
 * dev accounts get re-seeded with a stale idCard. The updateMany filter keys on `email`
 * (NOT encrypted), so the clearing step works regardless of Phase 1 status. The trailing
 * verification `findMany` was originally `where: { idCard: { in: [...] } }`, which would
 * break post-Phase 1 because plaintext WHERE never matches encrypted ciphertext. Refactored
 * to query by `idCardHash` (deterministic SHA-256, same scheme as prisma-auth-service.js).
 * `select: { idCard }` still returns plaintext after Phase 1 — the extension transparently
 * decrypts on read.
 */
const { PrismaClient } = require('@prisma/client');
const { computeIdentifierHash } = require('../services/user-lookup-service');
const p = new PrismaClient();

async function main() {
    console.log('Fixing duplicate idCard...');

    // Remove idCard from old Applicant accounts (Applicant1, Applicant2, Applicant3)
    const oldAccounts = ['Applicant1@demo.gacp.th', 'Applicant2@demo.gacp.th', 'Applicant3@demo.gacp.th'];

    for (const email of oldAccounts) {
        const result = await p.user.updateMany({
            where: { email: email },
            data: { idCard: null },
        });
        console.log(`Updated ${email}: ${result.count} rows`);
    }

    // Verify — query by idCardHash so this survives PDPA Phase 1 encryption of idCard.
    const targets = ['1100100100011', '1100100100028', '1100100100035'];
    const targetHashes = targets.map(computeIdentifierHash).filter(Boolean);
    const users = await p.user.findMany({
        where: { idCardHash: { in: targetHashes } },
        select: { email: true, firstName: true, idCard: true, idCardHash: true },
    });

    console.log('\nUsers with Thai ID after fix:');
    users.forEach(u => {
        console.log(`- ${u.email} | ${u.firstName} | idCard: ${u.idCard} | idCardHash: ${u.idCardHash}`);
    });

    await p.$disconnect();
}

main();
