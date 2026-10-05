// PDPA-AWARE — one-off dev tool that finds duplicate User rows sharing a known idCard and
// resets each to UNVERIFIED. Lookup uses `idCardHash` (deterministic SHA-256) so duplicate
// detection still works after PDPA Phase 1 encryption of `User.idCard` (multiple rows with
// the same plaintext yield the same hash, so duplicates remain detectable). Updates key on
// primary key `id`, unaffected by encryption.
const { PrismaClient } = require('@prisma/client');
const { computeIdentifierHash } = require('../services/user-lookup-service');
const prisma = new PrismaClient();

const TARGET_ID_CARD = '1100100100011';

async function main() {
    console.log(`Checking duplicates for ID: ${TARGET_ID_CARD}...`);

    const users = await prisma.user.findMany({
        where: { idCardHash: computeIdentifierHash(TARGET_ID_CARD) },
    });

    console.log(`Found ${users.length} users.`);

    for (const user of users) {
        console.log(`- User: ${user.firstName} ${user.lastName} (ID: ${user.id}) | Status: ${user.verificationStatus}`);

        // Force Reset
        await prisma.user.update({
            where: { id: user.id },
            data: {
                verificationStatus: 'UNVERIFIED',
                status: 'PENDING_VERIFICATION', // Ensure they can login but not active
                verificationDocuments: {},
                verificationSubmittedAt: null,
            },
        });
        console.log(`-> Reset to UNVERIFIED.`);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
