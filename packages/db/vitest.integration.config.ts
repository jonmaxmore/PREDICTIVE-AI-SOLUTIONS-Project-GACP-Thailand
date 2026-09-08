import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// integration tests ต่อ PostgreSQL จริง (GACP_DATABASE_URL) ไม่มีการ mock ฐานข้อมูล
// ในเครื่องอ่านค่าจาก .env.local ที่ราก repo ส่วน CI ตั้งค่า GACP_* ผ่าน env ของ job
loadDotenv({ path: '../../.env.local', quiet: true });

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
