/**
 * third-party-services-scope.test.js (renamed from data-sovereignty-scope.test.js
 * 2026-09-29 — the retired data-residency rule this gate's old name implied is
 * retired for good; what the gate actually does is block a specific,
 * documented list of third-party services. See
 * scripts/ci/check-third-party-services.js's header for the full reasoning.)
 *
 * The gate is only as good as the ground it covers.
 *
 * `check-third-party-services.js` scanned `apps`, `scripts`, `packages` and
 * `.github`, and recognised source extensions only. The nginx configuration
 * that terminates every production request lives in `nginx/` and `deploy/`, in
 * `.conf` files — outside both lists. So the gate reported a clean repository
 * while the live `Content-Security-Policy` header still granted
 * `identitytoolkit.googleapis.com` and `securetoken.googleapis.com`, months
 * after Firebase Auth was removed from the application itself.
 *
 * That is the failure this file exists to prevent: a gate that passes because
 * it is not looking is worse than no gate, because it is quoted as evidence.
 *
 * Two levels of assertion here, deliberately:
 *
 *   - the gate covers the directories and file types that actually reach
 *     production, so the blind spot cannot silently return
 *   - the shipped nginx configuration names no forbidden host, so the specific
 *     leak that was found cannot come back
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const gate = require('../../../../scripts/ci/check-third-party-services');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

/**
 * ═══ ทำไมไฟล์นี้ถูกเขียนใหม่รอบสอง (2026-08-04) ═══════════════════════════
 *
 * รอบแรกไฟล์นี้เกิดจากเคส `.conf` ที่รั่ว แล้วมันตรึงไว้แบบนี้:
 *
 *     expect(gate.SCAN_ROOTS).toEqual(expect.arrayContaining([...]));
 *     expect(gate.SCAN_EXTENSIONS.has('.conf')).toBe(true);
 *
 * นั่นคือ **ตรึงรายชื่อของเมื่อวาน ไม่ได้ derive จากรีโป** มันตอบได้แค่ว่า
 * "ของที่เคยรั่วยังอยู่ในรายการไหม" ตอบไม่ได้เลยว่า "วันนี้รีโปมีชนิดไฟล์อะไร
 * ที่ไม่มีใครดู" ผลคือ `scripts/test/ux-page-score-dashboard.html` ถือลิงก์
 * Google Fonts ไว้บนบรรทัดที่ 4 โดยที่ทั้งเทสต์นี้และ gate เขียวสนิท — `.html`
 * ไม่เคยอยู่ใน SCAN_EXTENSIONS เลยตั้งแต่ gate ถูกสร้าง (6f5dfbb6, 2026-07-25)
 * และ `.html` 14 ไฟล์ในนั้นคือ PDF template ชุดเดียวกับที่เคยมี
 * `@import url('https://fonts.googleapis.com/...')` อยู่จริง
 * (apps/backend/assets/fonts/sarabun/README.md:8-20)
 *
 * รอบนี้จึงเปลี่ยนคำถามจาก "ของที่เคยรั่วยังอยู่ไหม" เป็น
 * **"ชนิดไฟล์ทุกชนิดที่รีโปนี้ส่งของจริง ถูกตัดสินใจแล้วหรือยัง"**
 * derive รายชื่อจาก `git ls-files` ทุกครั้งที่รัน แล้วบังคับว่าทุกชนิดต้องอยู่
 * ฝั่งใดฝั่งหนึ่ง: สแกน (SCAN_EXTENSIONS) หรือ จงใจไม่สแกน (UNSCANNED_FILE_TYPES
 * ซึ่งต้องมีเหตุผลกำกับทีละตัว) · ชนิดไฟล์ใหม่ที่ไม่มีใครจัดประเภท = **แดง**
 * ⇒ ครั้งหน้าที่มีคนเพิ่มนามสกุลใหม่เข้ารีโป เทสต์บังคับให้ตัดสินใจ แทนที่จะเงียบหาย
 */

/**
 * ชนิดไฟล์ที่รีโปส่งของจริงใน SCAN_ROOTS แต่ gate **จงใจไม่สแกน**
 * — คู่ตรงข้ามของ SCAN_EXTENSIONS
 *
 * ทะเบียนนี้คือ **คำสารภาพว่าอะไรอยู่นอกสายตา ไม่ใช่รายการที่ปลอดภัยโดยอัตโนมัติ**
 * (กรอบเดียวกับ UNSCANNED_DIRS ใน identity-provider-naming-collision.test.js:125)
 * รายการที่ขึ้นต้นด้วย `GAP —` คือช่องที่ **ยังปิดไม่ได้จริง** ไม่ใช่ช่องที่ปลอดภัย:
 * วันนี้ยืนยันแล้วว่าไม่มี host ต้องห้ามอยู่ในนั้นสักไฟล์ แต่ถ้าพรุ่งนี้มี gate จะไม่เห็น
 * ทั้งหมดบันทึกไว้ที่ apps/backend/the backlog แล้ว
 *
 * คีย์ = นามสกุล ถ้ามี · ถ้าไม่มีนามสกุลใช้ชื่อไฟล์เอง เพราะ `Dockerfile` และ
 * `CODEOWNERS` ไม่มีนามสกุลให้พูดถึง การยุบทุกตัวเป็น `''` เท่ากับซ่อนมันจากทะเบียน
 * ซึ่งเป็นสิ่งเดียวที่ไฟล์นี้มีไว้เพื่อกัน
 */
const BINARY = 'ไฟล์ไบนารี — ไม่มีข้อความ URL ที่เบราว์เซอร์หรือเซิร์ฟเวอร์จะไปเรียก';

const UNSCANNED_FILE_TYPES = {
    '.sql': 'Prisma migration DDL — สร้าง/แก้ตาราง ไม่มีการเรียกออกนอกเครื่อง',
    '.txt': 'ข้อความนิ่ง (robots.txt, ทะเบียน probe, ผลรันของ agent) — ข้อมูล ไม่ใช่โค้ดที่ fetch',
    '.sh': 'GAP — เชลล์สคริปต์ deploy/backup: `curl` ไปโฮสต์ต่างประเทศจะไม่ถูกจับ ยืนยันแล้วว่าวันนี้ยังไม่มี',
    '.md': 'เอกสาร — ข้อความที่ "อธิบาย" dependency ที่ถอดออกแล้วไม่ใช่ dependency (เหตุผลเดียวกับที่ gate allowlist docs/)',
    '.prisma': 'schema declaration — ประกาศ model/column ไม่มี network client',
    '.woff2': BINARY,
    '.ps1': 'GAP — สคริปต์ PowerShell: เหตุผลเดียวกับ .sh',
    '.ttf': BINARY,
    '.png': BINARY,
    '.css': 'GAP — stylesheet: `@import url(...)` ไปยัง font CDN คือรูปแบบที่เคยรั่วจริงใน PDF template ยืนยันแล้วว่าวันนี้ทั้ง 7 ไฟล์สะอาด',
    '.gitignore': 'รายการไฟล์ที่ git ไม่ติดตาม — ไม่ถูกรันและไม่ถูกส่งให้เบราว์เซอร์',
    '.bat': 'GAP — สคริปต์ Windows: เหตุผลเดียวกับ .sh',
    Dockerfile: 'GAP — หัวไฟล์ของ gate อ้างว่าครอบ Dockerfile แต่ไฟล์ไม่มีนามสกุล walker จึงไม่เคยหยิบขึ้นมาเลย',
    LICENSE: 'สัญญาอนุญาตของฟอนต์ที่ self-host — ข้อความสัญญาล้วน',
    '.gitkeep': 'ไฟล์ว่างสำหรับตรึงโฟลเดอร์ให้ git เห็น',
    '.pdf': BINARY,
    '.template': 'GAP — เทมเพลตที่ render เป็น .conf และ crontab: ตัว .conf ที่ออกมาถูกสแกน แต่เทมเพลตต้นทางไม่ถูก (nginx/bluegreen-upstream.conf.template)',
    '.babelrc': 'ค่าตั้ง Babel — รันตอน build ไม่ใช่ตอน request',
    '.prettierignore': 'รายการไฟล์ที่ formatter ข้าม',
    '.prettierrc': 'ค่าตั้งการจัดรูปแบบโค้ด',
    '.jpg': BINARY,
    '.toml': 'migration_lock.toml — บันทึกว่า migration ใช้ provider อะไร ไม่มี URL',
    '.metadata': 'ไฟล์ที่ Flutter tool ใช้ติดตามเวอร์ชันโปรเจกต์',
    '.lock': 'pubspec.lock — เวอร์ชัน dependency ที่ resolve แล้ว เครื่องเป็นคนเขียน',
    '.dockerignore': 'รายการไฟล์ที่ไม่ส่งเข้า build context',
    'pre-commit': 'GAP — hook ของ husky (เนื้อในเป็นเชลล์): เหตุผลเดียวกับ .sh ปัจจุบันมีบรรทัดเดียวคือ `npm test`',
    '.xml': 'sitemap.xml — รายการ route สาธารณะของเราเอง ไม่มีโฮสต์บุคคลที่สาม',
    '.ico': BINARY,
    '.local': 'fail2ban jail — กติกาแบนไอพีขาเข้า ไม่มีปลายทางขาออก',
    '.traineddata': `${BINARY} (โมเดลภาษา Tesseract ไทย/อังกฤษของ document pre-check — ตรึง sha256 ใน apps/backend/data/tessdata/README.md)`,
};

/**
 * ไฟล์ทุกไฟล์ที่ **รีโปนี้ส่งของจริง** ภายใน SCAN_ROOTS หักโฟลเดอร์ที่ walker ไม่เดินเข้า
 *
 * ใช้ `git ls-files` (ไฟล์ที่ถูก track เท่านั้น) โดยตั้งใจ — คำถามของทะเบียนนี้คือ
 * "รีโปนี้ส่งอะไรออกไป" ไฟล์ชั่วคราวที่ยังไม่ถูก track ในเครื่องใครคนหนึ่งไม่ใช่คำตอบนั้น
 * และวิธีนี้ทำให้ผลเท่ากันทุกเครื่องและบน CI · ถ้าไม่มี git ให้ throw ดัง ๆ ไปเลย
 * ห้ามคืนลิสต์ว่างแล้วผ่านฟรี — นั่นคือความล้มเหลวแบบเดียวกับที่ไฟล์นี้มีไว้เพื่อกัน
 *
 * SKIP_DIRECTORIES อ่านจาก gate ตรง ๆ ไม่ก๊อปมาไว้ที่นี่ มิฉะนั้นกติกาจะมีสองที่แล้ว
 * drift กันพอดีตอนที่มันสำคัญ (the project rules 3.6)
 */
function shippedFilesUnderScanRoots() {
    const stdout = execFileSync('git', ['ls-files', '-z'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });

    return stdout.split('\0').filter(Boolean).filter((relative) => {
        const segments = relative.split('/');
        if (!gate.SCAN_ROOTS.includes(segments[0])) { return false; }
        return !segments.slice(0, -1).some((segment) => gate.SKIP_DIRECTORIES.has(segment));
    });
}

/** ชื่อชนิดไฟล์ตามที่ทะเบียนข้างบนใช้เป็นคีย์ */
function fileTypeKey(relative) {
    const base = path.basename(relative);
    return path.extname(base) || base;
}

/**
 * พื้นจำนวนไฟล์ — กันเคส "ตัวนับพัง" ที่ทำให้ทุก assertion ผ่านแบบว่าง
 * นับจริงเมื่อ 2026-08-04 ได้ 2940 ไฟล์ · ตั้งพื้นราว 82% เพื่อให้ลบไฟล์ตามปกติได้
 */
const MIN_SHIPPED_FILES = 2400;

const SHIPPED = shippedFilesUnderScanRoots();

describe('third-party-services gate — scope', () => {
    it('scans the directories that terminate production traffic', () => {
        // nginx/ and deploy/ hold the configs that set the response headers and
        // proxy every request. Leaving them out is how a foreign host survives
        // a wave that removed it from the application.
        expect(gate.SCAN_ROOTS).toEqual(expect.arrayContaining(['apps', 'scripts', 'packages', '.github']));
        expect(gate.SCAN_ROOTS).toContain('nginx');
        expect(gate.SCAN_ROOTS).toContain('deploy');
    });

    it('recognises nginx configuration files', () => {
        // Adding the directories is not enough: the walker filters by
        // extension, and .conf was not in the set.
        //
        // เก็บไว้เป็น regression pin ของเคสที่เคยรั่วจริง — แต่มันตรึงได้แค่ชื่อที่
        // เขียนไว้ตรงนี้ ชนิดไฟล์ที่ยังไม่มีใครนึกถึงต้องพึ่ง describe ข้างล่าง
        // ('ทุกชนิดไฟล์ที่รีโปส่งของจริงต้องถูกจัดประเภท') ซึ่ง derive จากรีโปทุกครั้งที่รัน
        expect(gate.SCAN_EXTENSIONS.has('.conf')).toBe(true);
    });

    it('finds a forbidden host inside a .conf file', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'third-party-'));
        const file = path.join(dir, 'fixture.conf');
        fs.writeFileSync(file, [
            'server {',
            "    add_header Content-Security-Policy \"connect-src 'self' https://identitytoolkit.googleapis.com\";", // third-party-allow: fixture the gate is required to catch
            '}',
        ].join('\n'));

        const violations = gate.scanFile(file, 'fixture.conf');
        fs.rmSync(dir, { recursive: true, force: true });

        expect(violations).toHaveLength(1);
        expect(violations[0].line).toBe(2);
    });

    it('still treats a commented-out host as harmless', () => {
        // nginx comments start with #. A comment cannot issue a request, and a
        // config must be free to record what was removed and why.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'third-party-'));
        const file = path.join(dir, 'fixture.conf');
        fs.writeFileSync(file, '# identitytoolkit.googleapis.com was removed here\nserver { }\n'); // third-party-allow: fixture proving a commented host is not a violation

        const violations = gate.scanFile(file, 'fixture.conf');
        fs.rmSync(dir, { recursive: true, force: true });

        expect(violations).toEqual([]);
    });
});

describe('the shipped nginx configuration', () => {
    const configs = [
        'nginx/gacp.production.conf',
        'deploy/nginx/gacp-platform.conf',
    ];

    it.each(configs)('%s names no forbidden foreign service', (relative) => {
        const absolute = path.join(REPO_ROOT, relative);
        if (!fs.existsSync(absolute)) {return;}
        expect(gate.scanFile(absolute, relative)).toEqual([]);
    });

    it.each(configs)('%s does not permit Google identity endpoints in its CSP', (relative) => {
        // The specific leak: Firebase Auth was removed from the application,
        // but nginx kept granting connect-src to Google's identity hosts, so
        // the browser policy on every production response still allowed them.
        const absolute = path.join(REPO_ROOT, relative);
        if (!fs.existsSync(absolute)) {return;}
        const live = fs.readFileSync(absolute, 'utf8')
            .split('\n')
            .filter((line) => !line.trim().startsWith('#'))
            .join('\n');
        expect(live).not.toMatch(/identitytoolkit\.googleapis\.com/); // third-party-allow: asserting absence
        expect(live).not.toMatch(/securetoken\.googleapis\.com/); // third-party-allow: asserting absence
    });
});

describe('ทุกชนิดไฟล์ที่รีโปส่งของจริงต้องถูกจัดประเภท (derive จาก git ls-files)', () => {
    it('sanity: ตัวนับเห็นไฟล์จริง — ไม่ใช่ลิสต์ว่างที่ทำให้ทุกข้อข้างล่างผ่านฟรี', () => {
        expect(SHIPPED.length).toBeGreaterThanOrEqual(MIN_SHIPPED_FILES);
    });

    it('ไม่มีชนิดไฟล์ไหนหลุดออกนอกทั้งสองทะเบียน', () => {
        // นี่คือข้อที่ `.html` ควรทำให้แดงตั้งแต่วันที่มันเข้ารีโป แต่ไม่แดง เพราะเทสต์
        // รอบก่อนตรึงรายชื่อของเมื่อวานแทนที่จะถามรีโปว่าวันนี้มีอะไรอยู่บ้าง
        const unclassified = [...new Set(
            SHIPPED
                .filter((relative) => !gate.isScannableFile(path.basename(relative)))
                .map(fileTypeKey)
                .filter((key) => !(key in UNSCANNED_FILE_TYPES)),
        )].sort();

        expect(unclassified).toEqual([]);
    });

    it('ทะเบียน "จงใจไม่สแกน" ไม่ขัดกับของที่สแกนจริง', () => {
        // ชนิดไฟล์หนึ่งจะอยู่สองฝั่งพร้อมกันไม่ได้ — ถ้าเกิดขึ้นแปลว่ามีคนเพิ่มเข้า
        // SCAN_EXTENSIONS โดยลืมถอนคำสารภาพออก แล้วทะเบียนจะเริ่มโกหก
        const contradictory = Object.keys(UNSCANNED_FILE_TYPES)
            .filter((key) => gate.isScannableFile(key.startsWith('.') ? `file${key}` : key));

        expect(contradictory).toEqual([]);
    });

    it('ทะเบียนไม่มีรายการตายค้าง — ทุกคีย์ต้องมีไฟล์จริงในรีโป', () => {
        // กันการ dump รายชื่อนามสกุลเผื่อไว้ล่วงหน้า ทะเบียนต้องอธิบาย "รีโปนี้"
        // ไม่ใช่ "นามสกุลที่โลกนี้มี" — รายการที่ไม่มีไฟล์รองรับคือรายการที่ไม่มีใครตรวจ
        const present = new Set(SHIPPED.map(fileTypeKey));
        const dead = Object.keys(UNSCANNED_FILE_TYPES).filter((key) => !present.has(key));

        expect(dead).toEqual([]);
    });

    it('ทุกรายการในทะเบียนมีเหตุผลกำกับจริง ไม่ใช่ช่องว่าง', () => {
        const withoutReason = Object.entries(UNSCANNED_FILE_TYPES)
            .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 20)
            .map(([key]) => key);

        expect(withoutReason).toEqual([]);
    });
});

describe('gate จับ Firebase ที่ไม่ได้สะกดเป็นชื่อโดเมน', () => { // third-party-allow: the gate is required to name the service it forbids
    /**
     * ═══ ทำไมต้องมี describe นี้ (2026-08-08) ═══════════════════════════════
     *
     * รายการต้องห้ามของ Firebase สะกดไว้เป็น **ชื่อโฮสต์** ล้วน
     * (`identitytoolkit.googleapis.com`, `securetoken.googleapis.com`,
     * `firebaseio.com`, `firebaseapp.com`) บวก `firebase-admin` หนึ่งตัว
     *
     * แต่รูปที่โค้ดจริงเรียก Firebase ไม่ใช่ชื่อโฮสต์ — SDK ฝั่ง client เขียนว่า
     * `import { initializeApp } from 'firebase/app'` และ transitive package
     * ของมันคือ scope `@firebase/*` ชื่อโฮสต์เป็นสิ่งที่ SDK ไปเรียกทีหลัง
     * ตอน runtime ไม่ใช่สิ่งที่ปรากฏใน source · gate จึงมองไม่เห็นการ **ผูก**
     * Firebase เข้ามาใหม่ เห็นแค่ตอนมีคนพิมพ์ URL ตรง ๆ ซึ่งแทบไม่มีใครทำ
     *
     * ของจริงที่รอดมาได้ด้วยช่องนี้: `apps/web-app/jest.config.mjs:39-41`
     * ถือ `transformIgnorePatterns: ['/node_modules/(?!(?:firebase|@firebase)/)']`
     * ค้างอยู่หลัง SDK ถูกถอดออกไปแล้ว (e451fd04) — บรรทัดโค้ดเป็น ไม่ใช่คอมเมนต์
     * และ gate รายงานรีโปสะอาดทุกครั้ง
     */
    function withTempDir(run) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'third-party-fb-'));
        try {
            return run(dir);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    it('จับ import จากแพ็กเกจ firebase (รูปที่โค้ดจริงใช้ ไม่ใช่ชื่อโฮสต์)', () => { // third-party-allow: test name states the package the gate must catch
        const violations = withTempDir((dir) => {
            const file = path.join(dir, 'client.ts');
            fs.writeFileSync(file, [
                "import { initializeApp } from 'firebase/app';", // third-party-allow: fixture the gate is required to catch
                'export const app = initializeApp({});',
            ].join('\n'));
            return gate.scanFile(file, 'client.ts');
        });

        expect(violations).toHaveLength(1);
        expect(violations[0].line).toBe(1);
        expect(violations[0].service).toBe('Firebase / Google Identity'); // third-party-allow: asserts which rule fired
    });

    it('จับ scope @firebase ในค่าตั้งของ runner', () => { // third-party-allow: test name states the scope the gate must catch
        // รูปที่ jest.config.mjs ถืออยู่จริง — เป็นค่าตั้ง ไม่ใช่ import
        // แต่มันคือคำสั่งให้ runner เตรียมทางให้ SDK โหลดได้ ซึ่งมีค่าเท่ากับ
        // การประกาศว่าแพ็กเกจนี้ยังอยู่ในระบบ
        const violations = withTempDir((dir) => {
            const file = path.join(dir, 'jest.config.mjs');
            fs.writeFileSync(file, [
                'export default {',
                "    transformIgnorePatterns: ['/node_modules/(?!(?:firebase|@firebase)/)'],", // third-party-allow: fixture the gate is required to catch
                '};',
            ].join('\n'));
            return gate.scanFile(file, 'jest.config.mjs');
        });

        expect(violations).toHaveLength(1);
        expect(violations[0].line).toBe(2);
    });

    it('negative control — คอมเมนต์ tombstone ที่เล่าว่า Firebase ถูกถอดออก ยังไม่ผิด', () => { // third-party-allow: test name — proves a tombstone comment stays legal
        // ทั้ง auth-health.js:62-66, auth-provider.js:293-297, middleware.ts:100-104
        // และ build-images.yml:151 ถือคอมเมนต์แบบนี้ไว้เป็นความจำของระบบ ว่า
        // ห้ามเอา IdP ต่างประเทศกลับเข้ามา · การขยายรายการต้องห้ามให้เข้มขึ้น
        // ต้องไม่แปลว่าความจำนั้นกลายเป็นความผิด
        const violations = withTempDir((dir) => {
            const file = path.join(dir, 'auth.js');
            fs.writeFileSync(file, [
                '// A Firebase Authentication exchange was mounted here. It was removed so', // third-party-allow: fixture proving a tombstone comment is not a violation
                '// Google is not the identity provider here. Do not reintroduce a foreign IdP.',
                "router.post('/login', (req, res) => AuthController.login(req, res));",
            ].join('\n'));
            return gate.scanFile(file, 'auth.js');
        });

        expect(violations).toEqual([]);
    });

    it('negative control — ค่าตั้ง runner ที่สะอาดไม่ทำให้แดง', () => {
        // อีกทิศของการพิสูจน์: กติกาใหม่ต้องไม่แปลว่า "ไฟล์ config ใด ๆ ก็ผิด"
        const violations = withTempDir((dir) => {
            const file = path.join(dir, 'jest.config.mjs');
            fs.writeFileSync(file, [
                'export default {',
                "    testEnvironment: 'jsdom',",
                "    transformIgnorePatterns: ['/node_modules/'],",
                '};',
            ].join('\n'));
            return gate.scanFile(file, 'jest.config.mjs');
        });

        expect(violations).toEqual([]);
    });

    it('ไม่มีไฟล์ที่รีโปส่งของจริง อ้าง Firebase ในโค้ดเป็น', () => { // third-party-allow: test name — this is the repo-wide absence assertion
        // ข้อนี้คือข้อที่ต้องแดงตราบใดที่ยังมีเศษเหลืออยู่จริงในรีโป
        // จำกัดเฉพาะ rule ของ Firebase — บริการอื่นเป็นหน้าที่ของ gate เอง
        // เพื่อให้เวลาข้อนี้แดง ผู้อ่านรู้ทันทีว่าแดงเรื่องอะไร
        const scannable = SHIPPED.filter(
            (relative) => gate.isScannableFile(path.basename(relative)),
        );
        // พื้นกันตัวกรองพัง — วัดจริง 2026-08-08 ได้ 2574 ไฟล์
        expect(scannable.length).toBeGreaterThanOrEqual(2000);

        const firebaseViolations = scannable
            .flatMap((relative) => gate.scanFile(path.join(REPO_ROOT, relative), relative))
            .filter((violation) => violation.service === 'Firebase / Google Identity'); // third-party-allow: selects the rule under test

        expect(firebaseViolations).toEqual([]);
    });
});

describe('gate มองเห็นไฟล์ .html', () => {
    function withTempDir(run) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'third-party-html-'));
        try {
            return run(dir);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    it('walker หยิบไฟล์ .html ขึ้นมาจริง', () => {
        // ระดับ walker ไม่ใช่ระดับ scanFile — scanFile รับ path ที่ส่งให้ตรง ๆ จึงตอบ
        // คำถาม "gate เห็นไฟล์นี้ไหม" ไม่ได้เลย ข้อนี้จึงต้องเดินผ่าน walk() เท่านั้น
        const yielded = withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'report.html'), '<!DOCTYPE html>\n<html></html>\n');
            return [...gate.walk(dir)].map((file) => path.basename(file));
        });

        expect(yielded).toEqual(['report.html']);
    });

    it('.html ที่เรียก font CDN ถูกจับตั้งแต่ walk จนถึง scanFile', () => {
        const violations = withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'dirty.html'), [
                '<!DOCTYPE html>',
                '<html><head>',
                '<link href="https://fonts.googleapis.com/css2?family=Prompt" rel="stylesheet">', // third-party-allow: fixture the gate is required to catch
                '</head></html>',
            ].join('\n'));
            return [...gate.walk(dir)].flatMap((file) => gate.scanFile(file, path.basename(file)));
        });

        expect(violations).toHaveLength(1);
        expect(violations[0].line).toBe(3);
    });

    it('negative control — .html ที่สะอาดถูกมองเห็นแต่ไม่ทำให้แดง', () => {
        // อีกทิศของการพิสูจน์: การเพิ่ม .html ต้องไม่แปลว่า "ไฟล์ html ใด ๆ ก็ผิด"
        // ต้องยืนยันทั้งสองอย่างพร้อมกัน — walker เห็นไฟล์ (ไม่ใช่ผ่านเพราะมองไม่เห็น)
        // และเมื่อเห็นแล้วไม่มีอะไรผิด
        const { seen, violations } = withTempDir((dir) => {
            fs.writeFileSync(path.join(dir, 'clean.html'), [
                '<!DOCTYPE html>',
                '<html lang="th"><head><meta charset="UTF-8">',
                '<style>body{font-family:\'Sarabun\',system-ui,sans-serif}</style>',
                '</head><body><h1>รายงานภายใน</h1></body></html>',
            ].join('\n'));
            const files = [...gate.walk(dir)];
            return {
                seen: files.map((file) => path.basename(file)),
                violations: files.flatMap((file) => gate.scanFile(file, path.basename(file))),
            };
        });

        expect(seen).toEqual(['clean.html']);
        expect(violations).toEqual([]);
    });

    it('ไม่มีไฟล์ .html ที่รีโปส่งของจริง เรียกบริการต่างประเทศ', () => {
        const htmlFiles = SHIPPED.filter((relative) => relative.endsWith('.html'));
        // พื้นกันเคสตัวกรองพัง — 2026-08-04 มี 16 ไฟล์ ในนั้น 14 คือ PDF template
        // ชุดที่เคยถือ @import ของ Google Fonts จริง จึงเป็นชุดที่ต้องเฝ้าที่สุด
        expect(htmlFiles.length).toBeGreaterThanOrEqual(10);

        const violations = htmlFiles.flatMap(
            (relative) => gate.scanFile(path.join(REPO_ROOT, relative), relative),
        );

        expect(violations).toEqual([]);
    });
});
