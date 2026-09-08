import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

export type DatabaseClient = PrismaClient;

// จุดเดียวที่สร้าง client ของฐานข้อมูล แอปต้องส่ง connection string ที่อ่านผ่าน @gacp/contracts readEnv()
export function createDatabaseClient(connectionString: string): DatabaseClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
