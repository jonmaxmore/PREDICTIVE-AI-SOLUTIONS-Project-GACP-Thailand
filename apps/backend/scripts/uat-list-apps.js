const { prisma } = require('./services/prisma-database');
(async () => {
    const apps = await prisma.application.findMany({
        where: { isDeleted: false },
        select: { applicationNumber: true, status: true, healthId: true },
        take: 15,
        orderBy: { createdAt: 'asc' },
    });
    apps.forEach(a => console.log(a.applicationNumber, a.status, a.healthId));
    await prisma.$disconnect();
})();
