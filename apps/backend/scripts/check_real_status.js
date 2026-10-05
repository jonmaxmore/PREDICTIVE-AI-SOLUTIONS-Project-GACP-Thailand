// PDPA-AWARE — one-off dev tool for inspecting a known test user (idCard 1100100100011).
// `User.idCard` is in PHASE_1_PII_COLUMNS (apps/backend/services/prisma-pdpa-extension.js),
// so once ENABLE_PDPA_FIELD_ENCRYPTION=true flips on, a plaintext WHERE on `idCard` will
// never match (non-deterministic AES-GCM ciphertext). This script therefore queries via
// `idCardHash` (deterministic SHA-256, same format as prisma-auth-service.js writes) so
// it keeps working before AND after Phase 1. No canonical helper for idCard yet — using
// computeIdentifierHash from services/user-lookup-service.js directly.
const { PrismaClient } = require('@prisma/client');
const { computeIdentifierHash } = require('../services/user-lookup-service');
const prisma = new PrismaClient();

const TARGET_ID_CARD = '1100100100011';

async function main() {
    console.log(`Checking Status for ID: ${TARGET_ID_CARD}...`);

    const user = await prisma.user.findFirst({
        where: { idCardHash: computeIdentifierHash(TARGET_ID_CARD) },
    });

    if (!user) {
        console.log('User not found');
        return;
    }

    console.log('--------------------------------------------------');
    console.log(`User: ${user.firstName} ${user.lastName}`);
    console.log(`Status: ${user.status}`);
    console.log(`Verification Status: ${user.verificationStatus}`);
    console.log(`Verification Note: ${user.verificationNote}`);
    console.log(`Attempts: ${user.verificationAttempts}`);
    console.log('--------------------------------------------------');
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
