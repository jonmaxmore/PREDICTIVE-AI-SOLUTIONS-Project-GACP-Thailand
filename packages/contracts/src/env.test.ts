import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './env.ts';

const validEnv = {
  GACP_ENV: 'development',
  GACP_DATABASE_URL: 'postgresql://gacp:gacp@127.0.0.1:54329/gacp',
  GACP_DATABASE_DIRECT_URL: 'postgresql://gacp:gacp@127.0.0.1:54329/gacp',
  GACP_SESSION_SECRET: 'a'.repeat(64),
  GACP_AUTH_DEV_LOGIN_ENABLED: 'true',
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

  it('ปฏิเสธ connection string ที่ไม่ใช่ PostgreSQL และ secret ที่สั้น', () => {
    expect(() => parseEnv({ ...validEnv, GACP_DATABASE_URL: 'mysql://x' })).toThrow(
      EnvValidationError,
    );
    expect(() => parseEnv({ ...validEnv, GACP_SESSION_SECRET: 'short' })).toThrow(
      EnvValidationError,
    );
  });
});
