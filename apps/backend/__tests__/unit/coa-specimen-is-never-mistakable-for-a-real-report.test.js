/**
 * COA ตัวอย่าง (มติ operator 2026-09-07) — เอกสารที่แพลตฟอร์มสร้างเองแล้วหน้าตาเหมือน
 * รายงานผลวิเคราะห์ คือเอกสารปลอม เว้นแต่มันบอกตัวเองว่าเป็นตัวอย่าง เทสนี้จึงล็อก
 * สามอย่างที่ห้ามหลุด: ลายน้ำในเทมเพลต · คำว่า (ตัวอย่าง) ในชื่อผู้ออก · การปฏิเสธที่จะ
 * สร้างบนโฮสต์ที่ไม่รู้จัก
 *
 * และล็อกอีกข้อ: ตารางผลไม่ถูกแกะกลับมาเก็บเป็นฟิลด์ — มติ 5 ก.ย. "ไฟล์คือแหล่งความจริงเดียว"
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const svc = require('../../services/pdf/coa-specimen-template-service');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

function guardVerdict(appPublicUrl) {
    const r = spawnSync(process.execPath, ['-e',
        "const s=require('./services/pdf/coa-specimen-template-service');"
        + "try{s.assertNotMinistryProduction();console.log('ALLOW');}catch(e){console.log('REFUSE:'+e.code);}"],
    {
        cwd: BACKEND_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ALLOW_SPECIMEN_COA: '', APP_PUBLIC_URL: appPublicUrl },
    });
    return /ALLOW/.test(r.stdout) ? 'ALLOW' : 'REFUSE';
}

describe('the specimen COA says what it is', () => {
    const template = fs.readFileSync(svc.TEMPLATE_PATH, 'utf-8');

    it('carries the watermark in the template, where data cannot remove it', () => {
        expect(template).toContain('ไม่ใช่รายงานผลการวิเคราะห์จริง');
        expect(template).toContain('class="watermark"');
        // and the footer says it again, for the printed page
        expect(template).toContain('ไม่ใช่รายงานผลจริง');
    });

    it('names an issuer that cannot be read as a real laboratory', () => {
        expect(svc.SPECIMEN_LAB_NAME).toContain('(ตัวอย่าง)');
        expect(svc.SPECIMEN_REPORT_PREFIX).toBe('TR-SPECIMEN-');
    });

    it('never links a font or asset off-host — the renderer allows data: only', () => {
        expect(template).not.toMatch(/https?:\/\//);
    });
});

describe('where a specimen may be minted', () => {
    it.each([
        ['https://demo.gacpth.com', 'ALLOW'],
        ['https://staging.gacpth.com', 'ALLOW'],
        ['http://localhost:3000', 'ALLOW'],
        // the bare domain is the real one — the three-domain split keeps it dark
        ['https://gacpth.com', 'REFUSE'],
        ['https://gacp.dtam.moph.go.th', 'REFUSE'],
        // unreadable address = we do not know which machine this is = refuse
        ['', 'REFUSE'],
    ])('%s → %s', (url, expected) => {
        expect(guardVerdict(url)).toBe(expected);
    });
});

describe('the results table stays inside the document', () => {
    it('renders every group the design lists', () => {
        const html = svc.buildResultRowsHtml();
        for (const group of ['Cannabinoid profile', 'Heavy metals', 'Pesticide residues',
            'Microbiological', 'สารพิษจากเชื้อรา']) {
            expect(html).toContain(group);
        }
    });

    it('does not offer the platform a place to record the values', () => {
        // BatchLabResult has no THC/CBD/moisture columns on purpose; the service must not
        // grow a return shape that tempts a caller to store them.
        const rowSource = fs.readFileSync(
            path.join(BACKEND_ROOT, 'services', 'batch-lab-result-service.js'), 'utf-8',
        );
        for (const field of ['thcContent', 'cbdContent', 'moistureContent']) {
            expect(rowSource).not.toContain(field);
        }
    });
});
