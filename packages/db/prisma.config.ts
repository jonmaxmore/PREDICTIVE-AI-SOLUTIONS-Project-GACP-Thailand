import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// .env.local ของทั้ง repo อยู่ที่ root ไฟล์เดียว (ไม่เข้า git)
loadDotenv({ path: '../../.env.local', quiet: true });
loadDotenv({ path: '../../.env', quiet: true });

const directUrl = process.env.GACP_DATABASE_DIRECT_URL;
if (!directUrl) {
  throw new Error('ต้องตั้ง GACP_DATABASE_DIRECT_URL ใน .env.local ก่อนใช้คำสั่ง Prisma');
}

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: directUrl,
  },
});
