/**
 * Seed Professional Test Account
 * ID: 4310100001149 / Password: Test@12345
 * 
 * Usage:
 *   docker exec gacp-backend node scripts/seed-premium-account.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { runWithTenantContext } = require('../services/tenant-context');

const prisma = new PrismaClient();

const PROFESSIONAL_ACCOUNT = {
    healthId: '4310100001149',
    email: 'professional-tester@gacp-test.local',
    password: process.env.SEED_TEST_PASSWORD || 'Test@12345',
    firstName: 'ทดสอบ',
    lastName: 'โปร',
    role: 'HEALTH',
    accountType: 'INDIVIDUAL',
    authType: 'HEALTH_ID',
    accountTier: 'PRO',
};

async function main() {
    console.log('Creating Professional Test Account...');
    console.log(`   Health ID: ${PROFESSIONAL_ACCOUNT.healthId}`);
    console.log(`   Password:  ${PROFESSIONAL_ACCOUNT.password}`);

    const defaultOrg = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'default' },
    });

    await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
        const hashedPassword = await bcrypt.hash(PROFESSIONAL_ACCOUNT.password, 12);
        const healthIdHash = crypto.createHash('sha256').update(PROFESSIONAL_ACCOUNT.healthId).digest('hex');

        // Clean up any existing conflicting rows
        const existingByHealthId = await prisma.user.findFirst({
            where: { healthId: PROFESSIONAL_ACCOUNT.healthId },
        });
        if (existingByHealthId) {
            console.log(`Found existing user with healthId, updating...`);
            await prisma.user.update({
                where: { id: existingByHealthId.id },
                data: {
                    email: PROFESSIONAL_ACCOUNT.email,
                    password: hashedPassword,
                    firstName: PROFESSIONAL_ACCOUNT.firstName,
                    lastName: PROFESSIONAL_ACCOUNT.lastName,
                    role: PROFESSIONAL_ACCOUNT.role,
                    accountType: PROFESSIONAL_ACCOUNT.accountType,
                    authType: PROFESSIONAL_ACCOUNT.authType,
                    healthIdHash,
                    status: 'ACTIVE',
                    isEmailVerified: true,
                    ministryVerified: true,
                },
            });
            console.log(`Updated existing account (ID: ${existingByHealthId.id})`);
            return;
        }

        const existingByEmail = await prisma.user.findUnique({
            where: { email: PROFESSIONAL_ACCOUNT.email },
        });
        if (existingByEmail) {
            console.log(`Found existing user with email, updating...`);
            await prisma.user.update({
                where: { email: PROFESSIONAL_ACCOUNT.email },
                data: {
                    healthId: PROFESSIONAL_ACCOUNT.healthId,
                    healthIdHash,
                    password: hashedPassword,
                    firstName: PROFESSIONAL_ACCOUNT.firstName,
                    lastName: PROFESSIONAL_ACCOUNT.lastName,
                    role: PROFESSIONAL_ACCOUNT.role,
                    accountType: PROFESSIONAL_ACCOUNT.accountType,
                    authType: PROFESSIONAL_ACCOUNT.authType,
                    status: 'ACTIVE',
                    isEmailVerified: true,
                    ministryVerified: true,
                },
            });
            console.log(`Updated existing account (ID: ${existingByEmail.id})`);
            return;
        }

        // Create fresh
        const user = await prisma.user.create({
            data: {
                healthId: PROFESSIONAL_ACCOUNT.healthId,
                healthIdHash,
                email: PROFESSIONAL_ACCOUNT.email,
                password: hashedPassword,
                firstName: PROFESSIONAL_ACCOUNT.firstName,
                lastName: PROFESSIONAL_ACCOUNT.lastName,
                role: PROFESSIONAL_ACCOUNT.role,
                accountType: PROFESSIONAL_ACCOUNT.accountType,
                authType: PROFESSIONAL_ACCOUNT.authType,
                status: 'ACTIVE',
                isEmailVerified: true,
                ministryVerified: true,
            },
        });
        console.log(`Created new account (ID: ${user.id})`);
    });
}

main()
    .catch((e) => {
        console.error('Error:', e.message);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
