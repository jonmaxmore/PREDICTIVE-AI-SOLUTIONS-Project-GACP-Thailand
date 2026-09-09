import { z } from 'zod';
import { enumValues } from './enum-values.ts';

export const RuntimeEnvironment = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  DEMO: 'demo',
  STAGING: 'staging',
  PRODUCTION: 'production',
} as const;
export type RuntimeEnvironment = (typeof RuntimeEnvironment)[keyof typeof RuntimeEnvironment];

const booleanFromText = z.enum(['true', 'false']).transform((value) => value === 'true');

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'ต้องเป็น connection string ของ PostgreSQL');

// กุญแจ 32 ไบต์เป็นฐานสิบหก 64 ตัวอักษร (สร้างด้วย node -e "console.log(crypto.randomBytes(32).toString('hex'))")
const hexKey32 = z.string().regex(/^[0-9a-f]{64}$/i, 'ต้องเป็นฐานสิบหก 64 ตัวอักษร (32 ไบต์)');

// ที่เก็บไฟล์: local = ดิสก์ในเครื่อง (dev/test) · s3 = Supabase Storage ผ่าน S3 protocol (demo/staging/production)
export const FileStorageDriver = {
  LOCAL: 'local',
  S3: 's3',
} as const;
export type FileStorageDriver = (typeof FileStorageDriver)[keyof typeof FileStorageDriver];

// ทุกตัวแปรขึ้นต้นด้วย GACP_ และประกาศที่นี่ที่เดียว แอปห้ามอ่าน process.env ตรง ๆ
export const envSchema = z
  .object({
    GACP_ENV: z.enum(enumValues(RuntimeEnvironment)),
    GACP_DATABASE_URL: postgresUrl,
    GACP_DATABASE_DIRECT_URL: postgresUrl,
    GACP_SESSION_SECRET: z.string().min(32, 'ต้องยาวอย่างน้อย 32 ตัวอักษร'),
    // เข้ารหัสและทำ HMAC ข้อมูลส่วนบุคคลที่อ่อนไหว (เลขบัตรประชาชน, subject ของผู้ให้บริการยืนยันตัวตน)
    GACP_DATA_ENCRYPTION_KEY: hexKey32,
    GACP_DATA_HMAC_KEY: hexKey32,
    GACP_STORAGE_DRIVER: z.enum(enumValues(FileStorageDriver)).default(FileStorageDriver.LOCAL),
    GACP_STORAGE_LOCAL_DIR: z.string().min(1).default('.storage'),
    GACP_STORAGE_S3_ENDPOINT: z.url().optional(),
    GACP_STORAGE_S3_REGION: z.string().min(1).optional(),
    GACP_STORAGE_S3_BUCKET: z.string().min(1).optional(),
    GACP_STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    GACP_STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    GACP_AUTH_DEV_LOGIN_ENABLED: booleanFromText.default(false),
    // ผู้ให้บริการยืนยันตัวตน (spec 2026-09-09 §8) บังคับครบใน demo/staging/production
    GACP_PUBLIC_BASE_URL: z.url().optional(),
    GACP_THAID_ISSUER_URL: z.url().optional(),
    GACP_THAID_CLIENT_ID: z.string().min(1).optional(),
    GACP_THAID_CLIENT_SECRET: z.string().min(1).optional(),
    GACP_MORPHROM_HEALTH_ID_BASE_URL: z.url().optional(),
    GACP_MORPHROM_HEALTH_ID_CLIENT_ID: z.string().min(1).optional(),
    GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET: z.string().min(1).optional(),
    GACP_MORPHROM_PROVIDER_ID_BASE_URL: z.url().optional(),
    GACP_MORPHROM_PROVIDER_ID_CLIENT_ID: z.string().min(1).optional(),
    GACP_MORPHROM_PROVIDER_ID_SECRET_KEY: z.string().min(1).optional(),
    GACP_STRIPE_SECRET_KEY: z.string().min(1).optional(),
    GACP_STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, context) => {
    if (env.GACP_ENV === RuntimeEnvironment.PRODUCTION && env.GACP_AUTH_DEV_LOGIN_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['GACP_AUTH_DEV_LOGIN_ENABLED'],
        message: 'ห้ามเปิด login แบบ dev ใน production (หลักการข้อ 5: ThaID + หมอพร้อม เท่านั้น)',
      });
    }
    if (env.GACP_STORAGE_DRIVER === FileStorageDriver.S3) {
      const missing = (
        [
          'GACP_STORAGE_S3_ENDPOINT',
          'GACP_STORAGE_S3_REGION',
          'GACP_STORAGE_S3_BUCKET',
          'GACP_STORAGE_S3_ACCESS_KEY_ID',
          'GACP_STORAGE_S3_SECRET_ACCESS_KEY',
        ] as const
      ).filter((key) => env[key] === undefined);
      for (const key of missing) {
        context.addIssue({ code: 'custom', path: [key], message: 'ต้องกำหนดเมื่อใช้ที่เก็บไฟล์แบบ s3' });
      }
    }
    if (
      env.GACP_ENV !== RuntimeEnvironment.DEVELOPMENT &&
      env.GACP_ENV !== RuntimeEnvironment.TEST &&
      env.GACP_STORAGE_DRIVER === FileStorageDriver.LOCAL
    ) {
      context.addIssue({
        code: 'custom',
        path: ['GACP_STORAGE_DRIVER'],
        message: 'demo/staging/production ต้องใช้ที่เก็บไฟล์แบบ s3 (bucket ส่วนตัว) ไม่ใช่ดิสก์ในเครื่อง',
      });
    }
    if (
      env.GACP_ENV !== RuntimeEnvironment.DEVELOPMENT &&
      env.GACP_ENV !== RuntimeEnvironment.TEST
    ) {
      const missingIdentity = (
        [
          'GACP_PUBLIC_BASE_URL',
          'GACP_THAID_ISSUER_URL',
          'GACP_THAID_CLIENT_ID',
          'GACP_THAID_CLIENT_SECRET',
          'GACP_MORPHROM_HEALTH_ID_BASE_URL',
          'GACP_MORPHROM_HEALTH_ID_CLIENT_ID',
          'GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET',
          'GACP_MORPHROM_PROVIDER_ID_BASE_URL',
          'GACP_MORPHROM_PROVIDER_ID_CLIENT_ID',
          'GACP_MORPHROM_PROVIDER_ID_SECRET_KEY',
        ] as const
      ).filter((key) => env[key] === undefined);
      for (const key of missingIdentity) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message:
            'demo/staging/production ต้องตั้งค่าผู้ให้บริการยืนยันตัวตนให้ครบ (ThaID + Health ID + Provider ID)',
        });
      }
    }
    if (
      env.GACP_ENV === RuntimeEnvironment.PRODUCTION &&
      env.GACP_STRIPE_SECRET_KEY?.startsWith('sk_test_')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['GACP_STRIPE_SECRET_KEY'],
        message: 'production ต้องใช้กุญแจ Stripe แบบ live',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`ตัวแปรสภาพแวดล้อมไม่ถูกต้อง:\n${issues.join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new EnvValidationError(issues);
  }
  return result.data;
}

let cachedEnv: Env | undefined;

// อ่านครั้งเดียวตอนบูต ถ้าไม่ถูกต้องให้ล้มทันที ไม่ปล่อยให้ระบบวิ่งด้วยค่าครึ่ง ๆ กลาง ๆ
export function readEnv(): Env {
  cachedEnv ??= parseEnv(process.env);
  return cachedEnv;
}
