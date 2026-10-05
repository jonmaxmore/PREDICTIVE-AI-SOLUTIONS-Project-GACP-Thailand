/**
 * คิวที่ว่างเพราะระบบพัง กับคิวที่ว่างจริง ต้องแยกจากกันได้
 *
 * routes/api/audit/audits.js สองประตูเคยจับ error แล้วตอบแบบนี้:
 *
 *     res.json({ success: true, data: [] });     // /pending-schedule
 *     res.json({ success: true, data: [] });     // /scheduled
 *
 * ฐานข้อมูลล่ม query พัง หรือ schema เพี้ยน — คนจัดคิวอ่านหน้าจอได้ว่า "ไม่มีคิวรอ"
 * แล้วก็ไม่ทำอะไร · ไม่มีอะไรบนหน้าจอบอกว่าคำตอบนั้นไม่ใช่ความจริง และ HTTP 200 กับ
 * success:true ทำให้ทั้ง retry ทั้ง alert ไม่ทำงาน
 *
 * ประตูรายการหลักคนละแบบแต่ป่วยคู่กัน: ตอบ 500 พร้อม data: { audits: [] } ซึ่ง client
 * ที่อ่าน data.audits ก็ยังเห็นคิวว่างอยู่ดี
 *
 * เทสนี้ยังตรึงสิ่งที่แถวหนึ่งของคิวต้องบอก · วัดจริง 2026-09-09 ก่อนแก้ ทุกแถวคืน
 * applicantName: 'N/A' (ค่าคงที่ พร้อมคอมเมนต์ของผู้เขียนเองว่ายังไม่ได้ดึง) ขณะที่
 * ประตูรายละเอียด /api/audits/:id ดึงชื่อมาถูกอยู่แล้ว — ข้อมูลจึงห่างไปแค่ include เดียว
 * และ plantType ถูกป้อนด้วย areaType หน้าจอที่พาดหัวคอลัมน์ว่า "พืช" เลยแสดง OUTDOOR
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/application-service', () => ({
    listAuditQueue: jest.fn(),
    listPendingScheduleAudits: jest.fn(),
    listScheduledAudits: jest.fn(),
    findAuditDetail: jest.fn(),
}));
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = { id: 'u-staff', role: 'scheduler', organizationId: 'org-1' };
        next();
    },
    authenticateHealth: (req, _res, next) => next(),
    authenticateUser: (req, _res, next) => next(),
    authenticateAny: (req, _res, next) => next(),
    requireRole: () => (req, _res, next) => next(),
}));
jest.mock('../../shared/logger', () => {
    const noop = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    return { ...noop, createLogger: () => noop };
});

const applicationService = require('../../services/application-service');

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/audits', require('../../routes/api/audit/audits'));
    return a;
}

const QUEUE_DOORS = [
    ['/api/audits', 'listAuditQueue'],
    ['/api/audits/pending-schedule', 'listPendingScheduleAudits'],
    ['/api/audits/scheduled', 'listScheduledAudits'],
];

beforeEach(() => jest.clearAllMocks());

describe('ความล้มเหลวต้องไม่ปลอมตัวเป็นคิวว่าง', () => {
    it.each(QUEUE_DOORS)('%s เมื่อชั้นข้อมูลพัง', async (path, method) => {
        applicationService[method].mockRejectedValue(new Error('connection refused'));
        const res = await request(app()).get(path);

        expect(res.body.success).not.toBe(true);
        expect(res.status).toBeGreaterThanOrEqual(500);
        // และต้องไม่มีรายการว่างให้ client เข้าใจผิด ไม่ว่าจะรูปไหน
        expect(res.body.data).not.toEqual([]);
        expect(res.body.data?.audits).toBeUndefined();
    });

    it.each(QUEUE_DOORS)('%s คิวที่ว่างจริงยังตอบว่าว่าง', async (path, method) => {
        applicationService[method].mockResolvedValue([]);
        const res = await request(app()).get(path);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, count: 0, data: [] });
    });
});

describe('แถวหนึ่งของคิวบอกได้ว่าเป็นของใคร และเรื่องอะไร', () => {
    const ROW = {
        id: 'a-1',
        applicationNumber: 'APP-2569-TEST-0001',
        status: 'AUDIT_FEE_PAID',
        plantId: 'cannabis',
        areaType: 'OUTDOOR',
        auditorId: null,
        applicant: { firstName: 'สมชาย', lastName: 'ใจดี' },
        entity: null,
        auditor: null,
        formData: {},
    };

    it('ชื่อผู้ยื่นมาจากข้อมูลจริง ไม่ใช่ค่าคงที่', async () => {
        applicationService.listAuditQueue.mockResolvedValue([ROW]);
        const res = await request(app()).get('/api/audits');
        expect(res.body.data[0].applicantName).toBe('สมชาย ใจดี');
    });

    it('นิติบุคคลถือใบรับรองในชื่อของตัวเอง จึงมาก่อนชื่อบุคคล', async () => {
        applicationService.listAuditQueue.mockResolvedValue([
            { ...ROW, entity: { displayName: 'วิสาหกิจชุมชนบ้านสันทราย', type: 'COMMUNITY_ENTERPRISE' } },
        ]);
        const res = await request(app()).get('/api/audits');
        expect(res.body.data[0].applicantName).toBe('วิสาหกิจชุมชนบ้านสันทราย');
    });

    it('ไม่รู้ชื่อ = null ไม่ใช่สตริงที่อ่านเหมือนชื่อ', async () => {
        applicationService.listAuditQueue.mockResolvedValue([{ ...ROW, applicant: null }]);
        const res = await request(app()).get('/api/audits');
        // toMatch โยนทิ้งเมื่อค่าเป็น null จึงยืนยันด้วยการเทียบค่าตรง ๆ
        // ที่ต้องกันคือสตริงอย่าง 'N/A' หรือ 'Unknown' ซึ่งอ่านเหมือนเป็นชื่อ
        expect(res.body.data[0].applicantName).toBeNull();
    });

    it('พืชกับลักษณะพื้นที่เป็นคนละฟิลด์ และไม่มีตัวไหนถูกป้อนด้วยอีกตัว', async () => {
        applicationService.listAuditQueue.mockResolvedValue([ROW]);
        const res = await request(app()).get('/api/audits');
        const row = res.body.data[0];
        expect(row).toMatchObject({ plantId: 'cannabis', areaType: 'OUTDOOR' });
        expect(row.plantType).toBeUndefined();
    });

    it('คำขอที่ยังไม่บอกพืช ไม่ถูกเติมด้วยลักษณะพื้นที่', async () => {
        applicationService.listAuditQueue.mockResolvedValue([{ ...ROW, plantId: null }]);
        const res = await request(app()).get('/api/audits');
        expect(res.body.data[0]).toMatchObject({ plantId: null, areaType: 'OUTDOOR' });
    });
});

describe('ซองคำตอบเหมือนรายการอื่นทั้งระบบ', () => {
    it('data เป็น array ตรง ๆ ไม่ใช่ห่ออีกชั้น', async () => {
        applicationService.listAuditQueue.mockResolvedValue([]);
        const res = await request(app()).get('/api/audits');
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.audits).toBeUndefined();
    });

    it('count ตรงกับจำนวนแถวจริง', async () => {
        applicationService.listAuditQueue.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);
        const res = await request(app()).get('/api/audits');
        expect(res.body.count).toBe(3);
        expect(res.body.data).toHaveLength(3);
    });
});
