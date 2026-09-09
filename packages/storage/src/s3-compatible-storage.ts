import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  assertSafeStorageKey,
  type FileStorage,
  type StoredObject,
  StoredObjectNotFoundError,
} from './file-storage.ts';

export type S3CompatibleStorageOptions = {
  readonly endpoint: string; // Supabase: https://<project>.supabase.co/storage/v1/s3
  readonly region: string;
  readonly bucket: string; // bucket ส่วนตัวเท่านั้น ไม่มี public URL
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
};

// Supabase Storage (หรือ S3/MinIO ใด ๆ) ผ่าน S3 protocol ไฟล์ทุกไฟล์อยู่ใน bucket ส่วนตัว อ่านผ่านแอปเท่านั้น
export class S3CompatibleStorage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3CompatibleStorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.byteLength,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    assertSafeStorageKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) throw new StoredObjectNotFoundError(key);
      const bytes = await result.Body.transformToByteArray();
      return { bytes, contentType: result.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      if (error instanceof NoSuchKey) throw new StoredObjectNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
