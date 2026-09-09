import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './env.ts';

const validEnv = {
  GACP_ENV: 'development',
  GACP_DATABASE_URL: 'postgresql://gacp:gacp@127.0.0.1:54329/gacp',
  GACP_DATABASE_DIRECT_URL: 'postgresql://gacp:gacp@127.0.0.1:54329/gacp',
  GACP_SESSION_SECRET: 'a'.repeat(64),
  GACP_DATA_ENCRYPTION_KEY: '0'.repeat(64),
  GACP_DATA_HMAC_KEY: 'f'.repeat(64),
  GACP_AUTH_DEV_LOGIN_ENABLED: 'true',
};

// demo/staging/production ต้องมีผู้ให้บริการยืนยันตัวตนครบ (ค่าสมมติสำหรับ test)
const identityEnv = {
  GACP_PUBLIC_BASE_URL: 'https://demo.example.test',
  GACP_THAID_ISSUER_URL: 'https://imauthsbx.bora.dopa.go.th',
  GACP_THAID_CLIENT_ID: 'thaid-client',
  GACP_THAID_CLIENT_SECRET: 'thaid-secret',
  GACP_MORPHROM_HEALTH_ID_BASE_URL: 'https://uat-moph.id.th',
  GACP_MORPHROM_HEALTH_ID_CLIENT_ID: 'health-client',
  GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET: 'health-secret',
  GACP_MORPHROM_PROVIDER_ID_BASE_URL: 'https://uat-provider.id.th',
  GACP_MORPHROM_PROVIDER_ID_CLIENT_ID: 'provider-client',
  GACP_MORPHROM_PROVIDER_ID_SECRET_KEY: 'provider-secret',
};

describe('parseEnv', () => {
  it('อ่านค่าที่ถูกต้องและแปลง boolean', () => {
    const env = parseEnv(validEnv);
    expect(env.GACP_ENV).toBe('development');
    expect(env.GACP_AUTH_DEV_LOGIN_ENABLED).toBe(true);
  });

  it('ค่าเริ่มต้นของ dev login คือปิด', () => {
    const { GACP_AUTH_DEV_LOGIN_ENABLED: _omitted, ...withoutFlag } = validEnv;
    expect(parseEnv(withoutFlag).GACP_AUTH_DEV_LOGIN_ENABLED).toBe(false);
  });

  it('ปฏิเสธ dev login ใน production', () => {
    expect(() => parseEnv({ ...validEnv, GACP_ENV: 'production' })).toThrow(EnvValidationError);
  });

  it('ปฏิเสธกุญแจ Stripe แบบ test ใน production', () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        GACP_ENV: 'production',
        GACP_AUTH_DEV_LOGIN_ENABLED: 'false',
        GACP_STRIPE_SECRET_KEY: 'sk_test_123',
      }),
    ).toThrow(EnvValidationError);
  });

  it('ที่เก็บไฟล์: ค่าเริ่มต้นเป็น local ใน development, s3 ต้องมีค่าครบ, นอก dev/test ห้าม local', () => {
    expect(parseEnv(validEnv).GACP_STORAGE_DRIVER).toBe('local');
    expect(() => parseEnv({ ...validEnv, GACP_STORAGE_DRIVER: 's3' })).toThrow(EnvValidationError);
    expect(() =>
      parseEnv({
        ...validEnv,
        GACP_ENV: 'demo',
        GACP_AUTH_DEV_LOGIN_ENABLED: 'false',
      }),
    ).toThrow(EnvValidationError);
    const demo = parseEnv({
      ...validEnv,
      ...identityEnv,
      GACP_ENV: 'demo',
      GACP_AUTH_DEV_LOGIN_ENABLED: 'false',
      GACP_STORAGE_DRIVER: 's3',
      GACP_STORAGE_S3_ENDPOINT: 'https://example.supabase.co/storage/v1/s3',
      GACP_STORAGE_S3_REGION: 'ap-southeast-1',
      GACP_STORAGE_S3_BUCKET: 'gacp-documents',
      GACP_STORAGE_S3_ACCESS_KEY_ID: 'key',
      GACP_STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(demo.GACP_STORAGE_DRIVER).toBe('s3');
  });

  it('กุญแจเข้ารหัสข้อมูลต้องเป็นฐานสิบหก 64 ตัวอักษร', () => {
    expect(() => parseEnv({ ...validEnv, GACP_DATA_ENCRYPTION_KEY: 'short' })).toThrow(
      EnvValidationError,
    );
  });

  it('ปฏิเสธ connection string ที่ไม่ใช่ PostgreSQL และ secret ที่สั้น', () => {
    expect(() => parseEnv({ ...validEnv, GACP_DATABASE_URL: 'mysql://x' })).toThrow(
      EnvValidationError,
    );
    expect(() => parseEnv({ ...validEnv, GACP_SESSION_SECRET: 'short' })).toThrow(
      EnvValidationError,
    );
  });
});

describe('ผู้ให้บริการยืนยันตัวตน', () => {
  const s3Env = {
    GACP_STORAGE_DRIVER: 's3',
    GACP_STORAGE_S3_ENDPOINT: 'https://example.supabase.co/storage/v1/s3',
    GACP_STORAGE_S3_REGION: 'ap-southeast-1',
    GACP_STORAGE_S3_BUCKET: 'gacp-documents',
    GACP_STORAGE_S3_ACCESS_KEY_ID: 'key',
    GACP_STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
  };
  it('development ไม่บังคับ client ของ ThaID และหมอพร้อม', () => {
    expect(() => parseEnv({ ...validEnv, GACP_ENV: 'development' })).not.toThrow();
  });

  it('demo บังคับครบทั้ง 10 ตัว', () => {
    expect(() =>
      parseEnv({ ...validEnv, GACP_ENV: 'demo', GACP_AUTH_DEV_LOGIN_ENABLED: 'false', ...s3Env }),
    ).toThrow(/GACP_THAID_CLIENT_ID/);
    expect(() =>
      parseEnv({
        ...validEnv,
        GACP_ENV: 'demo',
        GACP_AUTH_DEV_LOGIN_ENABLED: 'false',
        ...s3Env,
        ...identityEnv,
      }),
    ).not.toThrow();
  });
});
