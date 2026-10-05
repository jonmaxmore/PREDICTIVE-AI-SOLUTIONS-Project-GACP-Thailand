// PDPA-AWARE — one-off dev tool that migrated a known test user's verificationStatus
// from legacy 'VERIFIED' to current 'APPROVED'. Likely dead after the original migration
// landed, but kept in repo for parity with sibling debug tools. Query refactored to use
// `idCardHash` so it doesn't break under PDPA Phase 1 encryption of `User.idCard`.
const { PrismaClient } = require('@prisma/client');
const { computeIdentifierHash } = require('../services/user-lookup-service');
const prisma = new PrismaClient();

const TARGET_ID_CARD = '1100100100011';

async function main() {
    console.log(`Migrating Status for ID: ${TARGET_ID_CARD}...`);

    const user = await prisma.user.findFirst({
        where: { idCardHash: computeIdentifierHash(TARGET_ID_CARD) },
    });

    if (!user) {
        console.log('User not found');
        return;
    }

    console.log(`Current Status: ${user.verificationStatus}`);

    if (user.verificationStatus === 'VERIFIED') {
        await prisma.user.update({
            where: { id: user.id },
            data: { verificationStatus: 'APPROVED' },
        });
        console.log('Updated to APPROVED');
    } else {
        console.log('ℹ️ No update needed');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
