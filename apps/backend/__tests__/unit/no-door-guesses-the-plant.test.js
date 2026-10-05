'use strict';

/**
 * ไม่มีประตูไหนเดาชนิดพืชให้ผู้ใช้
 *
 * มติ operator 2026-09-12: "ค่าเริ่มต้นต้องไม่ใช่กัญชา ต้องใช้หรือเรียกข้อมูลจากพืชที่ปลูก"
 *
 * ── ทำไมข้อนี้ถึงอันตรายกว่าที่เห็น ────────────────────────────────────────
 *
 * กติกาเอกสาร กทล.1 **ผูกกับชนิดพืช** — หกชนิดหกชุด (ทะเบียน requirement_rules)
 * ประตูที่เติม `'cannabis'` ให้เองเมื่อผู้เรียกไม่ได้บอก จึงไม่ได้ตอบว่า "ไม่รู้"
 * แต่ตอบ **กฎหมายของพืชอีกชนิด** ด้วยหน้าตาที่เหมือนคำตอบจริงทุกประการ
 *
 * ตอนแพลตฟอร์มรับกัญชาชนิดเดียว ค่านี้ถูกเสมอ จึงไม่มีใครเห็น · พอเปิดหกชนิด
 * (2026-09-11) มันกลายเป็นคำตอบผิดที่ไม่ส่งเสียง
 *
 * สามประตูที่พบและแก้ไปแล้ว 2026-09-12:
 *   GET  /applications/config        คืน plantId ตามที่ถูกบอก ไม่มีก็ null
 *   POST /validation/pre-submission  ปฏิเสธ 400 PLANT_NOT_DECLARED
 *   GET  /validation/checklist       ปฏิเสธ 400 PLANT_NOT_DECLARED
 *
 * สองประตูหลังไม่มีผู้เรียกในโค้ดแล้ว แต่ยัง mount อยู่และเปิดสาธารณะ — "ไม่มีใครเรียก"
 * ไม่ใช่เหตุผลที่จะปล่อยให้มันตอบผิด
 *
 * ── ทำไมตรวจด้วยการอ่านไฟล์ ────────────────────────────────────────────────
 *
 * เรียกประตูจริงต้องยกแอปและมี Postgres · เทสที่ต้องใช้ฐานจะไม่ถูกรันทุก commit
 * ซึ่งคือช่องที่ปล่อยให้ค่าเริ่มต้นพวกนี้อยู่มาได้ · ใบนี้จึงอ่านซอร์สของประตูตรง ๆ
 * และตัดคอมเมนต์ออกก่อนตรวจ — คอมเมนต์ที่อธิบายว่าอะไรถูกถอดไปแล้วคือสิ่งที่อยากให้มี
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../..');

/** อ่านเฉพาะโค้ด — เฟนซ์นี้ล่าพฤติกรรม ไม่ใช่ถ้อยคำ */
function codeOf(rel) {
    return fs.readFileSync(path.resolve(BACKEND, rel), 'utf8')
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

/** ทุกไฟล์ใต้ routes/ ที่เป็นประตูจริง */
function routeFiles(dir = path.resolve(BACKEND, 'routes')) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { out.push(...routeFiles(full)); continue; }
        if (entry.name.endsWith('.js')) { out.push(path.relative(BACKEND, full)); }
    }
    return out;
}

describe('ไม่มีประตูไหนเติมชนิดพืชให้เอง', () => {
    const files = routeFiles();

    it('routes/ อ่านเจอและไม่ว่าง — ถ้าว่าง เทสนี้ผ่านโดยไม่ได้ตรวจอะไร', () => {
        expect(files.length).toBeGreaterThan(20);
    });

    /**
     * รูปแบบที่ล่า: `plantType = 'cannabis'` (ค่าเริ่มต้นของพารามิเตอร์) และ
     * `plantId || 'cannabis'` (ตกไปหาค่าเดา) — ทั้งสองคือการตอบแทนผู้ใช้
     */
    it('ไม่มีค่าเริ่มต้นหรือ fallback เป็น cannabis ในประตูใดเลย', () => {
        const offenders = [];
        for (const rel of files) {
            const code = codeOf(rel);
            for (const line of code.split('\n')) {
                if (!/cannabis/i.test(line)) { continue; }
                if (/=\s*['"]cannabis['"]/.test(line) || /\|\|\s*['"]cannabis['"]/.test(line)
                    || /\?\?\s*['"]cannabis['"]/.test(line)) {
                    offenders.push(`${rel}: ${line.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('ไม่มีค่าเริ่มต้นเป็นชนิดอื่นแทนที่ด้วย — ปัญหาคือการเดา ไม่ใช่คำว่ากัญชา', () => {
        const herbs = ['kratom', 'turmeric', 'ginger', 'plai', 'black_galangal'];
        const offenders = [];
        for (const rel of files) {
            for (const line of codeOf(rel).split('\n')) {
                for (const herb of herbs) {
                    const re = new RegExp(`(=\\s*|\\|\\|\\s*|\\?\\?\\s*)['"]${herb}['"]`);
                    if (re.test(line) && /plant/i.test(line)) {
                        offenders.push(`${rel}: ${line.trim()}`);
                    }
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe('ประตูที่เคยเดา ตอบอย่างไรตอนนี้', () => {
    it('/applications/config สะท้อนค่าที่ถูกบอก และคืน null เมื่อไม่ถูกบอก', () => {
        const code = codeOf('routes/api/applications/applications-config.js');
        expect(code).toMatch(/req\.query\.plantId.*\|\|\s*''/);
        expect(code).toContain('|| null');
        expect(code).not.toMatch(/['"]cannabis['"]/);
    });

    it.each([
        ['pre-submission', 'POST'],
        ['checklist', 'GET'],
    ])('/validation/%s ปฏิเสธเมื่อไม่ได้ระบุชนิดพืช', (route) => {
        const code = codeOf('routes/api/applications/validation.js');
        expect(code).toContain('PLANT_NOT_DECLARED');
        expect(code).toContain('ต้องระบุชนิดพืชก่อน');
        void route;
    });

    /**
     * รหัสเดียวกับที่เลนส์เอกสารใช้ปฏิเสธคำขอที่ไม่บอกพืช — คนอ่าน log เจอคำเดียวกัน
     * ไม่ว่าจะมาจากประตูไหน
     */
    it('ใช้รหัสเดียวกับเลนส์เอกสาร ไม่ได้ตั้งคำใหม่', () => {
        const lens = fs.readFileSync(
            path.resolve(BACKEND, 'services/application-requirements-service.js'), 'utf8',
        );
        expect(lens).toContain('PLANT_NOT_DECLARED');
    });
});
