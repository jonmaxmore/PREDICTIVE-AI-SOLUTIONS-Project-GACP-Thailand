/**
 * ดรอปดาวน์บทบาทตอนเพิ่มผู้ใช้ ต้องตรงกับบทบาทที่ประตูรับจริง
 *
 * เจอตอนสร้างบัญชี demo ผ่าน UI จริง 2026-09-12: หน้า /admin/organizations เก็บรายการ
 * บทบาทของตัวเอง 5 แถว ทั้งที่ประตูรับ 7 — และหนึ่งในห้าสะกดเป็นตัวพิมพ์ใหญ่
 *
 *   "ผู้ตรวจเอกสาร"        ส่ง DOCUMENT_REVIEWER → z.enum ปฏิเสธ 400 · ปุ่มตาย
 *   "ผู้อนุมัติใบรับรอง"     ไม่มีให้เลือกเลย → ผู้ดูแลแต่งตั้งผู้อนุมัติไม่ได้
 *                          ⇒ คำขอค้างที่ AUDIT_PASSED และไม่มีใครออกใบรับรองได้
 *   "การเงินและบัญชี (กรม)" ไม่มีให้เลือกเลย
 *
 * ทั้งสามอาการเงียบ — ไม่มีเทสไหนแดง เพราะรายการฝั่งจอกับรายการฝั่งประตูไม่เคยถูก
 * เอามาเทียบกัน · ใบนี้เทียบให้ โดย **อ่านไฟล์หลังบ้านเป็นข้อความ** สำนวนเดียวกับ
 * plant-slug-map-covers-the-wizard และ herb-rule-rows
 *
 * ตระกูลเดียวกับบทเรียนตอนเปลี่ยนคำศัพท์บทบาท 2026-09-10: **ค่าเปลี่ยน ไม่ใช่แค่คีย์**
 * — `DOCUMENT_REVIEWER` เคยเป็นค่าที่ถูกจริงในคอลัมน์ฐาน แล้วมันก็ค้างอยู่ตรงนี้
 */
import fs from 'node:fs';
import path from 'node:path';

import {
    ADMIN_ROLE_OPTIONS_FOR_ORG_STAFF,
    ADMIN_ROLE_OPTIONS,
} from '../admin-role-options';

const BACKEND_ROUTE = path.resolve(
    __dirname,
    '../../../../../backend/routes/api/platform-admin/organizations.js',
);

/** บทบาทที่ประตูยอมรับ อ่านจากไฟล์ของประตูเอง ไม่ใช่รายการที่พิมพ์ไว้ในเทส */
function rolesTheDoorAccepts(): string[] {
    const source = fs.readFileSync(BACKEND_ROUTE, 'utf8');
    const block = source.slice(
        source.indexOf('const PROVIDER_ROLES_ALLOWED = ['),
        source.indexOf('];', source.indexOf('const PROVIDER_ROLES_ALLOWED = [')),
    );
    expect(block).not.toBe('');
    return [...block.matchAll(/CANONICAL_ROLES\.([A-Z_]+)/g)]
        .map((m) => m[1].toLowerCase());
}

describe('ดรอปดาวน์ "เพิ่มผู้ใช้ในองค์กร" ตรงกับประตู', () => {
    const accepted = rolesTheDoorAccepts();

    it('ประตูอ่านออกและไม่ว่าง — ถ้าว่าง เทสนี้จะผ่านโดยไม่ได้ตรวจอะไร', () => {
        expect(accepted.length).toBeGreaterThanOrEqual(5);
    });

    it('ทุกบทบาทบนดรอปดาวน์ เป็นบทบาทที่ประตูรับ — ไม่มีปุ่มตาย', () => {
        const offered = ADMIN_ROLE_OPTIONS_FOR_ORG_STAFF.map((o) => o.value);
        expect(offered.filter((v) => !accepted.includes(v))).toEqual([]);
    });

    it('ทุกบทบาทที่ประตูรับ มีให้เลือกบนดรอปดาวน์ — ไม่มีบทบาทที่ตั้งไม่ได้', () => {
        const offered = ADMIN_ROLE_OPTIONS_FOR_ORG_STAFF.map((o) => o.value);
        expect(accepted.filter((v) => !offered.includes(v))).toEqual([]);
    });

    /**
     * แถวนี้คือแถวที่ถ้าหายไป ระบบจะออกใบรับรองไม่ได้เลยทั้งระบบ — ตรึงแยกไว้
     * เพื่อให้ข้อความตอนแดงบอกตรง ๆ ว่าอะไรพัง ไม่ใช่แค่ "สองรายการไม่ตรงกัน"
     */
    it('ผู้อนุมัติใบรับรองต้องเลือกได้ ไม่งั้นไม่มีใครออกใบรับรองได้', () => {
        const approver = ADMIN_ROLE_OPTIONS_FOR_ORG_STAFF
            .find((o) => o.value === 'certificate_approver');
        expect(approver).toBeDefined();
        expect(approver?.label).toBe('ผู้อนุมัติใบรับรอง');
    });

    it('ทุกค่าเป็นตัวพิมพ์เล็กตามคำศัพท์ปัจจุบัน — ไม่มีคำเก่าตัวพิมพ์ใหญ่ค้าง', () => {
        for (const option of ADMIN_ROLE_OPTIONS) {
            expect(option.value).toBe(option.value.toLowerCase());
            expect(option.canonical).toBe(option.value);
        }
    });
});

/**
 * หน้าจอต้องอ่านจาก SSOT ไม่ใช่เก็บรายการของตัวเอง — ตรวจที่ไฟล์ เพราะการเรนเดอร์
 * ดรอปดาวน์ของ Radix ใน jsdom ไม่เปิดรายการออกมาให้อ่านโดยไม่คลิก
 */
describe('หน้าเพิ่มผู้ใช้ไม่เก็บรายการบทบาทของตัวเอง', () => {
    const dialog = fs.readFileSync(
        path.resolve(__dirname, '../../../app/admin/organizations/_components/create-user-dialog.tsx'),
        'utf8',
    );

    it('import รายการจาก admin-role-options', () => {
        expect(dialog).toContain('ADMIN_ROLE_OPTIONS_FOR_ORG_STAFF');
        expect(dialog).toMatch(/from '@\/lib\/constants\/admin-role-options'/);
    });

    it('ไม่มี SelectItem ที่ฝังค่าบทบาทไว้ในไฟล์', () => {
        expect(dialog).not.toMatch(/<SelectItem value="[a-zA-Z_]+">/);
    });
});
