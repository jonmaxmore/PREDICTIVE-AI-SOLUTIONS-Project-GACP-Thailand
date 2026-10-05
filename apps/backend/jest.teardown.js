/**
 * Global teardown for backend Jest environment.
 * Ensures database connections are closed even if individual test suites fail.
 */

module.exports = async () => {
  // Prisma cleanup (PostgreSQL)
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$disconnect();
  } catch (error) {
    console.warn(`[jest-teardown] Prisma disconnect warning: ${error.message}`);
  }

  await new Promise(resolve => setTimeout(resolve, 250));
};
