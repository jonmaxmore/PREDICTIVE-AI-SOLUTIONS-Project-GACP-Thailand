import { type Env, FileStorageDriver } from '@gacp/contracts';
import type { FileStorage } from './file-storage.ts';
import { LocalDiskStorage } from './local-disk-storage.ts';
import { S3CompatibleStorage } from './s3-compatible-storage.ts';

// เลือก adapter จาก env ที่ผ่าน envSchema แล้ว (schema บังคับว่า s3 ต้องมีค่าครบ และนอก dev/test ห้าม local)
export function createFileStorage(env: Env): FileStorage {
  if (env.GACP_STORAGE_DRIVER === FileStorageDriver.S3) {
    return new S3CompatibleStorage({
      endpoint: env.GACP_STORAGE_S3_ENDPOINT as string,
      region: env.GACP_STORAGE_S3_REGION as string,
      bucket: env.GACP_STORAGE_S3_BUCKET as string,
      accessKeyId: env.GACP_STORAGE_S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.GACP_STORAGE_S3_SECRET_ACCESS_KEY as string,
    });
  }
  return new LocalDiskStorage(env.GACP_STORAGE_LOCAL_DIR);
}
