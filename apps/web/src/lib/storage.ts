import 'server-only';
import { readEnv } from '@gacp/contracts';
import { createFileStorage, type FileStorage } from '@gacp/storage';

// ที่เก็บไฟล์ตัวเดียวต่อ process เลือก adapter จาก env (local ใน dev/test, s3 ใน demo/staging/production)
const globalForStorage = globalThis as unknown as { gacpFileStorage?: FileStorage };

export const fileStorage: FileStorage =
  globalForStorage.gacpFileStorage ?? createFileStorage(readEnv());

if (process.env.NODE_ENV !== 'production') {
  globalForStorage.gacpFileStorage = fileStorage;
}
