const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

async function verify() {
    console.log('=== Verification ===');
    console.log('Expected hash for 1234567890121:', hash('1234567890121'));

    const user = await prisma.user.findFirst({
        where: { email: 'Applicant.individual@test.gacp.go.th' }
    });

    if (user) {
        console.log('User found:', user.email);
        console.log('idCardHash in DB:', user.idCardHash);
        console.log('Match:', user.idCardHash === hash('1234567890121'));
        console.log('Status:', user.status);
        console.log('Password exists:', !!user.password);
    } else {
        console.log('User NOT found!');
    }

    await prisma.$disconnect();
}

verify();
