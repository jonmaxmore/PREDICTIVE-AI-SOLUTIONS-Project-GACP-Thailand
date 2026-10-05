/**
 * เรื่องเงินหนึ่งเรื่อง ต้องมีคำเรียกชุดเดียว — ทั้งบนใบเสร็จ บนจอ และในแอปมือถือ
 *
 * operator 2026-09-11: "ผมอยากให้แมปเป็นชื่อเรียกเดียวกัน จะได้ไม่งง" และสั่งให้เก็บกวาด
 * สถานะสลิปให้หมดด้วย "เพราะไม่อยากให้มีงานมาเรียกผิดอีกในปัจจุบันและอนาคต"
 *
 * ก่อนใบนี้ ระบบพูดสามภาษาเรื่องเดียวกัน วัดได้:
 *   - ใบเสนอราคา/หน้าชำระเงิน  `payment-service.ts:521`  "งวดที่ 1 ค่าบริการตรวจสอบเอกสาร"
 *   - แถบสถานะ                `health-dashboard-stage`   "รอชำระค่าธรรมเนียมขั้นที่ 1"
 *   - แอปมือถือ               `health_dashboard_stage.dart` ใช้ทั้งสองคำ **ในไฟล์เดียวกัน**
 *     (บรรทัด 32 "งวดที่ 1" กับบรรทัด 54 "ขั้นที่ 1")
 * เกษตรกรถือใบเสร็จที่เขียน "งวดที่" แล้วมองจอที่เขียน "ขั้นที่" — กระดาษต้องชนะ
 *
 * และสถานะสลิปสองตัวยังอยู่ในตารางเปลี่ยนสถานะจริง ทั้งที่การจ่ายเป็น Stripe
 * แล้ว webhook ตัดเอง ไม่มีคนตรวจเงิน · จอ "รอตรวจสอบการชำระเงิน" จึงบอกเกษตรกร
 * ว่ามีเจ้าหน้าที่กำลังตรวจเงินเขาอยู่ ซึ่งไม่มีอยู่จริง
 * นับแถวในฐานจริงทั้งสามฐาน 2026-09-11 = 0 ทั้ง status และใน formData ⇒ ลบได้ ไม่ต้องย้ายข้อมูล
 *
 * ไฟล์นี้ไม่ได้ตรึงคำแปลสวย ๆ — มันตรึงสามอย่างที่เคยพังจริง:
 *   1. คำที่ปลดระวางแล้วกลับเข้ามาได้เพราะไม่มีใครห้าม
 *   2. สามก๊อปปี้ของตารางเดียวกัน (backend / web / mobile) ดริฟต์ทีละอัน
 *   3. สถานะที่บอกว่ามีคนทำงานอยู่ ทั้งที่ไม่มีใครทำ
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');           // apps/
const REPO = path.resolve(ROOT, '..');

const BACKEND_STAGE = path.join(ROOT, 'backend/shared/health-dashboard-stage.js');
const WEB_STAGE = path.join(ROOT, 'web-app/src/lib/health-dashboard-stage.ts');
const DART_STAGE = path.join(ROOT, 'mobile-app/lib/domain/health_dashboard_stage.dart');
const ESLINT_DENYLIST = path.join(ROOT, 'backend/eslint-rules/no-legacy-status-vocabulary.js');

const read = (f) => fs.readFileSync(f, 'utf8');

/** คำที่ปลดระวางแล้ว — ห้ามโผล่ในซอร์สอีก */
const RETIRED_WORDS = Object.freeze([
    'PHASE_1_SLIP_UNDER_REVIEW',
    'PHASE_2_SLIP_UNDER_REVIEW',
    'PAYMENT_UNDER_REVIEW',
]);

/**
 * ที่ที่คำเก่ายังปรากฏได้อย่างถูกต้อง:
 *   - ตัวห้ามเอง (denylist ต้องเอ่ยคำที่มันห้าม)
 *   - migration SQL ที่รันไปแล้ว — ประวัติ ห้ามแก้ย้อน
 *   - ไฟล์นี้
 */
const ALLOWED_TO_NAME_THEM = [
    'backend/eslint-rules/no-legacy-status-vocabulary.js',
    'backend/prisma/migrations/',
    '__tests__/unit/payment-vocabulary-one-language.test.js',
];

/** ไล่ซอร์สจริงทั้งหมด (ไม่รวม node_modules/build) */
function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next'
            || entry.name === 'dist' || entry.name === 'build'
            || entry.name === 'coverage' || entry.name.startsWith('.')) {continue;}
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (/\.(js|jsx|ts|tsx|dart|prisma)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe('คำที่ปลดระวางแล้วต้องหายจากซอร์ส และกลับมาไม่ได้', () => {
    const files = [
        ...walk(path.join(ROOT, 'backend')),
        ...walk(path.join(ROOT, 'web-app/src')),
        ...walk(path.join(ROOT, 'mobile-app/lib')),
    ];

    /**
     * มองหาคำในตำแหน่งที่ **รันได้** เท่านั้น — ค่าที่อยู่ในเครื่องหมายคำพูด
     *
     * หลักเดียวกับ eslint-rules/no-legacy-status-vocabulary.js ที่เขียนไว้เองว่า
     * "คอมเมนต์ที่อธิบายว่าทำไมค่านี้ถูกลบ คือเอกสาร ไม่ใช่การละเมิด" · การห้ามเอ่ยถึง
     * ของเก่าในคำอธิบายจะทำให้เหตุผลหายไปพร้อมกับโค้ด แล้วคนต่อไปจะเพิ่มมันกลับมา
     * โดยไม่รู้ว่าเคยมีและเคยถูกถอดเพราะอะไร
     */
    const literalUse = (source, word) => new RegExp(`['"\`]${word}['"\`]`).test(source);

    it.each(RETIRED_WORDS)('ไม่มี %s เป็นค่าที่รันได้ในซอร์สใด', (word) => {
        const offenders = files
            .filter((f) => !ALLOWED_TO_NAME_THEM.some((ok) => f.includes(ok)))
            .filter((f) => literalUse(read(f), word))
            .map((f) => path.relative(REPO, f));
        expect(offenders).toEqual([]);
    });

    it.each(RETIRED_WORDS)('%s ไม่ถูกอ้างเป็นพร็อพเพอร์ตี้ของตารางใด', (word) => {
        // `STAGE_LABEL_TH.PAYMENT_UNDER_REVIEW` ไม่มีเครื่องหมายคำพูด แต่รันได้
        const offenders = files
            .filter((f) => !ALLOWED_TO_NAME_THEM.some((ok) => f.includes(ok)))
            .filter((f) => new RegExp(`[.\\[]\\s*${word}\\b`).test(read(f)))
            .map((f) => path.relative(REPO, f));
        expect(offenders).toEqual([]);
    });

    it('eslint กันคำทั้งสามไว้ไม่ให้กลับมา — นี่คือเครื่อง ไม่ใช่วินัยคน', () => {
        const denylist = read(ESLINT_DENYLIST);
        const missing = RETIRED_WORDS.filter((w) => !denylist.includes(`'${w}'`));
        expect(missing).toEqual([]);
    });
});

describe('ตารางสถานะสามก๊อปปี้ต้องพูดเหมือนกัน', () => {
    /** โทเคนในบล็อกแรกที่แมตช์ pattern */
    const membersOf = (source, pattern) => {
        const block = source.match(pattern);
        if (!block) {return null;}
        return [...block[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
    };

    const backendStages = membersOf(read(BACKEND_STAGE), /HEALTH_DASHBOARD_STAGES\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
    const webStages = membersOf(read(WEB_STAGE), /HEALTH_DASHBOARD_STAGES\s*=\s*\[([\s\S]*?)\]\s*as const/);
    const dartStages = membersOf(read(DART_STAGE), /labelTh\s*=\s*\{([\s\S]*?)\};/);

    it('backend กับ web ถือรายการเดียวกัน', () => {
        expect(webStages).not.toBeNull();
        expect([...(backendStages || [])].sort()).toEqual([...(webStages || [])].sort());
    });

    it('mobile ถือรายการเดียวกัน', () => {
        expect(dartStages).not.toBeNull();
        expect([...(dartStages || [])].sort()).toEqual([...(webStages || [])].sort());
    });

    it('คำไทยของ backend กับ web ตรงกันทุกแถว', () => {
        // round 5: the web spells no catalogue name — it interpolates SERVICE_NAME /
        // SERVICE_NOUN from lib/pricing/fee-services.ts. Resolve those against the
        // catalogue so the comparison is of the words a screen shows.
        const { SERVICE_CATALOGUE } = require('../../shared/instalment-service-names');
        const nounOf = (n) => n.replace(/^งวดที่ \d+ /, '');
        const resolve = (v) => v
            .replace(/\$\{SERVICE_NAME\.(PHASE_1|PHASE_2|RENEWAL)\}/g, (_m, k) => SERVICE_CATALOGUE[k].name)
            .replace(/\$\{SERVICE_NOUN\.(PHASE_1|PHASE_2|RENEWAL)\}/g, (_m, k) => nounOf(SERVICE_CATALOGUE[k].name));
        const labels = (source) => Object.fromEntries(
            [...(source.match(/STAGE_LABEL_TH[^{]*\{([\s\S]*?)\n\}/) || [null, ''])[1]
                .matchAll(/'?([A-Z0-9_]+)'?\s*:\s*['`]([^'`]+)['`]/g)].map((m) => [m[1], resolve(m[2])]),
        );
        expect(labels(read(WEB_STAGE))).toEqual(labels(read(BACKEND_STAGE)));
    });
});

describe('คำไทยบนจอต้องเป็นคำเดียวกับบนใบเสร็จ', () => {
    const backend = read(BACKEND_STAGE);
    const web = read(WEB_STAGE);
    const dart = read(DART_STAGE);

    it.each([['backend', backend], ['web', web], ['mobile', dart]])(
        'ไม่มี "ขั้นที่" เหลือใน %s — ใบเสร็จเขียน "งวดที่"', (_name, source) => {
            expect(source).not.toContain('ขั้นที่');
        },
    );

    it('ทั้งสองงวดเรียกตัวเองด้วย "งวดที่" และบอกว่าจ่ายค่าอะไร', () => {
        const { STAGE_LABEL_TH } = require('../../shared/health-dashboard-stage');
        expect(STAGE_LABEL_TH.PENDING_FEE_PHASE1).toContain('งวดที่ 1');
        expect(STAGE_LABEL_TH.PENDING_FEE_PHASE1).toContain('ตรวจสอบเอกสาร');
        // round 3 (operator 2026-10-03): a renewal shares this stage, and the map has no
        // application — so it names no instalment, only the one service fee. A screen with
        // the application names which (web stageLabelFor).
        expect(STAGE_LABEL_TH.PENDING_FEE_PHASE2).not.toContain('งวดที่');
        expect(STAGE_LABEL_TH.PENDING_FEE_PHASE2).toContain('ค่าบริการ');
        expect(STAGE_LABEL_TH.PENDING_FEE_PHASE2).toContain('ตรวจประเมินแปลง');
    });
});

describe('ป้ายสั้นบนตราสถานะก็ต้องพูดคำเดียวกัน', () => {
    // ตารางนี้เคยเป็น "ภาษาที่ห้า": เรียกงวดที่ 1 ว่า "ค่าธรรมเนียมเอกสาร" งวดที่ 2 ว่า
    // "ค่าตรวจ" และไม่มีเลขงวดเลย · ป้ายสั้นตัดคำอธิบายได้ แต่ตัดชื่อไม่ได้
    const WORKFLOW_STATES_TS = path.join(ROOT, 'web-app/src/lib/constants/workflow-states.ts');
    const labels = () => {
        const block = read(WORKFLOW_STATES_TS).match(/STATUS_LABELS[^{]*\{([\s\S]*?)\n\};/);
        return Object.fromEntries(
            [...block[1].matchAll(/([A-Z0-9_]+)\s*:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
        );
    };

    it('ทั้งสองงวดมีเลขงวดอยู่ในป้าย', () => {
        const l = labels();
        expect(l.PENDING_DOC_FEE).toContain('งวดที่ 1');
        // round 3: shared with a renewal, so the context-free badge names no instalment
        expect(l.PENDING_AUDIT_FEE).not.toContain('งวดที่');
        expect(l.PENDING_AUDIT_FEE).toContain('ค่าบริการ');
    });

    it('จ่ายงวดที่ 2 แล้วป้ายบอกว่ารออะไร ไม่ใช่บอกแค่ว่าจ่ายแล้ว', () => {
        expect(labels().AUDIT_FEE_PAID).toContain('รอนัด');
    });
});

describe('จ่ายแล้วจอต้องบอกว่าใครถืองานอยู่ ไม่ใช่บอกว่าจ่ายสำเร็จ', () => {
    const { normalizeHealthDashboardStage, STAGE_LABEL_TH } = require('../../shared/health-dashboard-stage');
    const stageOf = (status) => normalizeHealthDashboardStage({ status });

    it('จ่ายงวดที่ 1 แล้ว → อยู่ระหว่างตรวจเอกสาร', () => {
        expect(stageOf('DOC_FEE_PAID')).toBe('UNDER_DOCUMENT_REVIEW');
    });

    it('จ่ายงวดที่ 2 แล้วแต่ยังไม่มีใครนัด → รอนัดวันตรวจแปลง', () => {
        expect(stageOf('AUDIT_FEE_PAID')).toBe('PENDING_AUDIT_SCHEDULE');
        expect(STAGE_LABEL_TH.PENDING_AUDIT_SCHEDULE).toContain('รอนัด');
    });

    it('นัดแล้ว → อยู่ระหว่างตรวจประเมินแปลง (คนละขั้นกับรอนัด)', () => {
        expect(stageOf('AUDIT_CONFIRMED')).toBe('UNDER_FIELD_AUDIT');
        expect(stageOf('AUDIT_FEE_PAID')).not.toBe(stageOf('AUDIT_CONFIRMED'));
    });

    it('ยังไม่จ่ายงวดไหน ก็ยังบอกตามเดิม', () => {
        expect(stageOf('PENDING_DOC_FEE')).toBe('PENDING_FEE_PHASE1');
        expect(stageOf('PENDING_AUDIT_FEE')).toBe('PENDING_FEE_PHASE2');
    });
});

describe('ตารางเปลี่ยนสถานะไม่รู้จักสลิปอีกแล้ว', () => {
    const wf = require('../../services/workflow-transition-service');

    it('สถานะสลิปไม่อยู่ในรายการสถานะที่มีอยู่จริง', () => {
        const states = Array.isArray(wf.WORKFLOW_STATES)
            ? wf.WORKFLOW_STATES
            : Object.values(wf.WORKFLOW_STATES || {});
        expect(states.filter((s) => String(s).includes('SLIP'))).toEqual([]);
    });

    it('ไม่มีทางเดินเข้าสถานะสลิปจากที่ใด', () => {
        expect(wf.canTransition('PENDING_DOC_FEE', 'PHASE_1_SLIP_UNDER_REVIEW')).toBe(false);
        expect(wf.canTransition('PENDING_AUDIT_FEE', 'PHASE_2_SLIP_UNDER_REVIEW')).toBe(false);
    });

    it('ทางที่ใช้จริง (webhook ตัดเงินแล้วเดินต่อ) ยังเปิดอยู่', () => {
        expect(wf.canTransition('PENDING_DOC_FEE', 'DOC_FEE_PAID')).toBe(true);
        expect(wf.canTransition('PENDING_AUDIT_FEE', 'AUDIT_FEE_PAID')).toBe(true);
    });
});
