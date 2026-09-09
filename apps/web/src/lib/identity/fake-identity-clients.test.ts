import { describe, expect, it } from 'vitest';
import { FakeMorphromClient, FakeThaidClient } from './fake-identity-clients.ts';

describe('client ปลอมของผู้ให้บริการยืนยันตัวตน', () => {
  it('FakeMorphromClient ตอบไม่มี Provider ID เมื่อไม่ตั้ง profile', async () => {
    const client = new FakeMorphromClient('acc-1', null);
    expect(await client.lookupProvider()).toEqual({ kind: 'NOT_PROVIDER' });
    expect((await client.exchangeCode()).identity.accountId).toBe('acc-1');
  });

  it('FakeThaidClient ปฏิเสธ state ที่ไม่ตรง และคืน claims เมื่อตรง', async () => {
    const client = new FakeThaidClient({ sub: 'sub-1', pid: '1101700230708', name: 'ทดสอบ ระบบ' });
    const start = await client.startAuthorization('https://app.test/auth/thaid/callback');
    const bad = new URL('https://app.test/auth/thaid/callback?code=x&state=other');
    await expect(
      client.completeAuthorization(bad, {
        state: start.state,
        nonce: start.nonce,
        pkceCodeVerifier: null,
      }),
    ).rejects.toThrow('state ไม่ตรง');
    const good = new URL(`https://app.test/auth/thaid/callback?code=x&state=${start.state}`);
    const claims = await client.completeAuthorization(good, {
      state: start.state,
      nonce: start.nonce,
      pkceCodeVerifier: null,
    });
    expect(claims.pid).toBe('1101700230708');
  });
});
