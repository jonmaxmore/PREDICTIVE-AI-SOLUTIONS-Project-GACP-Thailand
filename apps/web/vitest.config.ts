import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// unit test ของ web: ไม่ต่อฐานข้อมูล ไม่ต่อผู้ให้บริการยืนยันตัวตน
// server-only ถูกแทนด้วยไฟล์ว่าง เพราะนอก React Server Components แพ็กเกจนี้จะ throw ตอน import
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
  },
});
