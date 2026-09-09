import 'server-only';
import { readEnv } from '@gacp/contracts';
import { createDatabaseClient, type DatabaseClient } from '@gacp/db';

// client ของฐานข้อมูลตัวเดียวต่อ process (dev reload ของ Next ใช้ซ้ำผ่าน globalThis ไม่เปิด connection ใหม่ทุกครั้ง)
const globalForDatabase = globalThis as unknown as { gacpDatabase?: DatabaseClient };

export const database: DatabaseClient =
  globalForDatabase.gacpDatabase ?? createDatabaseClient(readEnv().GACP_DATABASE_URL);

if (process.env.NODE_ENV !== 'production') {
  globalForDatabase.gacpDatabase = database;
}
