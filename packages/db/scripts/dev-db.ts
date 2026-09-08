// ฐานข้อมูลสำหรับพัฒนาบนเครื่อง: PostgreSQL ฝังใน node_modules ไม่ต้องติดตั้งอะไรในระบบ
// รัน: pnpm --filter @gacp/db db:dev  แล้วปล่อยหน้าต่างนี้เปิดไว้ (Ctrl+C เพื่อหยุด)
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const DATABASE_DIR = resolve('.pgdata');
const PORT = 54329;
const USER = 'gacp';
const PASSWORD = 'gacp';
const DATABASE = 'gacp';

const instance = new EmbeddedPostgres({
  databaseDir: DATABASE_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (!existsSync(resolve(DATABASE_DIR, 'PG_VERSION'))) {
  console.info('กำลังสร้างคลัสเตอร์ PostgreSQL ครั้งแรกใน .pgdata');
  await instance.initialise();
}

await instance.start();

try {
  await instance.createDatabase(DATABASE);
  console.info(`สร้างฐานข้อมูล ${DATABASE} แล้ว`);
} catch {
  // มีฐานข้อมูลอยู่แล้วจากรอบก่อน
}

console.info(`PostgreSQL พร้อมใช้ที่ postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`);
console.info('กด Ctrl+C เพื่อหยุด');

async function shutdown(): Promise<void> {
  console.info('กำลังหยุด PostgreSQL');
  await instance.stop();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
