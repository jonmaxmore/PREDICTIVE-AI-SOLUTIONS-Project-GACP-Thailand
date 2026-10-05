/**
 * "ต้องมีเซสชัน" ไม่ใช่ "ต้องเป็นของคุณ"
 *
 * classifyUploadsPath ตัดสินว่า 5 ชนิดเป็นข้อมูลส่วนบุคคล: root / slip / draft /
 * car / audit · gateSensitiveUploads บังคับให้ทั้ง 5 ต้องมีเซสชัน แต่ประตูที่สอง
 * gateSlipObjectAccess ส่งเข้า ACL ระดับวัตถุเพียง 2 ชนิด (application-drafts/,
 * wizard-drafts/ และ slips/ ที่ปลดระวางแล้ว) อีก 3 ชนิดจึงผ่านด้วยเซสชันของ "ใครก็ได้"
 *
 * วัดจริงบนระบบที่รันอยู่ 2026-09-09 ก่อนแก้ (evidence/step4-security/REPORT.md):
 *
 *   GET /uploads/car/secret.txt   ไม่มีโทเคน:401   ผู้ยื่นคนอื่น:200   <- อ่านได้ทั้งไฟล์
 *   GET /uploads/root2.txt        ไม่มีโทเคน:401   ผู้ยื่นคนอื่น:200
 *
 * car/ คือเอกสารที่เกษตรกรยื่นตอบข้อบกพร่องหลังถูกตรวจพบ audits/ คือภาพถ่ายหลักฐาน
 * การตรวจแปลง ทั้งสองไม่มีผู้บริโภคสาธารณะ · authorizeUploadsObject รองรับครบทั้ง 5
 * ชนิดและ fail closed อยู่แล้ว ช่องว่างอยู่ที่การ "ไม่มีใครส่งเข้าไปให้มันตัดสิน"
 *
 * เทสนี้ขับ middleware ตัวจริง ไม่ได้ grep ข้อความในไฟล์ — ถ้าใครหดเงื่อนไขกลับไป
 * เป็นรายชื่อ prefix เทสจะแดงทันที · prisma ถูก mock ที่นี่เพราะสิ่งที่เฝ้าคือ "ประตู
 * ถามเจ้าของหรือไม่" ส่วน "ถามแล้วได้คำตอบถูกไหม" พิสูจน์ด้วยการยิงจริงข้างบน
 */

'use strict';

const mockPrisma = {
    application: { findFirst: jest.fn() },
    attachment: { findFirst: jest.fn() },
    applicationDocument: { findFirst: jest.fn() },
    applicationDraft: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
};

jest.mock('../../services/prisma-database', () => ({ prisma: mockPrisma }));
jest.mock('../../shared/logger', () => {
    const noop = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    return { ...noop, createLogger: () => noop };
});

const { gateSlipObjectAccess, classifyUploadsPath } = require('../../middleware/uploads-access');

/** ผู้ยื่นเจ้าของแฟ้ม */
const OWNER = { id: 'u-owner', canonicalId: '1101700200111', role: 'health', organizationId: 'org-1' };
/** ผู้ยื่นอีกคน — เซสชันถูกต้องทุกประการ แต่ไม่ใช่แฟ้มของเขา */
const STRANGER = { id: 'u-stranger', canonicalId: '1605663442874', role: 'health', organizationId: 'org-1' };

function drive(url, user) {
    const req = { originalUrl: url, user, query: {} };
    const res = {
        statusCode: null, body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    const next = jest.fn();
    return gateSlipObjectAccess(req, res, next).then(() => ({ res, next }));
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.application.findFirst.mockResolvedValue(null);
    mockPrisma.attachment.findFirst.mockResolvedValue(null);
    mockPrisma.applicationDocument.findFirst.mockResolvedValue(null);
    mockPrisma.applicationDraft.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
});

describe('ทุกชนิดที่ถูกจัดว่าเป็นข้อมูลส่วนบุคคล ต้องผ่านการตรวจเจ้าของ', () => {
    const SENSITIVE = [
        ['car/finding-response.pdf', 'car'],
        ['audits/a-1/plot-photo.jpg', 'audit'],
        ['id-card-front.png', 'root'],
        ['application-drafts/x.pdf', 'draft'],
    ];

    it.each(SENSITIVE)('%s ถูกจัดเป็นชนิด %s และเป็นข้อมูลส่วนบุคคล', (rel, kind) => {
        expect(classifyUploadsPath(rel)).toEqual({ kind, sensitive: true });
    });

    it.each(SENSITIVE)('/uploads/%s — คนที่ไม่ใช่เจ้าของไม่ได้ไฟล์', async (rel) => {
        // ไม่มีแถวไหนชี้ว่าไฟล์นี้เป็นของ STRANGER (mock คืน null ทุกตัว)
        const { res, next } = await drive(`/uploads/${rel}`, STRANGER);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
    });
});

describe('เจ้าของยังเปิดแฟ้มของตัวเองได้', () => {
    it('car/ — แฟ้มที่ผูกกับ healthId ของเขา', async () => {
        mockPrisma.application.findFirst.mockResolvedValue({
            healthId: OWNER.canonicalId, organizationId: 'org-1',
        });
        const { res, next } = await drive('/uploads/car/finding-response.pdf', OWNER);
        expect(next).toHaveBeenCalled();
        expect(res.statusCode).toBeNull();
    });

    it('audits/ — ภาพที่เขาเป็นคนอัปโหลด', async () => {
        mockPrisma.attachment.findFirst.mockResolvedValue({
            uploadedBy: OWNER.id, organizationId: 'org-1',
        });
        const { next } = await drive('/uploads/audits/a-1/plot-photo.jpg', OWNER);
        expect(next).toHaveBeenCalled();
    });

    it('ไฟล์ที่ราก — เฉพาะรูปประจำตัวของเขาเอง', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            privacySettings: { avatar: '/uploads/avatar-9.png' },
        });
        const { next } = await drive('/uploads/avatar-9.png', OWNER);
        expect(next).toHaveBeenCalled();
    });

    it('ไฟล์ที่รากของคนอื่น ไม่ได้ แม้จะมีรูปประจำตัวของตัวเองอยู่', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            privacySettings: { avatar: '/uploads/avatar-9.png' },
        });
        const { res, next } = await drive('/uploads/avatar-1.png', STRANGER);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
    });
});

describe('สิ่งที่ตั้งใจให้เปิดสาธารณะ ยังเปิดได้ และไม่ถูกถามฐานข้อมูลเปล่า ๆ', () => {
    it('lab-reports/ ผ่านโดยไม่ต้องมีเซสชัน', async () => {
        const { res, next } = await drive('/uploads/lab-reports/r-1.pdf', null);
        expect(next).toHaveBeenCalled();
        expect(res.statusCode).toBeNull();
        expect(mockPrisma.application.findFirst).not.toHaveBeenCalled();
    });
});

describe('ล้มแบบปิด', () => {
    it('หาเจ้าของไม่เจอ = ปฏิเสธ ไม่ใช่ปล่อยผ่าน', async () => {
        const { res, next } = await drive('/uploads/car/orphan.pdf', OWNER);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(404);
    });

    it('ไม่มีเซสชันเลยกับไฟล์ส่วนบุคคล = 401', async () => {
        const { res, next } = await drive('/uploads/car/finding-response.pdf', null);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('ฐานข้อมูลล่ม ไม่ได้แปลว่าให้ไฟล์', async () => {
        mockPrisma.application.findFirst.mockRejectedValue(new Error('connection refused'));
        const { res, next } = await drive('/uploads/car/finding-response.pdf', OWNER);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(500);
    });

    it('เดินย้อนขึ้นไปจากโฟลเดอร์สาธารณะเข้าหาแฟ้มส่วนบุคคล ถูกปฏิเสธ', async () => {
        const { res, next } = await drive('/uploads/lab-reports/../car/finding-response.pdf', STRANGER);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
    });
});
