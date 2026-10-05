'use strict';

/**
 * AUTH-01 P1 — IdP adapter seam (evidence/AUTH-01/mandate.md §D1, §D5;
 * evidence/AUTH-01/plan.md P1). RED-first ตาม Law 3.11 —
 * red-output: evidence/AUTH-01/P1/red-output.txt
 *
 * Contract under test:
 *   - factory getIdpAdapter(key) แบบ payment-adapter.js:52-66 — fail-closed:
 *     unknown → AUTH_PROVIDER_UNKNOWN, ไม่ enabled → AUTH_PROVIDER_DISABLED,
 *     config ไม่ครบ → AUTH_PROVIDER_NOT_CONFIGURED, ไม่มี adapter →
 *     AUTH_PROVIDER_NO_ADAPTER
 *   - ProviderIdAdapter ตาม [P-OAUTH] (manual-citations.md) เท่านั้น:
 *     authorize หน้า 3 / token หน้า 4-5 / token exchange หน้า 7-8 /
 *     profile หน้า 9-12 — mock HTTP layer ทั้งหมด ห้ามยิง network จริง
 *
 * เดิมไฟล์นี้มี describe 'MockIdpAdapter fixtures 5 ชุด' + สองเคส factory ของ
 * mock — ถูกลบพร้อม services/auth/idp/mock-idp-adapter.js เมื่อ 2026-08-14
 * (operator สั่งถอน mock IdP ทั้งชั้น; spec design notes
 * 2026-08-14-remove-mock-idp-design.md §2 + เกณฑ์ §3 "เทสพฤติกรรมเฉพาะ mock = ลบ")
 */

const { getIdpAdapter } = require('../../services/auth/idp/idp-adapter');

let envBackup;
let realFetch;

beforeEach(() => {
    envBackup = { ...process.env };
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('AUTH_')) { delete process.env[key]; }
    }
    realFetch = global.fetch;
    global.fetch = jest.fn();
});

afterEach(() => {
    for (const key of Object.keys(process.env)) {
        if (!(key in envBackup)) { delete process.env[key]; }
    }
    Object.assign(process.env, envBackup);
    global.fetch = realFetch;
});

function thrownCode(fn) {
    try { fn(); } catch (err) { return err && err.code; }
    return undefined;
}

async function rejectedCode(promise) {
    try { await promise; } catch (err) { return err && err.code; }
    return undefined;
}

function jsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(payload),
    };
}

// ค่า placeholder ล้วน — ไม่ใช่ credential จริง (B1-CRED)
// สองคู่ credential แยกการลงทะเบียน (audit F1; manual-citations.md:59,78,95):
//   คู่ Health ID = CLIENT_ID+CLIENT_SECRET · คู่ระบบ Provider ID = PID_CLIENT_ID+SECRET_KEY
function setFullProviderIdEnv() {
    process.env.AUTH_PROVIDERID_STATE = 'enabled';
    process.env.AUTH_PROVIDERID_CLIENT_ID = 'test-providerid-client';
    process.env.AUTH_PROVIDERID_CLIENT_SECRET = 'test-providerid-client-secret-value';
    process.env.AUTH_PROVIDERID_REDIRECT_URI = 'https://gacp.example/auth/callback/providerid';
    process.env.AUTH_PROVIDERID_AUTHORIZE_URL = 'https://healthid.example/oauth/redirect';
    process.env.AUTH_PROVIDERID_TOKEN_URL = 'https://healthid.example/api/v1/token';
    process.env.AUTH_PROVIDERID_PROFILE_URL = 'https://providerid.example/api/v1/services/profile';
    process.env.AUTH_PROVIDERID_PID_CLIENT_ID = 'test-providerid-pid-client';
    process.env.AUTH_PROVIDERID_SECRET_KEY = 'test-providerid-secret-key-value';
    process.env.AUTH_PROVIDERID_TOKEN_EXCHANGE_URL = 'https://providerid.example/api/v1/services/token';
}

const HAPPY_LEG1_ENVELOPE = {
    // [P-OAUTH] หน้า 5: envelope {status, data, message}
    status: 200,
    data: {
        access_token: 'healthid-access-token-1',
        token_type: 'Bearer',
        expires_in: 31535998,
        expiration_date: '2027-08-03 00:00:00',
        account_id: 'acc-0001',
    },
    message: 'success',
};

const HAPPY_LEG2_RESPONSE = {
    // [P-OAUTH] หน้า 7-8
    access_token: 'provider-access-token-1',
    token_type: 'Bearer',
    expires_in: 86400,
    expiration_date: '2026-08-04 00:00:00',
    account_id: 'acc-0001',
    result: 'success',
    username: 'officer-test',
    login_by: 'access_token_health_id',
};

describe('getIdpAdapter factory — fail-closed (แบบ payment-adapter seam)', () => {
    test('unknown key → AUTH_PROVIDER_UNKNOWN', () => {
        expect(thrownCode(() => getIdpAdapter('facebook'))).toBe('AUTH_PROVIDER_UNKNOWN');
    });

    test('providerid default (coming_soon) → AUTH_PROVIDER_DISABLED', () => {
        expect(thrownCode(() => getIdpAdapter('providerid'))).toBe('AUTH_PROVIDER_DISABLED');
    });

    test('providerid enabled แต่ config ไม่ครบ → AUTH_PROVIDER_NOT_CONFIGURED', () => {
        process.env.AUTH_PROVIDERID_STATE = 'enabled';
        expect(thrownCode(() => getIdpAdapter('providerid'))).toBe('AUTH_PROVIDER_NOT_CONFIGURED');
    });

    test('providerid enabled + config ครบ → ได้ adapter ครบ contract 3 method', () => {
        setFullProviderIdEnv();
        const adapter = getIdpAdapter('providerid') || {};
        expect(adapter.name).toBe('providerid');
        expect(typeof adapter.getAuthorizeUrl).toBe('function');
        expect(typeof adapter.exchangeCode).toBe('function');
        expect(typeof adapter.getProfile).toBe('function');
    });

    test('local เป็น provider ใน registry แต่ไม่ใช่ OAuth IdP → AUTH_PROVIDER_NO_ADAPTER', () => {
        expect(thrownCode(() => getIdpAdapter('local'))).toBe('AUTH_PROVIDER_NO_ADAPTER');
    });
});

describe('ProviderIdAdapter — [P-OAUTH] ส่วนที่ 1+2 (mock HTTP ทั้งหมด)', () => {
    let adapter;

    beforeEach(() => {
        setFullProviderIdEnv();
        adapter = getIdpAdapter('providerid') || {};
    });

    describe('getAuthorizeUrl — [P-OAUTH] หน้า 3', () => {
        test('สร้าง URL ครบ 4 param: client_id, redirect_uri, response_type=code, state', () => {
            const url = adapter.getAuthorizeUrl
                ? adapter.getAuthorizeUrl({ state: 'random-state-0123456789abcdef' })
                : undefined;
            expect(String(url).startsWith('https://healthid.example/oauth/redirect?')).toBe(true);
            const parsed = new URL(String(url));
            expect(parsed.searchParams.get('client_id')).toBe('test-providerid-client');
            expect(parsed.searchParams.get('redirect_uri')).toBe('https://gacp.example/auth/callback/providerid');
            expect(parsed.searchParams.get('response_type')).toBe('code');
            expect(parsed.searchParams.get('state')).toBe('random-state-0123456789abcdef');
        });

        test('state ส่งเสมอ (mandate §D3) — ไม่ส่ง state = โยน VALIDATION_ERROR', () => {
            expect(thrownCode(() => adapter.getAuthorizeUrl({}))).toBe('VALIDATION_ERROR');
        });
    });

    describe('exchangeCode — happy path 2 ขา', () => {
        test('ขา 1 form-urlencoded ครบ 5 field + ขา 2 JSON token exchange + ผลลัพธ์ตาม contract', async () => {
            global.fetch
                .mockResolvedValueOnce(jsonResponse(200, HAPPY_LEG1_ENVELOPE))
                .mockResolvedValueOnce(jsonResponse(200, HAPPY_LEG2_RESPONSE));

            const res = await adapter.exchangeCode({ code: 'the-auth-code' });

            // ขา 1 — [P-OAUTH] หน้า 4: POST form-urlencoded 5 field
            const [url1, opts1] = global.fetch.mock.calls[0] || [];
            expect(url1).toBe('https://healthid.example/api/v1/token');
            expect(opts1 && opts1.method).toBe('POST');
            const contentType1 = opts1 && opts1.headers
                && (opts1.headers['Content-Type'] || opts1.headers['content-type']);
            expect(contentType1).toBe('application/x-www-form-urlencoded');
            const form = new URLSearchParams(String(opts1 && opts1.body));
            expect(form.get('grant_type')).toBe('authorization_code');
            expect(form.get('code')).toBe('the-auth-code');
            expect(form.get('redirect_uri')).toBe('https://gacp.example/auth/callback/providerid');
            expect(form.get('client_id')).toBe('test-providerid-client');
            expect(form.get('client_secret')).toBe('test-providerid-client-secret-value');
            expect([...form.keys()].sort()).toEqual(
                ['client_id', 'client_secret', 'code', 'grant_type', 'redirect_uri'],
            );

            // ขา 2 — [P-OAUTH] หน้า 7: POST JSON {client_id, secret_key, token_by, token}
            // client_id ขานี้ = "ของระบบ Provider ID" (audit F1; manual-citations.md:78)
            const [url2, opts2] = global.fetch.mock.calls[1] || [];
            expect(url2).toBe('https://providerid.example/api/v1/services/token');
            expect(opts2 && opts2.method).toBe('POST');
            const contentType2 = opts2 && opts2.headers
                && (opts2.headers['Content-Type'] || opts2.headers['content-type']);
            expect(contentType2).toBe('application/json');
            expect(JSON.parse(String(opts2 && opts2.body))).toEqual({
                client_id: 'test-providerid-pid-client',
                secret_key: 'test-providerid-secret-key-value',
                token_by: 'Health ID',
                token: 'healthid-access-token-1',
            });

            // ผลลัพธ์ contract: token ของ Provider ID (ขา 2) คือของที่ใช้ต่อ
            expect(res).toMatchObject({
                accessToken: 'provider-access-token-1',
                tokenType: 'Bearer',
                expiresIn: 86400,
                accountId: 'acc-0001',
            });
        });
    });

    describe('แยก credential สองการลงทะเบียน — audit F1 ([P-OAUTH] หน้า 4 vs หน้า 7/9)', () => {
        test('ขา 1 ใช้คู่ Health ID · ขา 2 + header profile ใช้ pidClientId ของระบบ Provider ID ไม่ใช่ clientId', async () => {
            global.fetch
                .mockResolvedValueOnce(jsonResponse(200, HAPPY_LEG1_ENVELOPE))
                .mockResolvedValueOnce(jsonResponse(200, HAPPY_LEG2_RESPONSE))
                .mockResolvedValueOnce(jsonResponse(200, { account_id: 'acc-0001' }));

            const res = await adapter.exchangeCode({ code: 'the-auth-code' });
            await adapter.getProfile({ accessToken: (res || {}).accessToken });

            // ขา 1 — หน้า 4: client_id คู่ที่ลงทะเบียนกับ Health ID (manual-citations.md:59)
            const [, opts1] = global.fetch.mock.calls[0] || [];
            const form = new URLSearchParams(String(opts1 && opts1.body));
            expect(form.get('client_id')).toBe('test-providerid-client');

            // ขา 2 — หน้า 7: client_id "ของระบบ Provider ID" (manual-citations.md:78,95)
            const [, opts2] = global.fetch.mock.calls[1] || [];
            const leg2Body = JSON.parse(String(opts2 && opts2.body)) || {};
            expect(leg2Body.client_id).toBe('test-providerid-pid-client');
            expect(leg2Body.client_id).not.toBe(form.get('client_id'));

            // header profile — หน้า 9: client-id คู่กับ secret-key ของระบบ Provider ID
            const [, opts3] = global.fetch.mock.calls[2] || [];
            const headers3 = (opts3 && opts3.headers) || {};
            expect(headers3['client-id']).toBe('test-providerid-pid-client');
            expect(headers3['client-id']).not.toBe(form.get('client_id'));
        });
    });

    describe('exchangeCode — error mapping ขา 1 ([P-OAUTH] หน้า 5)', () => {
        test('422 "Access grant has denied" → AUTH_IDP_ACCESS_DENIED', async () => {
            global.fetch.mockResolvedValueOnce(jsonResponse(422, {
                status: 422, data: null, message: 'Access grant has denied',
            }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_ACCESS_DENIED');
        });

        test('422 "Code has been expired" → AUTH_IDP_CODE_EXPIRED', async () => {
            global.fetch.mockResolvedValueOnce(jsonResponse(422, {
                status: 422, data: null, message: 'Code has been expired',
            }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_CODE_EXPIRED');
        });

        test('422 "Code is invalid" → AUTH_IDP_CODE_INVALID', async () => {
            global.fetch.mockResolvedValueOnce(jsonResponse(422, {
                status: 422, data: null, message: 'Code is invalid',
            }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_CODE_INVALID');
        });

        test('401 "Credential is required" → AUTH_IDP_CLIENT_AUTH_FAILED', async () => {
            global.fetch.mockResolvedValueOnce(jsonResponse(401, {
                status: 401, data: null, message: 'Credential is required',
            }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_CLIENT_AUTH_FAILED');
        });

        test('500 → AUTH_IDP_UNAVAILABLE', async () => {
            global.fetch.mockResolvedValueOnce(jsonResponse(500, {
                status: 500, data: null, message: 'Server error',
            }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_UNAVAILABLE');
        });

        test('network ล่ม/timeout → AUTH_IDP_UNAVAILABLE', async () => {
            global.fetch.mockRejectedValueOnce(
                Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
            );
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_UNAVAILABLE');
        });
    });

    describe('exchangeCode — error mapping ขา 2 ([P-OAUTH] หน้า 8)', () => {
        test('400 "This user has not provider id" → AUTH_PROVIDERID_NOT_FOUND (แยกเป็น error ของตัวเอง)', async () => {
            global.fetch
                .mockResolvedValueOnce(jsonResponse(200, HAPPY_LEG1_ENVELOPE))
                .mockResolvedValueOnce(jsonResponse(400, {
                    message: 'This user has not provider id',
                }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_PROVIDERID_NOT_FOUND');
        });

        test('400 "The requested parameter can not used." → AUTH_IDP_EXCHANGE_FAILED', async () => {
            global.fetch
                .mockResolvedValueOnce(jsonResponse(200, HAPPY_LEG1_ENVELOPE))
                .mockResolvedValueOnce(jsonResponse(400, {
                    message: 'The requested parameter can not used.',
                }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_EXCHANGE_FAILED');
        });

        test('401 (client_id+secret_key ผิด) → AUTH_IDP_CLIENT_AUTH_FAILED', async () => {
            global.fetch
                .mockResolvedValueOnce(jsonResponse(200, HAPPY_LEG1_ENVELOPE))
                .mockResolvedValueOnce(jsonResponse(401, {
                    message: 'Authentication is required to access the requested resource.',
                }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_CLIENT_AUTH_FAILED');
        });

        test('500 → AUTH_IDP_UNAVAILABLE (audit F3 pin — [P-OAUTH] หน้า 8 "500")', async () => {
            global.fetch
                .mockResolvedValueOnce(jsonResponse(200, HAPPY_LEG1_ENVELOPE))
                .mockResolvedValueOnce(jsonResponse(500, { message: 'Server error' }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_UNAVAILABLE');
        });
    });

    describe('exchangeCode — envelope ไม่มี access_token (audit F3 pin — pin ไม่ใช่ fix, RED ด้วย mutation)', () => {
        test('ขา 1 envelope ไม่มี data.access_token → AUTH_IDP_EXCHANGE_FAILED', async () => {
            // [P-OAUTH] หน้า 5: envelope {status, data, message} — data ไม่มี access_token
            global.fetch.mockResolvedValueOnce(jsonResponse(200, {
                status: 200, data: { token_type: 'Bearer' }, message: 'success',
            }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_EXCHANGE_FAILED');
        });

        test('ขา 2 response ไม่มี access_token → AUTH_IDP_EXCHANGE_FAILED', async () => {
            // [P-OAUTH] หน้า 7-8: response ควรมี access_token — เคสไม่มี = fail-closed
            global.fetch
                .mockResolvedValueOnce(jsonResponse(200, HAPPY_LEG1_ENVELOPE))
                .mockResolvedValueOnce(jsonResponse(200, {
                    result: 'success', username: 'officer-test',
                }));
            expect(await rejectedCode(adapter.exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_EXCHANGE_FAILED');
        });
    });

    describe('getProfile — [P-OAUTH] หน้า 9-12', () => {
        const PROFILE_PAYLOAD = {
            account_id: 'acc-0001',
            hash_cid: 'a'.repeat(64),
            provider_id: 'PV12345A',
            organization: [{
                business_id: 'biz-01',
                position: 'เจ้าหน้าที่ทดสอบ',
                hcode: '00000',
                hname_th: 'หน่วยงานทดสอบ',
                hname_eng: 'Test Unit',
            }],
        };

        test('GET + headers Authorization Bearer / client-id / secret-key แล้วคืน raw profile เท่านั้น', async () => {
            global.fetch.mockResolvedValueOnce(jsonResponse(200, PROFILE_PAYLOAD));
            const profile = await adapter.getProfile({ accessToken: 'provider-access-token-1' });

            const [url, opts] = global.fetch.mock.calls[0] || [];
            expect(url).toBe('https://providerid.example/api/v1/services/profile');
            expect(opts && opts.method).toBe('GET');
            const headers = (opts && opts.headers) || {};
            expect(headers.Authorization || headers.authorization).toBe('Bearer provider-access-token-1');
            // client-id = คู่ระบบ Provider ID (audit F1; [P-OAUTH] หน้า 9)
            expect(headers['client-id']).toBe('test-providerid-pid-client');
            expect(headers['secret-key']).toBe('test-providerid-secret-key-value');

            // raw เท่านั้น — ห้ามมี linking/augmentation ใด ๆ (ธง D-MANUAL-HASHCID)
            expect(profile).toStrictEqual(PROFILE_PAYLOAD);
        });

        test('401 "access_token is invalid" → AUTH_IDP_TOKEN_INVALID', async () => {
            global.fetch.mockResolvedValueOnce(jsonResponse(401, {
                message: 'access_token is invalid',
            }));
            expect(await rejectedCode(adapter.getProfile({ accessToken: 'x' }))).toBe('AUTH_IDP_TOKEN_INVALID');
        });

        test('404 "This user has no provider id" → AUTH_PROVIDERID_NOT_FOUND', async () => {
            global.fetch.mockResolvedValueOnce(jsonResponse(404, {
                message: 'This user has no provider id',
            }));
            expect(await rejectedCode(adapter.getProfile({ accessToken: 'x' }))).toBe('AUTH_PROVIDERID_NOT_FOUND');
        });

        test('401 client ผิด (non-token message) → AUTH_IDP_CLIENT_AUTH_FAILED (audit F3 pin — หน้า 12)', async () => {
            // [P-OAUTH] หน้า 12 ระบุ 401 "client ผิด" โดยไม่ให้ verbatim message
            // (manual-citations.md:88) — pin ที่ 401 ซึ่ง message ไม่เข้า pattern access_token
            global.fetch.mockResolvedValueOnce(jsonResponse(401, {
                message: 'client is invalid',
            }));
            expect(await rejectedCode(adapter.getProfile({ accessToken: 'x' }))).toBe('AUTH_IDP_CLIENT_AUTH_FAILED');
        });

        test('400 param ขาด → AUTH_IDP_EXCHANGE_FAILED (audit F3 pin — หน้า 12)', async () => {
            // [P-OAUTH] หน้า 12 ระบุ 400 "param ขาด" โดยไม่ให้ verbatim message
            // (manual-citations.md:88) — pin ที่ status 400 ลง fallthrough
            global.fetch.mockResolvedValueOnce(jsonResponse(400, {
                message: 'required parameter is missing',
            }));
            expect(await rejectedCode(adapter.getProfile({ accessToken: 'x' }))).toBe('AUTH_IDP_EXCHANGE_FAILED');
        });

        test('503 → AUTH_IDP_UNAVAILABLE', async () => {
            global.fetch.mockResolvedValueOnce(jsonResponse(503, {
                message: 'Service unavailable',
            }));
            expect(await rejectedCode(adapter.getProfile({ accessToken: 'x' }))).toBe('AUTH_IDP_UNAVAILABLE');
        });
    });
});

describe('error catalog — remediation แยกคู่ credential ตาม F1 (fix cycle 2 F-NEW)', () => {
    test('AUTH_IDP_CLIENT_AUTH_FAILED ชี้ env ถูกขา: leg-1 = คู่ Health ID · leg-2/profile = คู่ระบบ Provider ID', () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        const remediation = String((ERROR_CODES.AUTH_IDP_CLIENT_AUTH_FAILED || {}).remediation);
        // leg-2 401 ([P-OAUTH] p.8) + profile 401 (p.12) เกิดจากคู่ของระบบ Provider ID
        expect(remediation).toContain('AUTH_PROVIDERID_PID_CLIENT_ID');
        expect(remediation).toContain('AUTH_PROVIDERID_SECRET_KEY');
        // leg-1 401 ([P-OAUTH] p.5) เกิดจากคู่ที่ลงทะเบียนกับ Health ID — ต้องสะกดชื่อเต็ม
        expect(remediation).toContain('AUTH_PROVIDERID_CLIENT_ID');
        expect(remediation).toContain('AUTH_PROVIDERID_CLIENT_SECRET');
    });
});
