/**
 * B6 / กทล.๑ ส่วนที่ ๔ (๓) — "ไม่เปลี่ยนพื้นที่ เมล็ดพันธุ์ หรือส่วนที่ใช้ โดยไม่ยื่นคำขอใหม่"
 *
 * ขั้นที่ 6 ของ wizard เพิ่งเริ่มแสดงข้อความนี้ให้ผู้ยื่นติ๊กรับรอง และแผนเขียนไว้ตรง ๆ ว่า
 * **ห้ามส่งการแสดงผลโดยไม่มีเครื่องบังคับ** — เพราะถ้าแพลตฟอร์มให้คนเซ็นสัญญาข้อหนึ่ง
 * แล้วตัวเองเปิดประตูให้ผิดสัญญานั้นได้ด้วยคำขอธรรมดาสองใบ สิ่งที่เซ็นไปคือกระดาษเปล่า
 *
 * ช่องที่วัดได้จริง (แผน Task 17): สองคำขอที่ผ่านการยืนยันตัวตนตามปกติ
 *   1. `PATCH /api/farms/:id { cultivationMethod: 'INDOOR' }` → 200 · ไม่มีใครถามใบรับรอง
 *   2. `POST /api/farms/:id/plots { solarSystem: 'INDOOR' }` → 201 · ด่านเดียวที่พูดว่า
 *      "certified for" เทียบกับ `farms.cultivationMethod` — คอลัมน์ที่ก้าวแรกเพิ่งย้าย
 * ⇒ ฟาร์มปลูกในโรงเรือนบนใบรับรองกลางแจ้ง และไม่มีอะไรปลายทางมองเห็น
 *
 * เครื่องบังคับอ่านจาก **ใบรับรอง → คำขอต้นทาง** ไม่ใช่จากคอลัมน์ที่ฟาร์มแก้เองได้ — ก้าวที่สอง
 * จึงไปเทียบกับบันทึกที่ก้าวแรกเอื้อมไม่ถึง · และใช้ `tickedAreaTypes` ตัวเดียวกับที่ lens ใช้
 * ไม่ใช่การอ่านลักษณะพื้นที่เป็นครั้งที่สี่
 */
'use strict';

const mockFindCert = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    // ด่านอ่านด้วย findMany ตั้งแต่ 2026-09-11 — ใบล่าสุดใบเดียวเคยทำให้ฟาร์มที่ถือ
    // สองใบถูกปิดกั้นจากขอบข่ายของใบเก่าที่ยังไม่หมดอายุ · mock คืนลิสต์ จาก mockFindCert
    // ตัวเดิม เพื่อให้ทุกเคสข้างล่างยังอ่านเหมือนเดิม
    prisma: {
        certificate: {
            findMany: async (...a) => {
                const one = await mockFindCert(...a);
                return one ? [one] : [];
            },
        },
    },
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});

const {
    certifiedAreaTypes, assertPlotWithinCertifiedScope, assertCultivationMethodUnlocked,
    CERTIFIED_SCOPE_LOCKED, PLOT_OUTSIDE_CERTIFIED_SCOPE,
} = require('../../services/certified-scope');

/** A live certificate whose source application ticked exactly these ลักษณะพื้นที่. */
const certFor = (areaTypes, over = {}) => ({
    id: 'cert-1', certificateNumber: 'GACP-TH-2569-AAAAAA', status: 'active',
    isDeleted: false, expiryDate: new Date('2099-01-01'),
    application: {
        id: 'app-1',
        areaType: 'OUTDOOR',
        formData: { farmData: { areaTypes } },
    },
    ...over,
});

beforeEach(() => { jest.clearAllMocks(); mockFindCert.mockResolvedValue(null); });

describe('what a farm is actually certified for', () => {
    test('comes from the certificate’s own application, not from the farm column', async () => {
        mockFindCert.mockResolvedValue(certFor(['OUTDOOR']));
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(scope.areaTypes).toEqual(['OUTDOOR']);
        expect(scope.certificateNumber).toBe('GACP-TH-2569-AAAAAA');
    });

    test('a filing that ticked two boxes is certified for both', async () => {
        mockFindCert.mockResolvedValue(certFor(['OUTDOOR', 'GREENHOUSE']));
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(scope.areaTypes.sort()).toEqual(['GREENHOUSE', 'OUTDOOR']);
    });

    test('no live certificate means no certified scope — null, not an empty list', async () => {
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(scope.areaTypes).toBeNull();
        expect(scope.certificateNumber).toBeNull();
    });

    test('only a LIVE certificate counts — the query says so, it is not filtered afterwards', async () => {
        await certifiedAreaTypes({ farmId: 'farm-1' });
        const where = mockFindCert.mock.calls[0][0].where;
        expect(where).toMatchObject({ farmId: 'farm-1', isDeleted: false });
        expect(JSON.stringify(where)).toMatch(/revoked/i);
    });
});

describe('the plot door', () => {
    test('refuses a plot outside the certified scope, and names the certificate', async () => {
        mockFindCert.mockResolvedValue(certFor(['OUTDOOR']));
        await expect(assertPlotWithinCertifiedScope({ farmId: 'farm-1', solarSystem: 'INDOOR' }))
            .rejects.toMatchObject({ code: PLOT_OUTSIDE_CERTIFIED_SCOPE, statusCode: 409 });
        try { await assertPlotWithinCertifiedScope({ farmId: 'farm-1', solarSystem: 'INDOOR' }); }
        catch (e) { expect(e.messageTh).toContain('GACP-TH-2569-AAAAAA'); expect(e.messageTh).toMatch(/[ก-๙]/); }
    });

    test('allows a plot inside it', async () => {
        mockFindCert.mockResolvedValue(certFor(['OUTDOOR', 'GREENHOUSE']));
        await expect(assertPlotWithinCertifiedScope({ farmId: 'farm-1', solarSystem: 'GREENHOUSE' }))
            .resolves.toBeUndefined();
    });

    test('before certification it decides nothing — the farm’s own declaration is all there is', async () => {
        await expect(assertPlotWithinCertifiedScope({ farmId: 'farm-1', solarSystem: 'INDOOR' }))
            .resolves.toBeUndefined();
    });

    test('a certificate whose filing ticked อื่น ๆ only does not silently permit everything', async () => {
        mockFindCert.mockResolvedValue(certFor(['OTHER']));
        await expect(assertPlotWithinCertifiedScope({ farmId: 'farm-1', solarSystem: 'INDOOR' }))
            .rejects.toMatchObject({ code: PLOT_OUTSIDE_CERTIFIED_SCOPE });
    });
});

describe('the farm door', () => {
    test('refuses to change cultivationMethod while a certificate is live', async () => {
        mockFindCert.mockResolvedValue(certFor(['OUTDOOR']));
        await expect(assertCultivationMethodUnlocked({
            farmId: 'farm-1', current: 'OUTDOOR', requested: 'INDOOR',
        })).rejects.toMatchObject({ code: CERTIFIED_SCOPE_LOCKED, statusCode: 409 });
    });

    test('the refusal points at the clause’s own answer — file again', async () => {
        mockFindCert.mockResolvedValue(certFor(['OUTDOOR']));
        try {
            await assertCultivationMethodUnlocked({ farmId: 'farm-1', current: 'OUTDOOR', requested: 'INDOOR' });
        } catch (e) {
            expect(e.messageTh).toContain('ยื่นคำขอใหม่');
        }
    });

    test('an unchanged value is not a change — saving the same farm again still works', async () => {
        mockFindCert.mockResolvedValue(certFor(['OUTDOOR']));
        await expect(assertCultivationMethodUnlocked({
            farmId: 'farm-1', current: 'OUTDOOR', requested: 'OUTDOOR',
        })).resolves.toBeUndefined();
    });

    test('locks cultivationMethod ONLY — address and district stay editable, because the revision door reads them', async () => {
        mockFindCert.mockResolvedValue(certFor(['OUTDOOR']));
        // reviseCertificateFromFarm reads province/district/address from the farm as its
        // source of truth (certificate-service.js), so locking those would break the
        // revision door. The guard is handed one field and judges that field alone: a farm
        // save that moves the address while the method stays put must pass.
        await expect(assertCultivationMethodUnlocked({
            farmId: 'farm-1', current: 'OUTDOOR', requested: 'OUTDOOR',
            address: 'ที่อยู่ใหม่', district: 'อำเภอใหม่',
        })).resolves.toBeUndefined();
        // and the farm door hands it nothing else — read the call site, because a guard
        // that CAN judge more is one somebody widens later.
        const src = require('fs').readFileSync(require.resolve('../../services/farm-service.js'), 'utf8');
        const call = src.match(/assertCultivationMethodUnlocked\(\{[\s\S]{0,220}?\}\)/)?.[0] ?? '';
        expect(call).toContain('cultivationMethod');
        for (const other of ['address', 'district', 'province', 'postalCode']) {
            expect(call).not.toContain(`${other}:`);
        }
    });

    test('with no live certificate the farm is free — nothing has been certified yet', async () => {
        await expect(assertCultivationMethodUnlocked({
            farmId: 'farm-1', current: 'OUTDOOR', requested: 'INDOOR',
        })).resolves.toBeUndefined();
    });
});
