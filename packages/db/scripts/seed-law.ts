// โหลด "กฎเป็นข้อมูล" เข้าฐานข้อมูล รัน: pnpm --filter @gacp/db seed:law (อ่าน GACP_DATABASE_DIRECT_URL จาก .env.local ที่ราก repo)
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '../../.env.local', quiet: true });
loadDotenv({ path: '../../.env', quiet: true });

// import แบบ dynamic หลังโหลด .env.local เพื่อให้ readEnv() เห็นค่าครบ
const { readEnv } = await import('@gacp/contracts');
const { createDatabaseClient } = await import('../src/client.ts');
const { seedLawData } = await import('../src/seed-law.ts');

const database = createDatabaseClient(readEnv().GACP_DATABASE_DIRECT_URL);
try {
  const counts = await seedLawData(database);
  console.info(
    `seed:law เรียบร้อย · พืช ${counts.plants} · ช่องเอกสาร ${counts.documentSlots} · กฎ ${counts.documentRequirementRules} · อัตรา ${counts.feeSchedules} · รายการตรวจ ${counts.inspectionChecklistItems} · อายุใบรับรอง ${counts.certificateTerms} · วันหยุด ${counts.publicHolidays}`,
  );
} finally {
  await database.$disconnect();
}
