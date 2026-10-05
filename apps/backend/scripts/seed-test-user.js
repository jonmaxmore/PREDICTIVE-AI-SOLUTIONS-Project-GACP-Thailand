
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { runWithTenantContext } = require('../services/tenant-context');

function hash(text) {
    return crypto.createHash('sha256').update(String(text)).digest('hex');
}

async function main() {
    const defaultOrg = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'default' },
    });
    try {
        await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
            console.log('Seeding test user...');
            const email = 'test@example.com';
            const password = 'password123';
            // Use synchronous hash for simplicity in seed, or await hash
            const hashedPassword = await bcrypt.hash(password, 10);
            const idCard = '1234567890123';
            const idCardHash = hash(idCard);

            console.log('Cleaning up old test data...');
            const existingByEmail = await prisma.user.findUnique({ where: { email } });
            if (existingByEmail) {await prisma.user.delete({ where: { email } });}

            const existingByHash = await prisma.user.findUnique({ where: { idCardHash } });
            if (existingByHash) {await prisma.user.delete({ where: { idCardHash } });}

            console.log('Creating new user...');
            const user = await prisma.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    role: 'HEALTH',
                    status: 'ACTIVE',
                    accountType: 'INDIVIDUAL',
                    idCardHash,
                    firstName: 'Test',
                    lastName: 'User',
                },
            });
            console.log('User created:', user.id);
            console.log('Stored Hash:', user.password);

            // Verify compare
            console.log('Verifying password...');
            const isMatch = bcrypt.compareSync(password, user.password);
            console.log('Password Verification Match:', isMatch);

            if (!isMatch) {
                console.error('FAILED: Password mismatch!');
                process.exit(1);
            } else {
                console.log('SUCCESS: Password verifies correctly.');
            }
        });
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
