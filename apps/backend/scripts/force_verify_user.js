// PDPA-AWARE — one-off dev tool that force-verifies a known test user (idCard
// 1100100100011) used when OCR can't read the uploaded image. Lookup uses `idCardHash`
// (deterministic SHA-256) so it survives PDPA Phase 1 encryption of `User.idCard`.
// The update keys on primary key `id`, which is unaffected by encryption.
const { PrismaClient } = require('@prisma/client');
const { computeIdentifierHash } = require('../services/user-lookup-service');
const prisma = new PrismaClient();

const TARGET_ID_CARD = '1100100100011';

async function main() {
    console.log(`Force Verifying ID: ${TARGET_ID_CARD}...`);

    const user = await prisma.user.findFirst({
        where: { idCardHash: computeIdentifierHash(TARGET_ID_CARD) },
    });

    if (!user) {
        console.error('User not found!');
        process.exit(1);
    }

    await prisma.user.update({
        where: { id: user.id },
        data: {
            verificationStatus: 'VERIFIED', // Force Pass
            status: 'ACTIVE',
            verificationNote: 'Manual Override: AI OCR could not read image clearly.',
        },
    });

    console.log(`User ${user.firstName} is now VERIFIED.`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
