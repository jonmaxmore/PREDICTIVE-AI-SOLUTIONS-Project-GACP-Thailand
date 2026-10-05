/**
 * Seed Test Applicant Accounts for Cannabis Application Testing
 * Run from apps/backend: cp ../../scripts/seed-test-Applicants.js . && node seed-test-Applicants.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Use same hash as auth service (SHA-256)
const hash = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

const prisma = new PrismaClient();

async function main() {
    console.log('?? Creating test Applicant accounts for Cannabis testing...\n');

    const password = await bcrypt.hash('Test1234', 12);

    // Test accounts for all 3 types - using hash() function for proper lookups
    const testApplicants = [
        {
            // ??????????? (Individual)
            email: 'Applicant.individual@test.gacp.go.th',
            password,
            accountType: 'INDIVIDUAL',
            idCard: '1234567890121', // Valid checksum
            idCardHash: hash('1234567890121'), // Proper SHA-256 hash!
            firstName: '?????',
            lastName: '?????',
            phoneNumber: '0812345678',
            status: 'ACTIVE',
            role: 'HEALTH',
            isEmailVerified: true,
        },
        {
            // ????????? (Corporate)
            email: 'Applicant.corporate@test.gacp.go.th',
            password,
            accountType: 'JURISTIC',
            taxId: '0105556012345',
            taxIdHash: hash('0105556012345'), // Proper SHA-256 hash!
            companyName: '?????? ???????????? ?????',
            representativeName: '???????????? ?????',
            phoneNumber: '0823456789',
            status: 'ACTIVE',
            role: 'HEALTH',
            isEmailVerified: true,
        },
        {
            // ????????????? (Community Enterprise)
            email: 'Applicant.community@test.gacp.go.th',
            password,
            accountType: 'COMMUNITY_ENTERPRISE',
            communityRegistrationNo: '5-01-01-50/001',
            communityRegistrationNoHash: hash('501015001'), // Proper SHA-256 hash (without dashes)
            communityName: '?????????????????????????',
            representativeName: '???????????? ?????',
            phoneNumber: '0834567890',
            status: 'ACTIVE',
            role: 'HEALTH',
            isEmailVerified: true,
        }
    ];

    for (const Applicant of testApplicants) {
        try {
            // Delete existing account (if any)
            const existing = await prisma.user.findFirst({
                where: { email: Applicant.email }
            });

            if (existing) {
                await prisma.user.delete({ where: { id: existing.id } });
                console.log(`???  Deleted existing: ${Applicant.email}`);
            }

            // Create fresh user
            await prisma.user.create({ data: Applicant });

            console.log(`? Created ${Applicant.accountType}:`);
            console.log(`   Email: ${Applicant.email}`);
            console.log(`   ID: ${Applicant.idCard || Applicant.taxId || Applicant.communityRegistrationNo}`);
            console.log(`   Hash: ${Applicant.idCardHash || Applicant.taxIdHash || Applicant.communityRegistrationNoHash}`);
            console.log(`   Password: Test1234\n`);

        } catch (error) {
            console.error(`? Error creating ${Applicant.accountType}:`, error.message);
        }
    }

    console.log('\n?? Done! You can now login at https://gacpth.com/login');
    console.log('\n?? Test Accounts:');
    console.log('   Individual: 1234567890121 / Test1234');
    console.log('   Corporate: 0105556012345 / Test1234');
    console.log('   Community: 5-01-01-50/001 / Test1234');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
