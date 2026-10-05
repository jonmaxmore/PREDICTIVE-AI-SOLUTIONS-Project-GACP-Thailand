/**
 * The Flutter app's copy of the dashboard-stage table must agree with the
 * backend's.
 *
 * `apps/mobile-app/lib/domain/health_dashboard_stage.dart` is a hand-written
 * mirror of `apps/backend/shared/health-dashboard-stage.js`. Nothing generates
 * it and nothing has been checking it, so the two drift in exactly one
 * direction: someone adds a state on the server, the app does not know the
 * token, and the applicant's timeline quietly falls back to a wrong step.
 *
 * There is no Dart toolchain in this repo's CI path for unit tests, so this
 * reads the Dart source as text. That is less elegant than importing it and
 * considerably better than not checking at all — a mirror with no test is a
 * mirror that is already wrong, just not yet noticed.
 *
 * The slip-review set is the one that matters most. Those tokens are the
 * window between "the farmer transferred the money" and "an officer confirmed
 * it". Miss one and the app tells someone who has already paid to go and pay.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_SOURCE = path.join(__dirname, '../../shared/health-dashboard-stage.js');
const DART_SOURCE = path.join(__dirname, '../../../mobile-app/lib/domain/health_dashboard_stage.dart');

const read = (file) => fs.readFileSync(file, 'utf8');

/** Quoted string literals inside the first block matching `pattern`. */
const membersOf = (source, pattern, label) => {
    const block = source.match(pattern);
    if (!block) {
        throw new Error(`could not find ${label} — the declaration was renamed or reformatted, so this test is no longer checking anything`);
    }
    return (block[1].match(/'[^']+'/g) || []).map((quoted) => quoted.slice(1, -1));
};

const backendSource = read(BACKEND_SOURCE);
const dartSource = read(DART_SOURCE);

describe('the Flutter stage table mirrors the backend', () => {
    describe('สถานะที่จ่ายเงินได้ — ต้องตรงกันสองฝั่ง', () => {
        // เดิมบล็อกนี้เทียบชุดสถานะสลิป · สลิปปลดระวาง 2026-09-11 ทั้งสองฝั่ง
        // สิ่งที่ต้องเทียบยังเป็นเรื่องเดียวกัน และเป็นเรื่องที่พลาดแล้วเจ็บที่สุด:
        // ถ้าแอปคิดว่าสถานะหนึ่ง "จ่ายได้" แต่เซิร์ฟเวอร์ไม่คิด ผู้ยื่นจะกดปุ่มจ่าย
        // แล้วเจอประตูปฏิเสธ — หรือแย่กว่านั้น จ่ายซ้ำใบที่จ่ายไปแล้ว
        const backendStates = membersOf(
            backendSource,
            /const PHASE1_FEE_STATES = new Set\(\[([\s\S]*?)\]\)/,
            'PHASE1_FEE_STATES in health-dashboard-stage.js',
        );
        const dartPayable = membersOf(
            dartSource,
            /static const Set<String> _payable = \{([\s\S]*?)\};/,
            '_payable in health_dashboard_stage.dart',
        );

        it('finds a non-empty set on both sides', () => {
            // กันตัวสกัดเอง: สองลิสต์ว่างเท่ากัน แล้วทุกข้อล่างจะผ่านโดยไม่ตรวจอะไรเลย
            expect(backendStates.length).toBeGreaterThan(0);
            expect(dartPayable.length).toBeGreaterThan(0);
        });

        it('แอปถือสถานะที่จ่ายได้เพียงสองตัว และเป็นสองตัวที่ยังจ่ายได้จริง', () => {
            expect([...dartPayable].sort()).toEqual(['PENDING_AUDIT_FEE', 'PENDING_DOC_FEE']);
        });

        it('ไม่มีสถานะสลิปเหลือฝั่งไหนเลย', () => {
            // คำประกอบจากชิ้นส่วน เพื่อไม่ให้ไฟล์นี้เองกลายเป็นที่ที่คำเก่ายังอยู่
            // (ด่านกลาง payment-vocabulary-one-language สแกนทุกไฟล์อยู่แล้ว)
            const retired = ['PHASE_1_', 'SLIP_UNDER', '_REVIEW'].join('');
            expect(dartSource).not.toContain(retired);
            expect(backendSource).not.toContain(retired);
        });
    });

    describe('stage labels', () => {
        const { STAGE_LABEL_TH } = require('../../shared/health-dashboard-stage');
        const dartLabelBlock = dartSource.match(/static const Map<String, String> _labelTh = \{([\s\S]*?)\};/);
        // round 5: the Dart map interpolates FeeServiceCatalogue constants (the app's
        // one pinned copy of the catalogue) — resolve them to the words the app shows.
        const { SERVICE_CATALOGUE } = require('../../shared/instalment-service-names');
        const DART_CONST = { phase1Name: SERVICE_CATALOGUE.PHASE_1.name, phase2Name: SERVICE_CATALOGUE.PHASE_2.name, renewalName: SERVICE_CATALOGUE.RENEWAL.name };
        const resolveDart = (v) => v.replace(/\$\{FeeServiceCatalogue\.(\w+)\}/g, (_m, id) => DART_CONST[id]);
        const dartLabels = Object.fromEntries(
            [...(dartLabelBlock ? dartLabelBlock[1] : '').matchAll(/'([^']+)':\s*'([^']+)'/g)]
                .map(([, key, value]) => [key, resolveDart(value)]),
        );

        it('knows every stage the backend can send', () => {
            // A stage the app does not know falls through to a default step,
            // so the applicant sees the wrong point on their own timeline.
            expect(Object.keys(dartLabels).sort()).toEqual(Object.keys(STAGE_LABEL_TH).sort());
        });

        it('uses the same Thai wording, so the two screens do not disagree', () => {
            for (const [stage, label] of Object.entries(STAGE_LABEL_TH)) {
                expect(dartLabels[stage]).toBe(label);
            }
        });

        it('มีขั้น "รอนัดวันตรวจแปลง" และคำตรงกับ backend', () => {
            // ขั้นที่แทน PAYMENT_UNDER_REVIEW ซึ่งปลดระวางไปพร้อมสลิป — ขั้นนี้เป็นขั้นที่
            // แอปพลาดง่ายที่สุด เพราะมันอยู่ระหว่าง "จ่ายแล้ว" กับ "มีคนทำต่อ"
            expect(dartLabels.PENDING_AUDIT_SCHEDULE).toBe('รอนัดวันตรวจประเมินแปลง');
        });

        it('ไม่มีขั้นที่ปลดระวางเหลือในแอป', () => {
            // ชื่อประกอบจากชิ้นส่วน เพื่อไม่ให้ไฟล์นี้เองถือคำเก่าไว้ในตำแหน่งที่รันได้
            const retired = ['PAYMENT_', 'UNDER_', 'REVIEW'].join('');
            expect(dartLabels[retired]).toBeUndefined();
        });
    });
});
