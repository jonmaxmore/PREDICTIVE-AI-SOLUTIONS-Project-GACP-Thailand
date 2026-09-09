// biome-ignore-all lint/style/useNamingConvention: fixture คำตอบของ MOPH ใช้ชื่อ field ตามคู่มือ (snake_case)
import { describe, expect, it } from 'vitest';
import { HttpMorphromClient } from './morphrom-client.ts';

const options = {
  healthIdBaseUrl: 'https://uat-moph.id.th',
  healthIdClientId: 'health-client',
  healthIdClientSecret: 'health-secret',
  providerIdBaseUrl: 'https://uat-provider.id.th',
  providerIdClientId: 'provider-client',
  providerIdSecretKey: 'provider-secret',
};

function fakeFetch(
  routes: Record<string, (init: RequestInit | undefined) => Response>,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const handler = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!handler) throw new Error(`ไม่มี route ปลอมสำหรับ ${url}`);
    return handler(init);
  }) as typeof fetch;
}

describe('HttpMorphromClient', () => {
  it('สร้าง URL ล็อกอิน Health ID ตามคู่มือ MOPH', () => {
    const client = new HttpMorphromClient(options, fakeFetch({}));
    const url = client.authorizationUrl('https://app.test/auth/morphrom/callback', 'state-1');
    expect(url.origin + url.pathname).toBe('https://uat-moph.id.th/oauth/redirect');
    expect(url.searchParams.get('client_id')).toBe('health-client');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/auth/morphrom/callback');
  });

  it('แลก code เป็น access token และ account_id (ส่ง client_secret ใน body ไม่ใช่ URL)', async () => {
    let tokenRequestBody = '';
    const client = new HttpMorphromClient(
      options,
      fakeFetch({
        'https://uat-moph.id.th/api/v1/token': (init) => {
          tokenRequestBody = String(init?.body);
          return Response.json({
            status: 'success',
            data: {
              access_token: 'health-token',
              token_type: 'Bearer',
              expires_in: 100,
              account_id: '1659',
            },
          });
        },
      }),
    );
    const result = await client.exchangeCode('code-1', 'https://app.test/auth/morphrom/callback');
    expect(result.accessToken).toBe('health-token');
    expect(result.identity.accountId).toBe('1659');
    const sent = new URLSearchParams(tokenRequestBody);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('code-1');
    expect(sent.get('client_secret')).toBe('health-secret');
  });

  it('ไม่มี Provider ID เมื่อ MOPH ตอบ 400', async () => {
    const client = new HttpMorphromClient(
      options,
      fakeFetch({
        'https://uat-provider.id.th/api/v1/services/token': () =>
          Response.json({ status: 400, message: 'This user has not provider id' }, { status: 400 }),
      }),
    );
    expect(await client.lookupProvider('health-token')).toEqual({ kind: 'NOT_PROVIDER' });
  });

  it('MOPH ล่ม (500) → โยน error ไม่ใช่ตอบว่าไม่มี Provider ID', async () => {
    const client = new HttpMorphromClient(
      options,
      fakeFetch({
        'https://uat-provider.id.th/api/v1/services/token': () =>
          Response.json({ status: 500 }, { status: 500 }),
      }),
    );
    await expect(client.lookupProvider('health-token')).rejects.toThrow('500');
  });

  it('มี Provider ID: อ่าน profile และ normalize สังกัด', async () => {
    const client = new HttpMorphromClient(
      options,
      fakeFetch({
        'https://uat-provider.id.th/api/v1/services/token': () =>
          Response.json({
            status: 200,
            data: { access_token: 'provider-token', account_id: '1659' },
          }),
        'https://uat-provider.id.th/api/v1/services/profile': () =>
          Response.json({
            status: 200,
            data: {
              account_id: '1659',
              hash_cid: 'abc',
              provider_id: '0111111111X21',
              name_th: 'หมอพร้อม สงบสุข',
              // glossary-allow field ของ MOPH
              organization: [
                {
                  business_id: '9876',
                  hcode: '12345',
                  hname_th: 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
                  position: 'นักวิชาการ',
                  position_type: 'นักวิชาการ',
                  license_id: null,
                },
              ],
            },
          }),
      }),
    );
    const result = await client.lookupProvider('health-token');
    expect(result.kind).toBe('PROVIDER');
    if (result.kind !== 'PROVIDER') return;
    expect(result.profile.providerId).toBe('0111111111X21');
    expect(result.profile.hashCid).toBe('abc');
    expect(result.profile.affiliations[0]).toEqual({
      businessId: '9876',
      agencyCode: '12345',
      agencyNameTh: 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
      position: 'นักวิชาการ',
      positionType: 'นักวิชาการ',
      licenseId: null,
    });
  });
});
