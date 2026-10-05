const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();

async function main() {
    // Find any user with Applicant role
    const Applicants = await p.user.findMany({
        where: { role: 'HEALTH' },
        select: { id: true, email: true, idCard: true, firstName: true, lastName: true, status: true },
        take: 5,
    });
    console.log('Applicants found:', Applicants.length);
    for (const f of Applicants) {
        console.log(`  - ${f.email} | idCard: ${f.idCard} | ${f.firstName} ${f.lastName} | ${f.status}`);
    }

    if (Applicants.length > 0) {
        const target = Applicants[0];
        const hash = await bcrypt.hash('Test@12345', 10);
        await p.user.update({
            where: { id: target.id },
            data: { password: hash },
        });
        console.log('Updated password for:', target.email, '| idCard:', target.idCard);
    }
}

main()
    .catch(e => console.error('Error:', e.message))
    .finally(() => p.$disconnect());
