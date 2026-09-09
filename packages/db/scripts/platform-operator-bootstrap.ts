// เพิ่มผู้ดูแลระบบคนแรกของบริษัทผู้ให้บริการแพลตฟอร์ม (หรือกู้คืนเมื่อไม่มีผู้ดูแลเหลือ)
// เลขบัตรรับจาก stdin เท่านั้น (ไม่ผ่าน argument ไม่ลง shell history ไม่ลง log) และเก็บเป็น HMAC เท่านั้น
// รัน: pnpm db:platform-operator:bootstrap  แล้วพิมพ์ "ชื่อที่จะแสดง<TAB>เลขบัตรประชาชน 13 หลัก" หนึ่งบรรทัด
// คนนี้จะได้บทบาท PLATFORM_OPERATOR_ADMIN อัตโนมัติเมื่อเข้าสู่ระบบด้วย ThaID ครั้งแรก (completeSignIn)
import { createHmac } from 'node:crypto';
import { createInterface } from 'node:readline';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '../../.env.local', quiet: true });
loadDotenv({ path: '../../.env', quiet: true });

// import แบบ dynamic หลังโหลด .env.local เพื่อให้ readEnv() เห็นค่าครบ
const { isValidThaiNationalId, readEnv } = await import('@gacp/contracts');
const { createDatabaseClient } = await import('../src/client.ts');

const env = readEnv();

function readFirstLine(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const lines = createInterface({ input: process.stdin, terminal: false });
    let settled = false;
    lines.once('line', (line) => {
      settled = true;
      lines.close();
      resolve(line);
    });
    lines.once('close', () => {
      if (!settled) resolve(undefined);
    });
  });
}

console.info('พิมพ์: ชื่อที่จะแสดง<TAB>เลขบัตรประชาชน 13 หลัก แล้วกด Enter');
const firstLine = await readFirstLine();
const [rawDisplayName, rawNationalId] = (firstLine ?? '').split('\t').map((part) => part.trim());
const displayName = rawDisplayName ?? '';
const nationalId = (rawNationalId ?? '').replace(/[\s-]/g, '');

if (displayName.length === 0 || displayName.length > 120 || !isValidThaiNationalId(nationalId)) {
  console.error('รูปแบบไม่ถูกต้อง ต้องเป็น ชื่อ<TAB>เลขบัตร 13 หลักที่ตัวเลขตรวจสอบถูก');
  process.exit(1);
}

// ต้องให้ผลเท่ากับ hmacField() ของ web: HMAC-SHA256 ด้วยกุญแจ hex ของ GACP_DATA_HMAC_KEY บนข้อความ utf8 → hex
const nationalIdHmac = createHmac('sha256', Buffer.from(env.GACP_DATA_HMAC_KEY, 'hex'))
  .update(nationalId, 'utf8')
  .digest('hex');

const database = createDatabaseClient(env.GACP_DATABASE_DIRECT_URL);
try {
  const membership = await database.platformOperatorMembership.upsert({
    where: { nationalIdHmac },
    create: { nationalIdHmac, displayName, bootstrapAdmin: true },
    update: { displayName, bootstrapAdmin: true, revokedAt: null, revokedById: null },
  });
  console.info(
    `เพิ่ม ${membership.displayName} ในรายชื่อพนักงานบริษัทแล้ว (id ${membership.id}) เมื่อเข้าสู่ระบบด้วย ThaID ครั้งแรกจะได้บทบาทผู้ดูแลระบบของบริษัททันที`,
  );
} finally {
  await database.$disconnect();
}
