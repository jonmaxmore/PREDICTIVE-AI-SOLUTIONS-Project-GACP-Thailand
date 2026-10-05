'use strict';

/**
 * บัญชีเจ้าหน้าที่ที่ผู้ดูแลสร้าง ต้องเข้าสู่ระบบได้
 *
 * เจอตอนสร้างบัญชี demo ผ่าน UI จริง 2026-09-12 — สร้างสำเร็จทั้ง 6 คน หน้าจอยื่นรหัสให้จด
 * พร้อมคำเตือนว่าแสดงครั้งเดียว แล้ว **ไม่มีใครล็อกอินได้เลยสักคน**
 *
 * พังสองชั้น ซ้อนกัน
 *
 *   ชั้นที่ 1  ประตูสร้างตั้งรหัสสังเคราะห์ `ORG_5BB283` ให้เอง ส่วนประตูล็อกอินบังคับ
 *             /^\d{13}$/ — ปฏิเสธตั้งแต่ยังไม่ได้แตะฐานข้อมูล
 *   ชั้นที่ 2  ต่อให้ใส่เลข 13 หลัก ก็ยังหาไม่เจอ เพราะประตูสร้างไม่เคยเขียนคอลัมน์
 *             `providerIdHash` ที่ล็อกอินใช้ค้น และคอลัมน์ `providerId` แบบข้อความ
 *             ถูกเข้ารหัสตอนเขียน (enc:) ทางสำรองจึงไม่แมตช์เช่นกัน
 *
 * ชั้นที่ 2 คือชั้นที่อันตรายกว่า เพราะมันไม่แสดงอาการตอนกรอกฟอร์ม — คนแก้ชั้นที่ 1
 * อย่างเดียวจะเชื่อว่าซ่อมเสร็จแล้ว
 *
 * มติ operator สำหรับ demo: "account ของ provider ต้องมาจาก admin สร้างให้ โดยใช้
 * หมายเลขบัตรราชการ" · ของจริงบนหมอพร้อมอาจมาจากการอัปเดตผ่าน Health ID ซึ่งยังไม่ยืนยัน
 * จึงไม่ถูกฝังเป็นสมมติฐานไว้ในโค้ดหรือในเทสนี้
 *
 * เทสนี้อ่านไฟล์ของทั้งสองประตูเป็นข้อความ แล้วเทียบกติกาของมันตรง ๆ — เรียกฟังก์ชันจริง
 * ต้องมี Postgres และเทสที่ต้องใช้ฐานจะไม่ถูกรันทุก commit ซึ่งคือกรณีที่ปล่อยให้บั๊กนี้
 * รอดมาได้ตั้งแต่แรก
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../..');
const readRaw = (rel) => fs.readFileSync(path.resolve(BACKEND, rel), 'utf8');

/**
 * อ่านเฉพาะโค้ด ตัดคอมเมนต์ออก
 *
 * เฟนซ์นี้ล่า *พฤติกรรม* ไม่ใช่ถ้อยคำ · คอมเมนต์ที่อธิบายว่า buildProviderId ถูกถอดไปแล้ว
 * และทำไมถึงไม่ตรวจ Mod-11 คือสิ่งที่อยากให้มี ไม่ใช่สิ่งที่อยากให้แดง
 * (ทั้งสองข้อทำให้เทสนี้แดงตอนเขียนจริง ๆ)
 */
const read = (rel) => readRaw(rel)
    .split('\n')
    .filter((line) => {
        const t = line.trim();
        return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

const CREATE_ROUTE = 'routes/api/platform-admin/organizations.js';
const LOGIN_ROUTE = 'routes/api/auth/auth-provider.js';

describe('รหัสที่ประตูสร้างออกให้ ตรงกับที่ประตูล็อกอินรับ', () => {
    const create = read(CREATE_ROUTE);
    const login = read(LOGIN_ROUTE);

    test('ประตูล็อกอินยังบังคับเลข 13 หลัก — ฐานของเทสนี้', () => {
        expect(login).toMatch(/\/\^\\d\{13\}\$\//);
    });

    test('ประตูสร้างบังคับกติกาเดียวกัน ไม่ใช่กติกาของตัวเอง', () => {
        expect(create).toContain('providerId: z.string()');
        expect(create).toMatch(/\/\^\\\\d\{13\}\$\/|\/\^\\d\{13\}\$\//);
    });

    test('ไม่มีตัวสร้างรหัสสังเคราะห์เหลืออยู่', () => {
        expect(create).not.toContain('buildProviderId');
        // รูป `${orgCode}_${suffix}` คือสิ่งที่ประตูล็อกอินปฏิเสธ
        expect(create).not.toMatch(/\$\{orgCode\}_\$\{/);
    });

    /**
     * ชั้นที่ 2 — ชั้นที่เงียบ · ถ้าไม่เขียนคอลัมน์นี้ บัญชีจะ "สร้างสำเร็จ" แต่ค้นไม่เจอ
     */
    test('ประตูสร้างเขียนคอลัมน์ค้นหาที่ล็อกอินใช้', () => {
        expect(create).toContain('providerIdHash');
        expect(create).toMatch(/providerIdHash,/);
    });

    test('คำนวณคอลัมน์นั้นด้วยฟังก์ชันเดียวกับฝั่งอ่าน ไม่คำนวณเอง', () => {
        expect(create).toContain('computeIdentifierHash');
        expect(create).toMatch(/require\('\.\.\/\.\.\/\.\.\/services\/user-lookup-service'\)/);
        // ห้ามคำนวณ sha256 เองที่นี่ — ฝั่งอ่านเลือก SHA-256 หรือ HMAC ด้วยธง
        // การคำนวณเองจะถูกเฉพาะตอนธงปิด แล้วเงียบ ๆ ผิดตอนธงเปิด
        const block = create.slice(create.indexOf('const providerIdHash'), create.indexOf('const providerIdHash') + 200);
        expect(block).not.toContain("createHash('sha256')");
    });

    test('ฝั่งอ่านยังใช้ฟังก์ชันเดียวกันนั้น — ผูกสองฝั่งไว้ด้วยกัน', () => {
        const lookup = read('services/user-lookup-service.js');
        expect(lookup).toContain('function computeIdentifierHash');
        expect(lookup).toMatch(/providerIdHmac.*:.*providerIdHash|useHmacLookup\(\) \? 'providerIdHmac' : 'providerIdHash'/);
    });
});

describe('กติกาที่จงใจไม่ใส่', () => {
    const create = read(CREATE_ROUTE);
    const login = read(LOGIN_ROUTE);

    /**
     * เจ้าหน้าที่ที่ใช้งานอยู่จริงบน demo ทั้งแปดคนมีเลขแบบ 1111111111111 / 9876543210987
     * ซึ่งไม่ผ่าน Mod-11 · ประตูล็อกอินก็ไม่ตรวจ checksum
     *
     * ถ้าประตูสร้างตรวจ ผู้ดูแลจะสร้างบัญชีแบบเดียวกับที่ระบบใช้อยู่ไม่ได้ — กติกาที่เข้ม
     * กว่าประตูที่มันต้องผ่าน ไม่ได้ทำให้ปลอดภัยขึ้น มันแค่ทำให้สร้างไม่ได้
     */
    test('ไม่ตรวจ Mod-11 ทั้งสองประตู — ต้องเข้มเท่ากัน ไม่ใช่เข้มกว่า', () => {
        for (const src of [create, login]) {
            expect(src).not.toMatch(/mod\s*-?\s*11/i);
            expect(src).not.toContain('13 - i');
        }
    });
});
