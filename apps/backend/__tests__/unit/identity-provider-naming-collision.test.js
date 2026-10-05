/**
 * AUTH-01-A (A3) — grep-pin: `provider_id` และ `providerId` คนละของกัน ห้าม map เข้าหากัน
 *
 * สองชื่อนี้ต่างกันแค่ underscore แต่เป็นข้อมูลคนละชนิด คนละเจ้าของ คนละกฎหมาย:
 *
 *   users.providerId        = **เลขบัตรประชาชน (CID)** ของเจ้าหน้าที่ในทะเบียนของเรา
 *                             (prisma/schema/auth.prisma:39; คู่ hash คือ
 *                             providerIdHash / providerIdHmac ที่ auth.prisma:40,42
 *                             ซึ่งเป็นตัวที่ login ใช้ resolve วันนี้ —
 *                             services/prisma-auth-service.js:309)
 *   MOPH `provider_id`      = **เลขใบประกอบวิชาชีพ** ที่ IdP ของ สธ. คืนมาใน profile
 *                             ([P-OAUTH] หน้า 10-12; evidence/AUTH-01/manual-citations.md:86
 *                             ระบุชัดว่าตัวอย่างมีอักษรปนตัวเลข ไม่ใช่เลข 13 หลัก
 *                             จึง match กับทะเบียนเราด้วยค่านี้ไม่ได้)
 *
 * **คำสั่ง operator: ห้าม map เข้าหากันเด็ดขาด** การเขียน `provider_id` จาก IdP ลง
 * `providerId`/`providerIdHash`/`providerIdHmac` = ปนเปื้อนคอลัมน์ที่ทั้งระบบเชื่อว่า
 * เป็นเลขบัตรประชาชน และคอลัมน์นั้นคือกุญแจ login วันนี้ ผลคือทั้ง "เข้าเป็นคนอื่นได้"
 * และ "เลขใบประกอบวิชาชีพถูกเก็บในช่องที่ถูกปฏิบัติเป็น PII ระดับบัตรประชาชน"
 * พร้อมกัน — ไม่มีทางย้อนแยกออกภายหลังเพราะสองค่าอยู่ในคอลัมน์เดียวกันแล้ว
 *
 * ทำไมต้อง grep-pin ไม่ใช่ unit test: วันนี้ยัง **ไม่มี** โค้ดจุดไหนทำแบบนี้เลย
 * (services/auth/idp/*.js คืน raw profile อย่างเดียว ไม่แตะ DB — ธง D-MANUAL-HASHCID
 * ยังปิดเส้น linking จริงอยู่) จึงไม่มี behavior ให้ทดสอบ มีแต่ "ความว่าง" ให้ตรึง
 * ไฟล์นี้จึงเป็น **pin ไม่ใช่ fix** — มันตรึงสถานะสะอาดวันนี้ไว้ ไม่ให้ PR ถัดไปที่มา
 * ปลดธง linking เขียน mapping นี้ลงไปเงียบ ๆ
 *
 * แนวเดียวกับ __tests__/unit/soft-delete-registry-drift.test.js: อ่านไฟล์จริงจาก
 * ดิสก์ ไม่ require runtime module ไม่ต่อ DB — และมี sanity floor กันการผ่านแบบว่าง
 * (scanner พัง = ทุก assertion ผ่านฟรี ซึ่งอันตรายกว่าไม่มี test)
 *
 * ═══ ขอบเขตที่ pin นี้บังคับได้จริง — อ่านก่อนอ้างไฟล์นี้เป็นหลักประกัน ═══
 *
 * ไฟล์นี้ตรึงสอง invariant คนละรูปกัน **ขอบเขตไม่เท่ากัน อย่าอ้างรวมเป็นก้อนเดียว**
 *
 * ── (ก) เทสต์ 2 และ 3 — "provider_id ห้ามไหลเข้า providerId*" = grep + ระยะใกล้ ──
 * บังคับได้เฉพาะกรณีที่ token `provider_id` กับการเขียน `providerId*` อยู่ใน
 * **ไฟล์เดียวกัน** และห่างกันไม่เกิน PROXIMITY_LINES บรรทัด
 * สิ่งที่ **ไม่** ครอบ — และครอบด้วย grep ไม่ได้จริง ๆ ไม่ใช่ยังไม่ได้ทำ:
 *   1. dataflow ข้ามไฟล์ / ข้ามฟังก์ชัน — ไฟล์ A คืน `profile.provider_id` ออกมา
 *      เป็น return value แล้วไฟล์ B เขียนค่านั้นลง `providerId` โดยไม่มีคำว่า
 *      provider_id อยู่ในไฟล์ B เลย (ยืนยันแล้วว่าลอดผ่านจริง:
 *      evidence/AUTH-01/A/red-a3-escapes.txt หัวข้อ MUT-3)
 *   2. ชื่อคอลัมน์ที่ประกอบขึ้นตอน runtime (`const col = 'provider' + 'Id'`) หรือ
 *      เขียนผ่านตัวแปรที่ถือชื่อคอลัมน์ไว้ (`patch[col] = value`)
 *   3. โค้ดนอก SCAN_DIRS — ทะเบียนของสิ่งที่ไม่ถูกสแกนพร้อมเหตุผลอยู่ที่
 *      UNSCANNED_DIRS ข้างล่าง (prisma/seed, data/, eslint-rules/, ไฟล์ระดับราก
 *      เช่น server.js) และทุกอย่างนอก apps/backend
 *
 * ── (ข) สิ่งที่เคยมีแล้วถอดออก — "ห้ามเขียน identity_links" ──
 * เคยมีเทสต์ 4 และ 5 ตรึงว่าไม่มีโค้ดใน SCAN_DIRS เขียน `identity_links` เลย
 * **ถอดออกแล้วตามมติ operator 2026-08-04** เพราะมันจับผิดโค้ดที่ถูกต้อง: ไฟล์ที่
 * **อ่าน** `identity_links` แล้วบังเอิญมี `prisma.user.update` ที่ไม่เกี่ยวข้องอยู่
 * ในไฟล์เดียวกันจะแดง ทั้งที่การอ่านคือเหตุผลทั้งหมดที่สร้างตารางนี้และเป็นขั้นถัดไป
 * ของ AUTH-01 · เหตุผลเต็ม `evidence/AUTH-01/A/audit-round3-verdict.md`
 * **invariant นั้นยังมีผล แต่บังคับด้วยคน ไม่ใช่ด้วยเทสต์** (ดู (ค))
 *
 * ── (ค) สิ่งที่ "ไม่มีเครื่องมือบังคับ" วันนี้ — ต้องตรวจด้วยตาบน PR ──
 * อ่านให้จบก่อนอ้างไฟล์นี้เป็นหลักประกัน · pin ที่เหลือ **ไม่ครอบ** สิ่งเหล่านี้:
 *   1. **การเขียนผ่านตัวแปร / พารามิเตอร์ / computed key** — `patch[col] = value`,
 *      `const { provider_id: providerId } = profile` แล้ว `data: { providerId }`
 *      (รูป shorthand ไม่มี `=` ให้ match — audit รอบ 3 BLOCKER-1)
 *   2. dataflow ข้ามไฟล์ / ข้ามฟังก์ชัน (ข้อ 1 ของหัวข้อ ก)
 *   3. **การเขียนคอลัมน์ CID ด้วย raw SQL** — `UPDATE "users" SET "providerIdHash" = $1`
 *      ชื่อคอลัมน์ใน double quote ไม่ match เพราะ normalize + lookbehind
 *   4. การเขียน `identity_links` ทุกรูป (หัวข้อ ข)
 *
 * ⇒ **invariant "ห้าม map `provider_id` → `providerId*`" และ "ห้ามเขียน identity_links
 * ก่อนปลดธง D-MANUAL-HASHCID" บังคับด้วย code review ของคน ไม่ใช่ด้วยเครื่องมือ**
 * ผู้ review บน PR ที่แตะเส้น IdP ต้องไล่ call graph เอง — CI เขียวไม่ใช่คำรับรอง
 * งานที่จะปิดช่องนี้จริงคือ AST-based check (BACKLOG) ที่ตอบได้ว่า "อะไรคือการเขียน"
 * เชิงโครงสร้าง แทนการจับรูปตัวอักษร ซึ่ง auditor สามรอบชี้ตรงกัน
 *
 * ── สิ่งที่ pin นี้ยังทำได้จริง ──
 * ตรึงว่า **วันนี้ทั้ง SCAN_DIRS ไม่มีการอ่าน `provider_id` แล้วเขียนลง `providerId*`
 * ในระยะใกล้ ๆ กันในไฟล์เดียว** และตรึงทะเบียนไดเรกทอรีไม่ให้หายไปเงียบ ๆ —
 * ยกต้นทุนของการทำผิด "โดยไม่ตั้งใจในรูปที่ตรงไปตรงมาที่สุด" ให้สูงขึ้น
 * ไม่ใช่ด่านที่กันคนที่เขียนคนละรูป และไม่ใช่ด่านที่กันคนที่ตั้งใจเลี่ยง
 *
 * ── ทำไมรอบนี้ normalize ก่อน match ──
 * รอบก่อนหน้าแก้ด้วยการเพิ่ม alternation ต่อ mutation ที่ auditor ตั้งชื่อมาทีละตัว
 * ผลคือทุกครั้งที่มีไวยากรณ์ใหม่ (`??=`, backtick, `Object.defineProperty`) ก็ลอดใหม่
 * ทั้งหมด รอบนี้จึงยุบ **ไวยากรณ์ที่มีความหมายเดียวกัน** ให้เหลือรูปเดียวก่อน (ดู
 * normalize()) แล้วค่อย match — pattern จึงมีรูปเดียวต่อความหมายหนึ่งอย่าง และการ
 * เพิ่มไวยากรณ์ใหม่ในภาษาไม่ทำให้ต้องไล่แก้ pattern อีก
 */

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

/**
 * ไดเรกทอรีชั้นบนของ apps/backend ที่ **ถูกสแกน**
 *
 * ไม่ใช่ "โค้ดที่รันจริงทั้งหมด" — สิ่งที่ไม่ถูกสแกนมีจริงและอยู่ในทะเบียน
 * UNSCANNED_DIRS ข้างล่างพร้อมเหตุผล (เทสต์ sanity บังคับว่าไดเรกทอรีชั้นบนที่มี
 * ไฟล์โค้ดต้องอยู่ในทะเบียนใดทะเบียนหนึ่งเสมอ — ไดเรกทอรีใหม่ที่ไม่มีใครจัดประเภท
 * จะทำให้แดง แทนที่จะเงียบหายไปจากสายตา)
 */
const SCAN_DIRS = [
    'routes',
    'services',
    'middleware',
    'shared',
    'jobs',
    'utils',
    'controllers',
    'config',
    'modules',
    'validation',
    'constants',
    'cron',
    // สคริปต์ปฏิบัติการ (backfill / seed / rekey) เขียนลงฐานข้อมูลจริงด้วยสิทธิ์
    // เต็มเหมือน service — เช่น scripts/backfill-national-id-hmac.js และ
    // scripts/rekey-canonicalid.js ที่ UPDATE คอลัมน์ตระกูล *Hmac ตรง ๆ
    // ปล่อยไดเรกทอรีนี้ไว้นอกสายตา = เปิดช่องให้ mapping ต้องห้ามเดินผ่านทั้งช่อง
    'scripts',
];

/**
 * ไดเรกทอรีชั้นบนที่มีไฟล์โค้ดแต่ **จงใจไม่สแกน** — คู่ตรงข้ามของ SCAN_DIRS
 * ทะเบียนนี้คือคำสารภาพว่าอะไรอยู่นอกขอบเขต ไม่ใช่รายการที่ปลอดภัยโดยอัตโนมัติ
 */
const UNSCANNED_DIRS = {
    __tests__: 'เทสต์ — fixture ตั้งใจมี provider_id ได้ และไฟล์นี้เองก็อยู่ในนั้น',
    'test-support': 'ตัวช่วยของ jest harness (ตรวจว่ามีฐานเทสไหม, ตัวรัน postgres) — โหลดโดย globalSetup ไม่เคยอยู่ในเส้น request',
    tests: 'เทสต์ (property-based) — เหตุผลเดียวกับ __tests__',
    'chaos-tests': 'สคริปต์ chaos (yml เป็นหลัก) ไม่ได้รันในเส้น request',
    prisma: 'schema + seed — seed เขียน DB จริง จึงเป็นช่องที่ pin นี้ไม่ครอบ (ข้อ 3 ของขอบเขต ก)',
    data: 'ตารางข้อมูลนิ่ง (ที่อยู่ไทย / journey config) ไม่มีเส้นเขียน DB',
    'eslint-rules': 'ปลั๊กอิน lint — รันตอน build ไม่ได้ต่อ DB',
    'node_modules': 'dependency',
    coverage: 'artifact ของ jest (.gitignore) — มี .js ของ lcov-report ปนอยู่',
    dist: 'artifact ของ build (.gitignore)',
    build: 'artifact ของ build (.gitignore)',
    generated: 'artifact ของ prisma generate (.gitignore)',
    uploads: 'ไฟล์ที่ผู้ใช้อัปโหลด (.gitignore)',
    logs: 'log (.gitignore)',
};

/**
 * พื้นจำนวนไฟล์ต่อไดเรกทอรี = **ทะเบียนชื่อ dir ที่คาดหวัง** ด้วยในตัว
 *
 * เดิมมีแต่ floor รวม (560 เทียบของจริง 593) ซึ่งเหลือช่อง 33 ไฟล์ ⇒ ลบ
 * `'middleware'` (22 ไฟล์) หรือ `'controllers'+'utils'` (32 ไฟล์) ออกจาก SCAN_DIRS
 * แล้ว suite ยังเขียว (พิสูจน์: evidence/AUTH-01/A/red-a3-escapes-round2.txt หัวข้อ
 * N-1/N-2 ฝั่ง BEFORE) ทะเบียนนี้ปิดช่องนั้นสามชั้น:
 *   1. ชื่อใน SCAN_DIRS ต้องตรงกับคีย์ของทะเบียนนี้เป๊ะ (ลบข้างเดียว = แดง)
 *   2. แต่ละ dir ต้องคืนไฟล์ไม่น้อยกว่าพื้นของตัวเอง (ลบทั้งสองที่ = dir นั้นนับได้ 0)
 *   3. เทสต์ sanity ยังตรวจจากดิสก์ว่าไดเรกทอรีชั้นบนที่มีโค้ดต้องถูกจัดประเภท
 *      (ลบครบทุกที่ในไฟล์นี้ ก็ยังแดงเพราะ dir นั้นไม่อยู่ในทะเบียนไหนเลย)
 *
 * ตัวเลขนับจริงเมื่อ 2026-08-04 ด้วย walker ตัวเดียวกันนี้ (รวม .mjs/.cjs แล้ว):
 *   services 200 · routes 182 · scripts 79 · shared 44 · middleware 22 ·
 *   controllers 17 · utils 15 · config 12 · modules 9 · jobs 8 · constants 3 ·
 *   validation 2 · cron 1   (รวม 594)
 * พื้นตั้งไว้ราว 85% ของค่าจริงเพื่อให้ลบ/ย้ายไฟล์ตามปกติได้โดยไม่ต้องแก้เทสต์
 */
const SCAN_DIR_FILE_FLOOR = {
    routes: 150,
    services: 170,
    middleware: 18,
    shared: 38,
    jobs: 6,
    utils: 12,
    controllers: 14,
    config: 10,
    modules: 7,
    validation: 2,
    constants: 2,
    cron: 1,
    scripts: 65,
};

/**
 * พื้นจำนวนไฟล์รวม — ชั้นสำรอง ไม่ใช่ตัวหลักอีกต่อไป (ตัวหลักคือทะเบียนข้างบน)
 * ยังมีประโยชน์ในเคส "walker พังทั้งตัว" ซึ่งทำให้ทุก assertion ผ่านฟรี
 */
const MIN_SCANNED_FILES = 560;

/** นามสกุลที่ถือว่าเป็นโค้ดที่รันได้ — .mjs/.cjs อยู่ใน SCAN_DIRS จริง (scripts/e2e/) */
const CODE_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];

/**
 * ระยะที่ถือว่า "อยู่ในโค้ดชิ้นเดียวกัน"
 *
 * เป็นค่าที่เลือกเพื่อคุมสัญญาณรบกวน (จับทั้งไฟล์ = ไฟล์ยาว ๆ ที่บังเอิญมีทั้งสองคำ
 * คนละเรื่องกันจะแดงทันที) **ไม่ใช่** ข้อเท็จจริงว่า mapping จริงไม่เคยห่างเกินนี้ —
 * ไม่มีใครวัดไว้ และวัดไม่ได้เพราะวันนี้ยังไม่มี mapping จริงสักจุดในโค้ด
 * สิ่งที่ลอดได้เพราะค่านี้: destructure/rename แล้วไปเขียนห่างออกไป ~40 บรรทัด
 * ในฟังก์ชันอื่นของไฟล์เดียวกัน — ปิดไม่ได้ด้วย grep ต้องอาศัย review เช่นเดียวกับ
 * ข้อจำกัดข้ออื่นในหัวไฟล์ (เทสต์ 4 และ 5 ไม่ใช้ค่านี้ — มันตรวจทั้งไฟล์)
 */
const PROXIMITY_LINES = 15;

/**
 * ── normalize: ยุบไวยากรณ์ที่มีความหมายเดียวกันให้เหลือรูปเดียว ก่อน match ────
 *
 *   quote สามชนิด   `'`  `"`  `` ` ``                        →  `"`
 *   ตัวดำเนินการเขียน  `=` `+=` `-=` `*=` `/=` `%=` `**=` `&=`
 *                    `|=` `^=` `<<=` `>>=` `>>>=` `??=`
 *                    `||=` `&&=` และ `:` ของ object literal   →  `=`
 *   เขียน property ผ่าน API ที่ไม่มีตัวดำเนินการ
 *     `Object.defineProperty(t, 'col', d)` · `Reflect.set(t, 'col', v)` ·
 *     `map.set('col', v)`                                     →  `["col"] =`
 *
 * ตัวเปรียบเทียบ (`==` `===` `!=` `>=` `<=`) และ arrow (`=>`) ถูกกันไว้ไม่ให้
 * กลายเป็นตัวดำเนินการเขียน มิฉะนั้น `x => …` และ `a !== b` จะกลายเป็น false positive
 *
 * ข้อจำกัดที่รู้ตัว: รูป `Object.defineProperty(obj[k(a,b)], 'col', d)` ที่ argument
 * ตัวแรกมี comma ซ้อนอยู่ จะไม่เข้ารูป (เป็นกรณีเดียวกับข้อ 2 ของขอบเขต ก)
 */
function normalize(line) {
    return line
        .replace(/[`'"]/g, '"')
        .replace(
            /\b(?:Object|Reflect)\s*\.\s*(?:defineProperty|set)\s*\(\s*[^,()]*,\s*("[^"]*"|[\w$]+)\s*,/g,
            ' [$1] = ',
        )
        .replace(/\.\s*set\s*\(\s*("[^"]*"|[\w$.]+)\s*,/g, ' [$1] = ')
        .replace(/(?:\?\?|\|\||&&|\*\*|<<|>>>?|[-+*/%&|^])?=(?![=>])/g, '=')
        .replace(/:(?!:)/g, '=');
}

/**
 * ค่า `provider_id` จาก IdP ปรากฏในไฟล์ — จับที่ระดับ **token** ไม่ใช่ไวยากรณ์รอบตัว
 *
 * เดิมจับเฉพาะ `.provider_id` / `['provider_id']` / `provider_id[,:}]` / `{provider_id`
 * ทำให้ backtick, destructure หลายบรรทัด และ `map.set('provider_id', …)` ลอดหมด
 *
 * **สถานะ 2026-08-14 (หลังถอน mock IdP):** เดิมทั้ง SCAN_DIRS มี token นี้อยู่ไฟล์เดียว
 * คือ services/auth/idp/mock-idp-adapter.js:69 ซึ่งถูกลบไปพร้อม mock ⇒ ตอนนี้ SCAN_DIRS
 * **ไม่มี token `provider_id` เหลือเลยแม้แต่บรรทัดเดียว** (ยืนยันด้วย grep บนทรีจริง)
 * การขยายเป็น token เปล่าจึงยังไม่เพิ่ม false positive และ "ความว่าง" ที่ไฟล์นี้ตรึงไว้
 * ก็ว่างจริงยิ่งกว่าเดิม · ผลข้างเคียงที่ต้องจัดการ: sanity floor เดิมใช้ token ตัวนั้น
 * เป็นหลักฐานว่า scanner ยังทำงาน — เมื่อ specimen หาย floor จะแดง (และถ้าใครผ่อนมันทิ้ง
 * เกราะจะเขียวแบบว่าง) จึงย้ายไปพิสูจน์ด้วย **ไฟล์สังเคราะห์ที่เดิน pipeline เดียวกันทุก
 * บรรทัด** แทน — ดู synthesizeFile() + ชั้น 4 ของเทสต์ sanity
 */
const PROVIDER_ID_SNAKE_READ = /\bprovider_id\b/;

/** คอลัมน์ตระกูล CID ของเรา */
const CID_COL = String.raw`providerId(?:Hash|Hmac)?`;

/**
 * ── การ "เขียน" ลงคอลัมน์ CID (ใช้กับข้อความที่ normalize แล้ว) ──────────────
 * เป้าหมายของการเขียนมีสองรูปเท่านั้นหลัง normalize:
 *   identifier เปล่า   `user.providerIdHash =`   `{ providerId= }`
 *   computed key       `patch["providerId"] =`   (รวมรูปที่ normalize เขียนใหม่มาจาก
 *                                                 defineProperty / Reflect.set / map.set)
 * identifier เปล่า **ต้องไม่ติดเครื่องหมายคำพูด** — `? "providerIdHmac" = "providerIdHash"`
 * (ternary เลือกชื่อคอลัมน์เพื่อ **อ่าน**) จึงไม่ถูกนับเป็นการเขียนอีกต่อไป
 */
const CID_WRITE = new RegExp(
    String.raw`(?:(?<!["\w$])${CID_COL}(?!["\w$])|\[\s*"${CID_COL}"\s*\])\s*=`,
);

/**
 * ตาราง field-map ที่ประกาศเจตนา map `provider_id` → คอลัมน์ CID
 * `{ provider_id: 'providerId' }` · `{ ['provider_id']: 'providerIdHash' }` ·
 * `map.set('provider_id', 'providerIdHash')` (normalize ยุบให้เป็นรูปเดียวกัน)
 *
 * ต้องจับ **เป็นคู่ในนิพจน์เดียว** — เดิมจับแค่ `= "providerId"` ลอย ๆ ซึ่งทำให้ 15
 * บรรทัดที่ไม่ใช่การเขียนเลยกลายเป็น false positive (ternary ที่เลือกชื่อคอลัมน์เพื่อ
 * อ่านที่ services/prisma-auth-service.js:309, services/provider-user-service.js:388,
 * services/user-lookup-service.js:191 · `loginField: 'providerId'` 10 จุดใน
 * scripts/seed-test-accounts.js · `via: 'providerId'` ที่ scripts/backfill-reviewer-id.js:68
 * · ตารางชื่อคอลัมน์ที่ scripts/backfill-national-id-hmac.js:65)
 * ผลคือ suite เคยเขียวอยู่ได้เพราะทั้งทะเบียนโค้ดมีบรรทัดเดียวที่ match ฝั่ง snake —
 * เอา `provider_id` ที่ไม่เกี่ยวข้องไปวางใกล้บรรทัดใดบรรทัดหนึ่งใน 15 นั้น suite จะ
 * แดงใส่โค้ดเดิมที่ถูกต้อง (MINOR-2 ของ audit รอบสอง)
 */
const SNAKE_TO_CID_MAP_PAIR = new RegExp(String.raw`provider_id"?\s*\]?\s*=\s*"${CID_COL}"`);

/** รวม regex หลายตัวเป็น alternation เดียว โดยคงความหมายของแต่ละตัวไว้ */
function anyOf(...patterns) {
    return new RegExp(patterns.map((p) => p.source).join('|'));
}

/** เขียนลงคอลัมน์ CID ของเรา — assignment จริง หรือ ตาราง field-map */
const PROVIDER_ID_CAMEL_WRITE = anyOf(CID_WRITE, SNAKE_TO_CID_MAP_PAIR);

/**
 * subject ของ identity_links (ค่า opaque จาก IdP) ไหลลงคอลัมน์ CID
 * ใช้เฉพาะรูปที่เป็น assignment จริง — รูป field-map ไม่เกี่ยวเพราะฝั่งขวาของมัน
 * เป็นชื่อคอลัมน์ ไม่ใช่ค่า subject
 */
const SUBJECT_INTO_PROVIDER_ID = new RegExp(`(?:${CID_WRITE.source})\\s*[^,;\\n]*\\bsubject\\b`);

/**
 * ── ถอดออกแล้ว: เทสต์ "ห้ามเขียน identity_links" (audit รอบ 3, operator 2026-08-04) ──
 * เคยมีสองเทสต์ที่ตรึงว่า **ไม่มีโค้ดใน SCAN_DIRS เขียน `identity_links` เลย** (ผ่าน
 * Prisma client และผ่าน raw SQL) — ถอดออกทั้งคู่เพราะมันจับผิดโค้ดที่ถูกต้อง:
 *
 *   ไฟล์ที่ `prisma.identityLink.findUnique(...)` **อ่านอย่างเดียว** แล้วบังเอิญมี
 *   `prisma.user.update(...)` ที่ไม่เกี่ยวข้องอยู่ในไฟล์เดียวกัน → เทสต์แดง
 *   เพราะทั้งสองเทสต์ค้นแบบ "ทั้งไฟล์" ทีละเงื่อนไขแล้วจับคู่กันเอง และคำว่า
 *   `update` ของ Prisma ก็เข้าเงื่อนไข SQL_WRITE_VERB ด้วย
 *
 * การ resolve login ด้วยการ **อ่าน** `identity_links` คือเหตุผลทั้งหมดที่สร้างตารางนี้
 * และเป็นขั้นถัดไปของ AUTH-01 ⇒ ปล่อยไว้จะทำให้งานนั้นเขียนไม่ได้โดยที่ข้อความ error
 * บอกว่าเป็น "การเขียน" ซึ่งไม่จริง · หลักฐาน `evidence/AUTH-01/A/audit-round3-verdict.md`
 *
 * **invariant "ห้ามเขียน identity_links ก่อนปลดธง D-MANUAL-HASHCID" ยังมีผลอยู่ —
 * แต่ตอนนี้บังคับด้วย code review ของคน ไม่ใช่ด้วยเทสต์** (ดูหัวข้อ ค ในหัวไฟล์)
 */

function isCodeFile(name) {
    return CODE_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function* walk(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') { continue; }
            yield* walk(full);
        } else if (isCodeFile(entry.name)) {
            yield full;
        }
    }
}

/** มีไฟล์โค้ดอย่างน้อยหนึ่งไฟล์ไหม — ใช้จัดประเภทไดเรกทอรีชั้นบน (ไม่ข้าม __tests__) */
function hasCodeFile(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return false;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') { continue; }
            if (hasCodeFile(path.join(dir, entry.name))) { return true; }
        } else if (isCodeFile(entry.name)) {
            return true;
        }
    }
    return false;
}

/**
 * ลบคอมเมนต์ทิ้งก่อนตรวจ — เอกสารที่ "พูดถึง" การห้าม (รวมหัวไฟล์นี้เอง และ
 * คอมเมนต์อธิบายใน migration/schema) ต้องไม่ถูกนับเป็นการละเมิด
 * เก็บจำนวนบรรทัดเท่าเดิมเพื่อให้เลขบรรทัดที่รายงานตรงกับไฟล์จริง
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function scanFiles() {
    const files = [];
    for (const dir of SCAN_DIRS) {
        for (const file of walk(path.join(BACKEND_ROOT, dir))) {
            const raw = fs.readFileSync(file, 'utf8').split('\n');
            files.push({
                rel: path.relative(BACKEND_ROOT, file),
                dir,
                raw,
                // `lines` = สิ่งที่ pattern ทุกตัวทำงานด้วย: ตัดคอมเมนต์แล้ว normalize แล้ว
                lines: stripComments(raw.join('\n')).split('\n').map(normalize),
            });
        }
    }
    return files;
}

const FILES = scanFiles();

/**
 * ไฟล์ **สังเคราะห์** ที่เดิน pipeline เดียวกับไฟล์จริงทุกขั้น (stripComments → normalize)
 * ใช้เป็น specimen ให้ sanity floor — ไม่เขียนอะไรลงดิสก์ และไม่แตะทรีจริง
 */
function synthesizeFile(rel, source) {
    return {
        rel,
        dir: '<synthetic>',
        raw: source.split('\n'),
        lines: stripComments(source).split('\n').map(normalize),
    };
}

/** แสดงบรรทัดต้นฉบับ (ไม่ใช่ตัว normalize) เวลารายงาน — เลขบรรทัดตรงกับไฟล์จริง */
function at(file, index) {
    return `${file.rel}:${index + 1} ${(file.raw[index] || '').trim().slice(0, 80)}`;
}

/**
 * เส้นตรวจของเทสต์ 2 — แยกเป็นฟังก์ชันเพื่อให้ยิงกับ FILES จริง **และ** กับไฟล์
 * สังเคราะห์ได้ด้วยโค้ดตัวเดียวกัน (ถ้าเส้นตรวจนี้พัง specimen จะจับไม่ได้ = แดง)
 */
function findMappingViolations(files) {
    const violations = [];
    for (const file of files) {
        file.lines.forEach((line, i) => {
            if (!PROVIDER_ID_SNAKE_READ.test(line)) { return; }
            const from = Math.max(0, i - PROXIMITY_LINES);
            const to = Math.min(file.lines.length, i + PROXIMITY_LINES + 1);
            for (let j = from; j < to; j += 1) {
                if (PROVIDER_ID_CAMEL_WRITE.test(file.lines[j])) {
                    violations.push(`${file.rel}:${i + 1} provider_id → ${at(file, j)}`);
                }
            }
        });
    }
    return violations;
}

/** เส้นตรวจของเทสต์ 3 — เหตุผลเดียวกับข้างบน */
function findSubjectViolations(files) {
    const violations = [];
    for (const file of files) {
        file.lines.forEach((line, i) => {
            if (SUBJECT_INTO_PROVIDER_ID.test(line)) { violations.push(at(file, i)); }
        });
    }
    return violations;
}

describe('[AUTH-01-A/A3] MOPH provider_id (เลขใบประกอบวิชาชีพ) ห้ามไหลเข้า users.providerId (CID)', () => {
    it('sanity: scanner เห็นครบทุกไดเรกทอรีที่อ้างว่าสแกน และมองเห็นทั้งสองชื่อในทะเบียนโค้ด', () => {
        // ถ้า scanner พัง ทุก assertion ข้างล่างจะผ่านแบบว่าง — ตรึงสามชั้นก่อน
        // ชั้น 1: ชื่อ dir ที่สแกนจริงต้องตรงกับทะเบียนพื้นไฟล์เป๊ะ (ลบข้างเดียว = แดง)
        expect([...SCAN_DIRS].sort()).toEqual(Object.keys(SCAN_DIR_FILE_FLOOR).sort());

        // ชั้น 2: แต่ละ dir ต้องคืนไฟล์ไม่น้อยกว่าพื้นของตัวเอง (ลบทั้งสองที่ = นับได้ 0)
        const belowFloor = Object.entries(SCAN_DIR_FILE_FLOOR)
            .map(([dir, floor]) => [dir, FILES.filter((f) => f.dir === dir).length, floor])
            .filter(([, count, floor]) => count < floor)
            .map(([dir, count, floor]) => `${dir}: ${count} < ${floor}`);
        expect(belowFloor).toEqual([]);

        // ชั้น 3: ไดเรกทอรีชั้นบนที่มีไฟล์โค้ด ต้องถูกจัดประเภทเสมอ — ลบ entry ออกจาก
        // ทั้งสองทะเบียนข้างบนก็ยังแดงที่นี่ และไดเรกทอรีใหม่ที่ไม่มีใครจัดประเภทก็แดง
        const unclassified = fs.readdirSync(BACKEND_ROOT, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .filter((name) => !SCAN_DIRS.includes(name) && !(name in UNSCANNED_DIRS))
            .filter((name) => hasCodeFile(path.join(BACKEND_ROOT, name)));
        expect(unclassified).toEqual([]);

        // ชั้นสำรอง: floor รวม กันเคส walker พังทั้งตัว
        expect(FILES.length).toBeGreaterThanOrEqual(MIN_SCANNED_FILES);

        // ชั้น 4: ฝั่ง camel — คอลัมน์ของเราต้องมีอยู่จริงในทะเบียนโค้ด (ถ้า pattern
        // ฝั่งนี้ตายเมื่อไร เทสต์ 2 และ 3 จะผ่านฟรีทันที)
        const hasCamel = FILES.some((f) => f.lines.some((l) => PROVIDER_ID_CAMEL_WRITE.test(l)));
        expect(hasCamel).toBe(true);

        // ชั้น 5: ฝั่ง snake + เส้นตรวจทั้งเส้น — พิสูจน์ด้วย **specimen สังเคราะห์**
        // เดิมชั้นนี้ยืนอยู่บน token `provider_id` ที่มีอยู่ไฟล์เดียวใน SCAN_DIRS คือ
        // services/auth/idp/mock-idp-adapter.js:69 ซึ่งถูกลบพร้อม mock IdP 2026-08-14
        // ⇒ floor แดงและ "ผ่อนให้เขียว" จะทำให้เกราะ A3 เขียวแบบว่าง (audit 2026-08-14
        // MAJOR) · specimen จึงมาอยู่ในเทสต์ และเดิน stripComments+normalize+regex
        // ชุดเดียวกับไฟล์จริงทุกบรรทัด — ไม่ต้องรอให้โค้ดจริงมี provider_id อีก
        const planted = synthesizeFile('services/planted-idp-linker.js', [
            'function link(profile, patch) {',
            '    const licence = profile.provider_id;',
            '    patch.providerIdHash = hash(licence);',
            '    return patch;',
            '}',
        ].join('\n'));
        const plantedHits = findMappingViolations([planted]);
        expect(plantedHits).toHaveLength(1);
        expect(plantedHits[0]).toContain('services/planted-idp-linker.js:2 provider_id →');
        expect(plantedHits[0]).toContain('services/planted-idp-linker.js:3');

        // specimen รูปที่ 2 — object literal: พึ่ง normalize() ที่ยุบ `:` เป็น `=`
        // (ถ้าการยุบนั้นหาย รูปนี้เงียบทันทีทั้งที่รูปที่ 1 ยังจับได้ — พิสูจน์แล้วด้วย
        //  mutation MUT-5 ที่รอดตอนมี specimen รูปเดียว)
        expect(findMappingViolations([synthesizeFile('services/planted-update.js', [
            'const licence = profile.provider_id;',
            'await prisma.user.update({ data: { providerIdHash: hash(licence) } });',
        ].join('\n'))])).toHaveLength(1);

        // specimen รูปที่ 3 — ตาราง field-map ที่ประกาศเจตนา map ตรง ๆ: พึ่งทั้งการยุบ
        // quote สามชนิดให้เหลือ `"` และการยุบ `:` (SNAKE_TO_CID_MAP_PAIR)
        expect(findMappingViolations([synthesizeFile('services/planted-fieldmap.js',
            "const FIELD_MAP = { provider_id: 'providerIdHash' };\n")])).toHaveLength(1);

        // control (ก): คอมเมนต์ที่ "พูดถึง" การห้าม ต้องไม่ถูกนับ (stripComments ยังทำงาน)
        expect(findMappingViolations([synthesizeFile('services/only-comment.js', [
            '// ห้าม map provider_id ลง providerIdHash เด็ดขาด',
            'const x = 1;',
        ].join('\n'))])).toEqual([]);

        // control (ข): อ่าน provider_id เฉย ๆ โดยไม่เขียนคอลัมน์ CID = ไม่ใช่การละเมิด
        expect(findMappingViolations([
            synthesizeFile('services/read-only.js', 'const licence = profile.provider_id;\n'),
        ])).toEqual([]);

        // ชั้น 6: เส้นตรวจของเทสต์ 3 (subject → คอลัมน์ CID) ก็ต้องจับ specimen ได้
        expect(findSubjectViolations([
            synthesizeFile('services/planted-subject.js', 'data.providerIdHmac = hmac(subject);\n'),
        ])).toHaveLength(1);
        expect(findSubjectViolations([
            synthesizeFile('services/subject-read.js', 'const s = link.subject;\n'),
        ])).toEqual([]);
    });

    it('ไม่มีไฟล์ไหนอ่าน provider_id จาก IdP แล้วเขียนลง providerId / providerIdHash / providerIdHmac', () => {
        expect(findMappingViolations(FILES)).toEqual([]);
    });

    it('ไม่มี subject ของ identity_links ถูกเขียนลง users.providerId (subject ของ providerid = ค่า opaque ห้ามตีความ)', () => {
        expect(findSubjectViolations(FILES)).toEqual([]);
    });

});
