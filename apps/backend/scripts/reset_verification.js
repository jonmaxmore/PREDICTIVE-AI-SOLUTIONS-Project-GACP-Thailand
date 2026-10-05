// PDPA-AWARE — one-off dev tool that resets verification for a known test user.
// `User.idCard` is encrypted under Phase 1 (PHASE_1_PII_COLUMNS in prisma-pdpa-extension.js),
// so the lookup uses `idCardHash` (deterministic SHA-256) instead of plaintext WHERE.
// The subsequent update keys on `id` (primary key, unaffected by encryption) so the
// `verificationStatus`/`status` writes remain safe. If this needs to run post-Phase 1,
// it will continue to work as-is.
const { PrismaClient } = require('@prisma/client');
const { computeIdentifierHash } = require('../services/user-lookup-service');
const prisma = new PrismaClient();

const TARGET_ID_CARD = '1100100100011';

async function main() {
    console.log(`Resetting verification for ID Card: ${TARGET_ID_CARD}...`);

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
            verificationStatus: 'UNVERIFIED',
            status: 'PENDING_VERIFICATION',
            verificationDocuments: {}, // Clear docs
            verificationSubmittedAt: null,
            verificationNote: null,
            verificationAttempts: 0,      // Reset attempts
            verificationLockedUntil: null, // Unlock if locked
        },
    });

    console.log(`User ${user.firstName} (ID: ${user.id}) reset to UNVERIFIED.`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
