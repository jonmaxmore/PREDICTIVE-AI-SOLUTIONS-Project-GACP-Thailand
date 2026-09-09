import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { readEnv } from '@gacp/contracts';

// ข้อมูลส่วนบุคคลที่อ่อนไหว (เลขบัตรประชาชน subject ของผู้ให้บริการยืนยันตัวตน) ไม่เก็บ plaintext
// เข้ารหัส AES-256-GCM สำหรับค่าที่ต้องถอดกลับ (พิมพ์บน กทล.1) และ HMAC-SHA256 สำหรับค่าที่ใช้ค้นหา/เทียบเท่านั้น

const FORMAT_VERSION = 'v1';

function encryptionKey(): Buffer {
  return Buffer.from(readEnv().GACP_DATA_ENCRYPTION_KEY, 'hex');
}

function hmacKey(): Buffer {
  return Buffer.from(readEnv().GACP_DATA_HMAC_KEY, 'hex');
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptField(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== FORMAT_VERSION || !iv || !tag || !ciphertext) {
    throw new RangeError('รูปแบบข้อมูลที่เข้ารหัสไม่ถูกต้อง');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function hmacField(value: string): string {
  return createHmac('sha256', hmacKey()).update(value, 'utf8').digest('hex');
}

// แสดงเลขบัตรบนหน้าจอเฉพาะ 6 หลักท้าย ตามหลักการข้อ 8 (ไม่มี plaintext เต็มบนหน้าจอหรือเอกสารการเงิน)
export function maskNationalId(digits: string): string {
  if (digits.length !== 13) return 'x-xxxx-xxxxx-xx-x';
  const tail = digits.slice(7);
  return `x-xxxx-xx${tail.slice(0, 3)}-${tail.slice(3, 5)}-${tail.slice(5)}`;
}
