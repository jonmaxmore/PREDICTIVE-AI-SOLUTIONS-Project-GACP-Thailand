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

// ทุกตัวแปรขึ้นต้นด้วย GACP_ และประกาศที่นี่ที่เดียว แอปห้ามอ่าน process.env ตรง ๆ
export const envSchema = z
  .object({
    GACP_ENV: z.enum(enumValues(RuntimeEnvironment)),
    GACP_DATABASE_URL: postgresUrl,
    GACP_DATABASE_DIRECT_URL: postgresUrl,
    GACP_SESSION_SECRET: z.string().min(32, 'ต้องยาวอย่างน้อย 32 ตัวอักษร'),
    GACP_AUTH_DEV_LOGIN_ENABLED: booleanFromText.default(false),
    GACP_THAID_ISSUER_URL: z.url().optional(),
    GACP_THAID_CLIENT_ID: z.string().min(1).optional(),
    GACP_THAID_CLIENT_SECRET: z.string().min(1).optional(),
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
