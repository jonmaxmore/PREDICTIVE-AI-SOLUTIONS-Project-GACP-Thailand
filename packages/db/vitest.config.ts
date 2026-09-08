import { configDefaults, defineConfig } from 'vitest/config';

// unit tests เท่านั้น ส่วนที่ต่อฐานข้อมูลจริงอยู่ใน vitest.integration.config.ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
  },
});
