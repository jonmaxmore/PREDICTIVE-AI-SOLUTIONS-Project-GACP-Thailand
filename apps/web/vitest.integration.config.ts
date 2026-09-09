import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// integration test ของ web ต่อ PostgreSQL จริง (GACP_DATABASE_URL) ไม่มีการ mock ฐานข้อมูล
// ในเครื่องอ่านค่าจาก .env.local ที่ราก repo ส่วน CI ตั้งค่า GACP_* ผ่าน env ของ job
// GACP_ENV=test เสมอ: readEnv() ไม่บังคับ client ของ ThaID/Health ID และเปิดใช้ setIdentityClientsForTest ได้
loadDotenv({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)), quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    env: { GACP_ENV: 'test' },
  },
});
