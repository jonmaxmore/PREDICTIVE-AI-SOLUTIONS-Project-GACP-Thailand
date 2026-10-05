/**
 * openapi-example-credentials.test.js
 *
 * ตัวอย่างใน API spec ต้องดู "ปลอม" ให้เครื่องด้วย ไม่ใช่ปลอมเฉพาะกับคน
 *
 * `openapi/authentication-service.yaml` และ `openapi/README.md` เขียนตัวอย่าง
 * token ไว้เป็น `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...` ซึ่งคนอ่านรู้ทันทีว่า
 * เป็นตัวอย่าง แต่ `eyJ` คือ base64url ของ `{"` — มันคือส่วนหัวจริงของ JWS
 * ทุกใบในโลก เครื่องสแกน secret (TruffleHog ใน job `Secret Scanning`,
 * gitleaks ใน probe `no-secret`) จับรูปนี้ ไม่ได้จับความหมาย
 *
 * ผลคือ noise ที่ต้นทาง: ทุกครั้งที่สแกนเนอร์ชี้มาที่ไฟล์สเปก คนต้องเปิดอ่านเพื่อ
 * ตัดสินว่า "อันนี้ของปลอม" ซ้ำอีกรอบ — และ **ต้นทุนนั้นเองคือความเสี่ยง**
 * เพราะวันที่มีของจริงหลุดเข้ามาปนในกองเดียวกัน คนที่ชินกับการปัดตกจะปัดตกมันด้วย
 *
 * ทางแก้ที่ถูกคือทำให้ตัวอย่าง **ไม่ match** ตั้งแต่แรก: `<ACCESS_TOKEN>` อ่านง่าย
 * กว่าเดิมสำหรับคน และไม่มีสแกนเนอร์ตัวไหนสนใจ
 *
 * ไฟล์นี้ตรึงข้อตกลงนั้นไว้ ไม่ใช่ตรึงว่า "วันนี้ไฟล์สองไฟล์นั้นสะอาด" —
 * มันถาม `git ls-files` ทุกครั้งที่รัน ไฟล์สเปกใหม่จึงถูกครอบอัตโนมัติ
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

/**
 * รูปของ JWS ที่ serialize แบบ compact: ส่วนหัวเป็น JSON ที่ base64url แล้ว
 * เสมอ จึงขึ้นต้นด้วย `eyJ` ทุกใบ (base64url ของอักขระสองตัวแรก `{"`)
 * ตัวเลข 6 ตัวข้างหลังกันไม่ให้คำภาษาอังกฤษบังเอิญชนสามตัวอักษรนี้
 */
const JWS_COMPACT_HEADER = /eyJ[A-Za-z0-9_-]{6,}/;

/** ไฟล์สเปกและเอกสารประกอบที่รีโปนี้ส่งของจริง */
function shippedSpecFiles() {
    const stdout = execFileSync('git', ['ls-files', '-z', 'openapi', 'docs/api'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.split('\0').filter(Boolean);
}

const SPEC_FILES = shippedSpecFiles();

/**
 * สร้างตัวอย่างที่ "เหมือนจริง" จากนิยามของมันเอง แทนที่จะพิมพ์สตริง `eyJ...`
 * ลงในไฟล์นี้ตรง ๆ — สองเหตุผล: (1) ไฟล์เทสต์ที่มีไว้ห้าม JWT-shaped literal
 * ไม่ควรถือ JWT-shaped literal เสียเอง (2) มันแสดงให้ผู้อ่านเห็นว่าทำไม `eyJ`
 * ถึงเป็นรูปที่ตายตัว: มันคือ base64url ของ `{"` ซึ่งเป็นสองอักขระแรกของ
 * JSON header ทุกใบ
 */
function realisticJwsHeader() {
    return Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
}

describe('positive/negative control ของตัวจับ', () => {
    it('จับส่วนหัว JWS ที่ประกอบขึ้นจากนิยามของมันเอง', () => {
        // ถ้าข้อนี้แดง แปลว่าตัวจับพัง — และข้อล่างจะผ่านฟรีโดยไม่มีใครรู้
        const header = realisticJwsHeader();
        expect(header.startsWith('eyJ')).toBe(true);
        expect(JWS_COMPACT_HEADER.test(`Bearer ${header}.payload.signature`)).toBe(true);
    });

    it('ไม่จับ placeholder ที่ปลอมชัดเจน', () => {
        for (const placeholder of ['<ACCESS_TOKEN>', '<REFRESH_TOKEN>', 'Bearer <ACCESS_TOKEN>']) {
            expect(JWS_COMPACT_HEADER.test(placeholder)).toBe(false);
        }
    });
});

describe('ตัวอย่างใน API spec ไม่หน้าตาเหมือน credential จริง', () => {
    it('sanity: ตัวนับเห็นไฟล์สเปกจริง — ไม่ใช่ลิสต์ว่างที่ทำให้ข้อล่างผ่านฟรี', () => {
        // 2026-08-08 นับได้ 10 ไฟล์ (openapi/ 9 + docs/api/openapi.json)
        expect(SPEC_FILES.length).toBeGreaterThanOrEqual(8);
    });

    it('ไม่มีไฟล์ไหนถือสตริงรูป JWS compact', () => {
        const hits = [];
        for (const relative of SPEC_FILES) {
            const content = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
            content.split('\n').forEach((line, index) => {
                if (JWS_COMPACT_HEADER.test(line)) {
                    hits.push(`${relative}:${index + 1}`);
                }
            });
        }

        expect(hits).toEqual([]);
    });
});
