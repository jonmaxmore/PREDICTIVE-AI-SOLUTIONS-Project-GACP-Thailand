/**
 * ═══════════════════════════════════════════════════════
 *  GACP Thai — Consolidated Seed Data
 * ═══════════════════════════════════════════════════════
 *
 * Organization : กรมวิชาการเกษตร (Department of Agriculture)
 * Platform     : GACP Thai — ระบบรับรองมาตรฐาน GACP สมุนไพร
 * Domain       : @gacp.go.th (officers) / @gacpth.com (applicants)
 *
 * Run: node prisma/seed-gacp.js
 *
 * This is the ONLY seed file for user accounts.
 * Replaces: seed.js, seed-users.js, seed-moph.js,
 *           create-test-user.js, create-pongsakorn.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { runWithTenantContext } = require('../services/tenant-context');
const feeService = require('../services/fee-service');
// W4 2026-08-22 — the seed is a User.role WRITER and a creator of applicant
// accounts, so it owes the same two contracts registration owes:
//   1. the canonical role spelling (migration 20260801000000 + b4ac86bf);
//   2. the Wave-B Phase-68 invariant "every health user has a personal
//      INDIVIDUAL entity" — without it findOrCreateApplicationForHealth
//      refuses to create a draft and the whole wizard 400s on first upload.
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { ensurePersonalIndividualEntity } = require('../services/entity-service');
// W4 review round — a seed fixture must never overwrite a role an operator
// migrated on purpose (ACCOUNT -> ACCOUNT_DTAM / ACCOUNT_PLATFORM is an
// audit-logged decision made by scripts/migrate-account-role.js). The helper
// decides, per row, whether the stored value is merely the OLD SPELLING of the
// same canonical role (repairable) or a different role entirely (untouchable).
const { resolveRoleSpellingRepair } = require('../shared/role-spelling-repair');

// Canonical Phase-1 total (state + 10% platform fee + 7% VAT on platform).
// Sourced from feeService so seed data does NOT drift if platform-fee % or VAT
// rate changes. Today this resolves to 5535 for a single-cultivation-scope
// application; recompute via feeService rather than hard-coding the literal.
//
// We compute once at module load using a single-scope payload (matches the
// SAMPLE_APPLICATIONS shape: each sample has one areaType / one cultivation
// method). If a future sample needs a multi-scope app, call feeService inline
// with that sample's formData instead of using this constant.
const PHASE_1_TOTAL_SINGLE_SCOPE = feeService.calculatePhase1Fee({}, { scopeCount: 1 }).phaseTotal;
const PHASE_2_TOTAL_SINGLE_SCOPE = feeService.calculatePhase2Fee({}, { scopeCount: 1 }).phaseTotal;

// The seed builds its own client rather than importing services/prisma-database, so it does
// NOT inherit the extensions that client applies. That is fine for tenancy and soft-delete —
// a seed writes as itself — but not for the plot code: plots seeded without one can never
// carry a field sign, and the contract migration that makes plotCode required would fail on
// exactly the rows CI creates on every run.
//
// Extending here rather than importing the shared client keeps the seed's deliberate
// independence while closing that hole. See services/plot-code-extension.js.
const { plotCodeExtension } = require('../services/plot-code-extension');
const { generatePlotCode } = require('../shared/plot-code');

// ── The doors the seed's own onsite audit goes through ───────────────────────
// A seed may not create what the product itself cannot (see section 6 in main()).
// These are the SAME modules the field app and the issuance chain call, required
// here rather than re-implemented, so a change to any of them changes the seed with
// it — and a regression in the evidence gate breaks the seed loudly instead of
// letting the demo dataset drift into something the product would refuse to make.
const onsiteService = require('../services/audit-onsite-service');
const { armOnsiteEvidence } = require('../services/audit/arm-onsite-evidence');
const certificateService = require('../services/certificate-service');

const prisma = new PrismaClient().$extends(plotCodeExtension);

// ─── Config ──────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;
const PASSWORDS = {
    OFFICER:   'Gacp@2025',
    ADMIN:     'Admin@12345',
    APPLICANT: 'Test@12345',
};

const {
    identityLookupColumns,
    AUTH_TYPE_HEALTH,
    AUTH_TYPE_PROVIDER,
} = require('../services/auth/identity-lookup-columns');

function hashId(id) {
    return crypto.createHash('sha256').update(id).digest('hex');
}

// Deterministic UUID v4-shaped string derived from a stable key. We use this
// so the ERP fixtures (Farm, Plot, PlantSpecies) can be upserted by `id`
// idempotently — Farm/Plot have no other unique field we can key on
// (only @id and @unique uuid, no @@unique([ownerId, farmName])).
function deterministicUuid(namespace, key) {
    const hex = crypto.createHash('sha256').update(`${namespace}:${key}`).digest('hex');
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        // Force version nibble to 4 so the value is a valid v4 UUID string.
        '4' + hex.slice(13, 16),
        // Force variant bits (10xx) per RFC 4122.
        ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hex.slice(18, 20),
        hex.slice(20, 32),
    ].join('-');
}

// Fields the repair below hands back to its caller (the applicant loop passes
// the row straight into ensurePersonalIndividualEntity).
const USER_REPAIR_SELECT = Object.freeze({
    id: true, role: true, healthId: true, organizationId: true,
    firstName: true, lastName: true, email: true,
});

/**
 * Repair what an old seeded row got wrong, and NOTHING else.
 *
 * Two repairs, both narrow:
 *   - role: only when the stored value is the legacy SPELLING of the same
 *     canonical role this fixture names (see shared/role-spelling-repair.js —
 *     a migrated ACCOUNT split normalises to a DIFFERENT role and is left
 *     alone). This is why `role` is absent from every upsert `update:` clause
 *     below: an upsert update is unconditional, and unconditional is exactly
 *     what must not happen to a column an operator migrates by hand.
 *   - organizationId: only when it is null. It is NOT NULL since Phase D, but
 *     a row that predates it would otherwise abort the whole seed inside
 *     ensurePersonalIndividualEntity ("user.organizationId is required").
 *
 * @returns {{ user: object, notes: string[] }} the row as it now stands
 */
async function repairSeededUserRow(user, seedRole, defaultOrgId) {
    const data = {};
    const notes = [];

    const { write, reason } = resolveRoleSpellingRepair(user.role, seedRole);
    notes.push(reason);
    if (write) { data.role = write; }

    if (!user.organizationId && defaultOrgId) {
        data.organizationId = defaultOrgId;
        notes.push('ORGANIZATION_ID_REPAIRED');
    }

    if (Object.keys(data).length === 0) {
        return { user, notes };
    }
    const updated = await prisma.user.update({
        where: { id: user.id }, data, select: USER_REPAIR_SELECT,
    });
    return { user: updated, notes };
}

// ─── Data ────────────────────────────────────────────────

const APPLICANTS = [
    {
        healthId: '1186494077533',
        email: 'somchai@gacpth.com',
        firstName: 'สมชาย',
        lastName: 'เกษตรทอง',
        phoneNumber: '0812345678',
        address: '99/1 หมู่ 5 ต.แม่แฝก อ.สันทราย จ.เชียงใหม่ 50210',
    },
    {
        healthId: '1100200200022',
        email: 'somying@gacpth.com',
        firstName: 'สมหญิง',
        lastName: 'ปลูกดี',
        phoneNumber: '0891234567',
        address: '45 หมู่ 3 ต.ท่าศาลา อ.เมือง จ.เชียงใหม่ 50000',
    },
];

const ADMIN = {
    providerId: '9876543210987',
    email: 'admin@gacp.go.th',
    firstName: 'ผู้ดูแล',
    lastName: 'ระบบ GACP',
    phoneNumber: '0898765432',
};

// W4 2026-08-22 — every `role` below is spelled CANONICALLY (the lowercase
// values in CANONICAL_ROLES). The role MEANINGS are unchanged:
// 'document_reviewer' is what normalizeRole() has always turned
// 'REVIEWER_AUDITOR' into at login, and 'account' likewise for 'ACCOUNTANT' —
// only the value that lands in the column changes, so the accounts stop being
// invisible to the canonical-only filters b4ac86bf narrowed. Keep them as
// quoted literals: seed-officer-roles-canonical.test.js parses this array
// textually.
const OFFICERS = [
    {
        providerId: '1111111111111',
        firstName: 'วิชัย',
        lastName: 'ตรวจเอกสาร',
        role: 'document_reviewer',
        email: 'reviewer@gacp.go.th',
        title: 'เจ้าหน้าที่ตรวจสอบเอกสาร',
    },
    {
        providerId: '2222222222222',
        firstName: 'ประสิทธิ์',
        lastName: 'ตรวจแปลง',
        role: 'field_inspector',
        email: 'inspector@gacp.go.th',
        title: 'ผู้ตรวจประเมินแปลง',
    },
    {
        // ผู้ตัดสินให้การรับรอง (ISO/IEC 17065 §7.6) — ต้องไม่ใช่ผู้ประเมินหน้างาน
        //
        // แถวนี้เคยถือ role 'auditor' เหมือนคนข้างบน โดยอาศัยแค่ "เป็นคนละ id" เป็นด่าน ·
        // ตั้งแต่ F-CERT-SOD 2026-09-10 การตัดสินเป็นบทบาทของตัวเอง และขา
        // AUDIT_PASSED->APPROVED ย้ายมาอยู่กับบทบาทนี้เท่านั้น ⇒ ถ้าแถวนี้ยังเป็น
        // 'auditor' ฐานข้อมูลที่ seed ใหม่จะไม่มีใครอนุมัติคำขอได้เลยแม้แต่ใบเดียว
        providerId: '2222222222223',
        firstName: 'วิชัย',
        lastName: 'รับรองผล',
        role: 'certificate_approver',
        email: 'approver@gacp.go.th',
        title: 'ผู้อนุมัติใบรับรอง',
    },
    {
        providerId: '3333333333333',
        firstName: 'สุภาพร',
        lastName: 'จัดตาราง',
        role: 'dispatcher',
        email: 'dispatcher@gacp.go.th',
        title: 'ผู้ประสานงานนัดหมาย',
    },
    {
        // การเงินสองฝั่ง — operator ตัดสิน 2026-09-10: "FINANCE มีของ DTAM และมีของบริษัท"
        //
        // เดิมแถวนี้ถือคำเปล่า 'account' พร้อมคอมเมนต์ว่าการเลือกข้างเป็นการตัดสินใจของ
        // operator ที่ seed ไม่ควรทำแทน · ตอนนี้ตัดสินแล้ว และคำเปล่าไม่มีอยู่อีกต่อไป
        providerId: '4444444444444',
        firstName: 'ณัฐพล',
        lastName: 'การเงินกรม',
        role: 'finance_officer_dtam',
        email: 'finance@gacp.go.th',
        title: 'เจ้าหน้าที่การเงินและบัญชี (กรม)',
    },
    {
        providerId: '5555555555555',
        firstName: 'พิมพ์ใจ',
        lastName: 'การเงินบริษัท',
        role: 'finance_officer_platform',
        email: 'finance@gacpth.com',
        title: 'เจ้าหน้าที่การเงินและบัญชี (บริษัท)',
    },
    {
        // ผู้ดูแลของบริษัท — บทบาทเดียวที่ข้ามองค์กรได้ (ADR-014 / SEC-PROV-001)
        // ผู้ดูแลของกรมคือบัญชี admin@gacp.go.th ที่สร้างแยกอยู่ข้างล่าง
        providerId: '6666666666666',
        firstName: 'ธนกร',
        lastName: 'ดูแลแพลตฟอร์ม',
        role: 'system_admin_platform',
        email: 'admin@gacpth.com',
        title: 'ผู้ดูแลระบบ (บริษัท)',
    },
    // NOTE (2026-07-09): COORDINATOR removed. It is NOT a canonical provider
    // role — `PROVIDER_CANONICAL_ROLES` (shared/canonical-rbac.js) has no
    // COORDINATOR entry and `normalizeRole('COORDINATOR')` returns null, so the
    // provider login rejects it with 403 INVALID_PROVIDER_ROLE. Seeding it
    // produced a dead account that could never authenticate (provider-ID carpet
    // UAT 2026-07-09). `seed-officer-roles-canonical.test.js` guards against a
    // non-canonical officer role being reintroduced here.
];

// Plant references are the platform's CLOSED vocabulary (config/plant-species-slugs.js:
// cannabis · kratom · turmeric · ginger · plai · black_galangal), not free text. The three
// fixtures below used to carry invented ids — 'plant-turmeric', 'plant-andrographis',
// 'plant-galingale' — none of which resolve: resolvePlantSpecies maps a slug or an
// upper-cased master code, and 'PLANT-TURMERIC' is neither. Certificate issuance is
// fail-closed on an unknown plant (CERTIFICATE_PLANT_UNKNOWN, 422), so `npm run seed`
// against a fresh database DIED here — which meant nobody could stand up a new environment
// from zero, and every walk had to be done on a database that already existed.
//
// They are all cannabis now, which is also the only crop the platform certifies today
// (cannabis-only, 2026-09-01). ฟ้าทะลายโจร in particular was never in the master at all.
const SAMPLE_APPLICATIONS = [
    {
        applicationNumber: 'APP-68-001',
        // 2026-09-05: เคยเป็น 'ASSIGNED_FOR_REVIEW' ซึ่งเขียนข้ามหน้างานของผู้จัดตาราง —
        // คำขอจึงค้างในที่ที่ไม่มีพนักงานคนไหนแตะได้: ผู้ตรวจเอกสารมองไม่เห็น (การมองเห็น
        // ผูกกับ "ถูกมอบหมายให้ฉัน") และผู้จัดตารางมอบหมายไม่ได้ (ประตูต้องการ DOC_FEE_PAID
        // แต่คำขอเลยจุดนั้นไปแล้ว) · เครื่องจริงสร้างสภาพนี้ไม่ได้ มีแต่ seed
        //
        // หยุดที่ DOC_FEE_PAID แทน แล้วปล่อยให้ผู้จัดตารางมอบหมายจริง — สภาพแวดล้อมที่ตั้งใหม่
        // จึงสาธิตโซ่การทำงานของพนักงานได้ แทนที่จะข้ามมันไป
        status: 'DOC_FEE_PAID',
        serviceType: 'CERTIFICATION',
        areaType: 'OUTDOOR',
        formData: {
            plantName: 'กัญชา (Cannabis)',
            plantId: 'cannabis',
            estimatedFee: PHASE_1_TOTAL_SINGLE_SCOPE,
            applicantData: { name: 'สมชาย เกษตรทอง' },
            locationData: { address: '99/1 หมู่ 5 ต.แม่แฝก อ.สันทราย จ.เชียงใหม่ 50210' },
        },
        phase1Amount: PHASE_1_TOTAL_SINGLE_SCOPE,
    },
    {
        applicationNumber: 'APP-68-002',
        status: 'APPROVED',
        serviceType: 'CERTIFICATION',
        areaType: 'GREENHOUSE',
        formData: {
            plantName: 'กัญชา (Cannabis)',
            plantId: 'cannabis',
            estimatedFee: PHASE_1_TOTAL_SINGLE_SCOPE,
            applicantData: { name: 'สมชาย เกษตรทอง' },
            locationData: { address: 'เชียงใหม่' },
        },
        phase1Amount: PHASE_1_TOTAL_SINGLE_SCOPE,
    },
    {
        applicationNumber: 'APP-68-003',
        // 2026-09-10 — เคยตั้งเป็น AUDIT_CONFIRMED โดยที่ auditorId เป็น NULL ซึ่งเป็น
        // สถานะที่สายงานจริงสร้างไม่ได้: AUDIT_CONFIRMED แปลว่ามีผู้ตรวจถูกมอบหมายแล้ว
        // ผลคือประตูมอบหมายปฏิเสธ (ต้องการ AUDIT_FEE_PAID) และประตูบันทึกผลตรวจก็ปฏิเสธ
        // (auditorId ไม่ตรงกับผู้ใช้) ⇒ ใบนี้เดินต่อไม่ได้เลยสักทาง
        //
        // หยุดที่ AUDIT_FEE_PAID แทน — จุดส่งไม้ก่อนผู้จัดสรรงานจัดคิว · เหตุผลเดียวกับ
        // APP-68-001 ข้างบน: ให้สภาพแวดล้อมที่ตั้งใหม่เดินโซ่พนักงานได้จริง
        // (ผู้จัดสรรงานมอบหมาย → ผู้ตรวจแปลงบันทึกผล → ผู้อนุมัติตัดสิน) แทนที่จะข้ามมันไป
        status: 'AUDIT_FEE_PAID',
        serviceType: 'CERTIFICATION',
        areaType: 'INDOOR',
        formData: {
            plantName: 'กัญชา (Cannabis)',
            plantId: 'cannabis',
            estimatedFee: PHASE_1_TOTAL_SINGLE_SCOPE,
            applicantData: { name: 'สมหญิง ปลูกดี' },
            // ที่ตั้งต้องเป็น "ข้อมูล" ไม่ใช่ข้อความยาวก้อนเดียว
            //
            // certificate-service หาแปลงของคำขอจาก formData (ชื่อแปลง หรือ จังหวัด+อำเภอ)
            // แล้วพิมพ์ตำบล/อำเภอ/จังหวัด ลงใบรับรองเป็นข้อเท็จจริงที่ถูกลงนาม · fixture เดิม
            // ให้มาแต่ address เป็นข้อความ ⇒ หาแปลงไม่เจอ แล้วไปตกที่การสร้างแปลงใหม่ ซึ่ง
            // ถูกปฏิเสธด้วย CERTIFICATE_FARM_LOCATION_MISSING (เจอตอนเดินประตูจริง 2026-09-10)
            locationData: { address: '45 หมู่ 3 ต.ท่าศาลา อ.เมืองเชียงใหม่ จ.เชียงใหม่' },
            // รูปแบบตาม กทล.๑ ส่วนที่ ๒ ซึ่งเป็นรูปที่ readFilingSite() อ่านจริง
            // (application-farm-materialization.js:105) — ไม่ใช่ locationData ที่เป็นข้อความ
            farmData: {
                siteName: 'แปลงสมหญิง ท่าศาลา',
                siteAddress: '45 หมู่ 3',
                subDistrict: 'ท่าศาลา',
                district: 'เมืองเชียงใหม่',
                province: 'เชียงใหม่',
                postalCode: '50000',
            },
        },
        phase1Amount: PHASE_1_TOTAL_SINGLE_SCOPE,
        // ค่าธรรมเนียมช่วงที่สอง ต้องถูกบันทึกว่าชำระแล้วจริง ไม่ใช่แค่ตั้งสถานะเป็น
        // AUDIT_FEE_PAID · ประตูจัดคิว (shared/phase2-schedule-gate.js) ถามสองอย่าง:
        // สถานะของคำขอ **และ** การชำระเงินช่วงที่สอง — ตั้งอย่างเดียวคือ fixture ที่ขัดกันเอง
        // ตัวเลขมาจาก feeService ไม่ใช่ค่าคงที่พิมพ์มือ (กฎ: ไม่ hardcode ราคาใน API)
        phase2Amount: PHASE_2_TOTAL_SINGLE_SCOPE,
        phase2Status: 'PAID',
    },
];


// ─── Onsite audit evidence (the visit the seeded certificate rests on) ───

/**
 * Where the seeded visit was recorded as taking place: the ERP fixture farm's
 * own sub-district (แม่แฝก, สันทราย, เชียงใหม่), to ~4 decimal places.
 *
 * These coordinates are a FIXTURE, and the row they land on says so at the only
 * strength it can: FarmAuditPhoto.farmDistanceStatus is computed by
 * audit-onsite-service.capturePhotoProvenance against the farm's registered
 * coordinates, and the seeded farm has none, so every seeded photograph records
 * FARM_LOCATION_UNKNOWN — "nobody established this", which is the truth. Giving
 * the farm coordinates here would turn that into MEASURED ~0 m and manufacture a
 * corroboration no one performed.
 */
const ONSITE_FIXTURE_GPS = Object.freeze({ latitude: 18.9563, longitude: 99.0197 });

/**
 * The photographs of the seeded visit: five, one per checklist section the photo
 * minimum stands for (GACP-PRD §6.5 "at least one photo per checklist section";
 * audit-onsite-service.DEFAULT_MIN_PHOTOS = 5 is that rule, counted).
 *
 * WHAT THESE FILES ARE, at the strength it can be defended. Each entry renders to
 * a labelled frame with its own geometry, so the five differ in BYTES and
 * therefore in SHA-256 — which is exactly the property the evidence gate counts
 * (onsite-evidence-gate counts DISTINCT fileHash, so five copies of one image
 * would count as one). That is the only property this seed guarantees.
 *
 * They are NOT five photographs of a farm, and no perceptual claim is made:
 * services/crypto/perceptual-hash.js records the measurement that fixture frames
 * of this family sit 8-11 bits apart while a mere re-encode of a single image
 * sits at 1-7, i.e. the two populations overlap almost completely. `composition`
 * varies the large-scale geometry rather than only the caption, which is the most
 * that can be done from a renderer — but if a future gate counts perceptually
 * distinct photographs, this seed SHOULD fail it, and the fix then is a real
 * photo set, not a cleverer generator.
 */
const ONSITE_PHOTO_FIXTURES = Object.freeze([
    {
        itemCode: '4.1',
        fileName: 'onsite-cultivation-plot.jpg',
        composition: 'PLOT_ROWS',
        label: 'แปลงปลูกขมิ้นชัน',
        caption: 'แปลงปลูกขมิ้นชัน ด้านทิศเหนือ (ภาพชุดข้อมูลตัวอย่าง)',
    },
    {
        itemCode: '6.1',
        fileName: 'onsite-post-harvest-drying.jpg',
        composition: 'DRYING_RACKS',
        label: 'ลานตากแห้ง',
        caption: 'ชั้นตากแห้งในโรงเรือนควบคุมอุณหภูมิ (ภาพชุดข้อมูลตัวอย่าง)',
    },
    {
        itemCode: '7.1',
        fileName: 'onsite-storage-room.jpg',
        composition: 'STORE_ROOM',
        label: 'ห้องจัดเก็บผลผลิต',
        caption: 'ห้องจัดเก็บผลผลิตแห้งและมีการควบคุมศัตรูพืช (ภาพชุดข้อมูลตัวอย่าง)',
    },
    {
        itemCode: '8.1',
        fileName: 'onsite-record-book.jpg',
        composition: 'RECORD_BOOK',
        label: 'แฟ้มบันทึกการปฏิบัติงาน',
        caption: 'แฟ้มบันทึกการปลูกและการใช้ปัจจัยการผลิต (ภาพชุดข้อมูลตัวอย่าง)',
    },
    {
        itemCode: '9.1',
        fileName: 'onsite-hygiene-station.jpg',
        composition: 'WASH_POINT',
        label: 'จุดล้างมือของผู้ปฏิบัติงาน',
        caption: 'จุดล้างมือและอุปกรณ์ป้องกันของผู้ปฏิบัติงาน (ภาพชุดข้อมูลตัวอย่าง)',
    },
]);

/**
 * The large-scale shapes that make one fixture frame differ from another by more
 * than its caption. Placed behind the caption plate, not inside it, because a
 * dhash downsamples to 8x8 — a difference confined to text disappears there,
 * which is precisely why the g4 photo set could not calibrate the perceptual
 * threshold (perceptual-hash.js, "WHAT COULD NOT BE MEASURED").
 */
function buildOnsitePhotoShapes(composition, hue) {
    const ink = `hsl(${hue},55%,26%)`;
    switch (composition) {
        case 'PLOT_ROWS':
            return Array.from({ length: 7 }, (_, i) =>
                `<rect x="0" y="${(110 * i) + 30}" width="1200" height="52" fill="${ink}" opacity="0.55"/>`).join('');
        case 'DRYING_RACKS':
            return Array.from({ length: 6 }, (_, i) =>
                `<rect x="${(190 * i) + 45}" y="90" width="120" height="620" rx="14" fill="${ink}" opacity="0.5"/>`).join('');
        case 'STORE_ROOM':
            return `<rect x="140" y="120" width="920" height="580" rx="18" fill="none" stroke="${ink}" stroke-width="52" opacity="0.6"/>`
                + `<rect x="430" y="360" width="340" height="340" fill="${ink}" opacity="0.55"/>`;
        case 'RECORD_BOOK':
            return `<circle cx="600" cy="400" r="300" fill="${ink}" opacity="0.5"/>`
                + `<rect x="330" y="640" width="540" height="70" fill="${ink}" opacity="0.65"/>`;
        case 'WASH_POINT':
            return `<polygon points="600,70 1120,700 80,700" fill="${ink}" opacity="0.5"/>`;
        default:
            return '';
    }
}

/**
 * Render one fixture photograph to JPEG bytes.
 *
 * `sharp` is required lazily so a box whose native binary is missing still gets
 * its accounts, applications and farm seeded before failing loudly on the
 * photographs — a partial fixture plus the real error beats no fixture at all,
 * and the seed exits non-zero either way rather than issuing a certificate with
 * nothing behind it.
 *
 * @param {object} fixture one entry of ONSITE_PHOTO_FIXTURES
 * @returns {Promise<Buffer>} JPEG bytes a human can open
 */
async function buildOnsitePhotoJpeg(fixture) {
    const sharp = require('sharp');

    // Hue derived from the caption so re-running the seed renders byte-identical
    // frames: uploadPhoto then answers DUPLICATE_PHOTO (the correct answer) instead
    // of adding a sixth row that is not a sixth photograph.
    let hash = 0;
    for (const ch of `${fixture.composition}:${fixture.label}`) { hash = ((hash * 31) + ch.charCodeAt(0)) >>> 0; }
    const hue = hash % 360;

    const svg = `<svg width="1200" height="900" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="hsl(${hue},45%,74%)"/>
          <stop offset="1" stop-color="hsl(${hue},50%,40%)"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="900" fill="url(#g)"/>
      ${buildOnsitePhotoShapes(fixture.composition, hue)}
      <rect x="0" y="760" width="1200" height="140" fill="rgba(255,255,255,0.9)"/>
      <text x="600" y="818" text-anchor="middle" font-family="Leelawadee UI, Tahoma, sans-serif"
            font-size="46" font-weight="bold" fill="#1a3a2a">${fixture.label}</text>
      <text x="600" y="868" text-anchor="middle" font-family="Leelawadee UI, Tahoma, sans-serif"
            font-size="26" fill="#41594c">ภาพชุดข้อมูลตัวอย่าง GACP ใช้สำหรับสาธิตและทดสอบระบบเท่านั้น</text>
    </svg>`;

    return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/**
 * Record the onsite visit for `applicationId` the way the field app records one.
 *
 * Every write goes through the product's own door: armOnsiteEvidence is the ONLY
 * function permitted to open an AuditChecklist row (enforced repo-wide by
 * __tests__/unit/audit-checklist-created-by-every-scheduling-door.test.js, which
 * scans the source and would fail on a seed that wrote the row itself), and the
 * checklist answers and photographs go through submitChecklistItem / uploadPhoto.
 * That is the point of this function: the evidence a demo certificate rests on is
 * written by the same code, and validated by the same rules, as the evidence a
 * real one rests on.
 *
 * Idempotent on a re-seed: arming returns the existing IN_PROGRESS audit, the
 * checklist upserts, and byte-identical photographs come back as DUPLICATE_PHOTO,
 * which means the photograph is already recorded.
 *
 * @param {object} args
 * @param {object} [args.prisma]        client or tx handle (default: the seed's own)
 * @param {string} args.applicationId   the application being inspected
 * @param {string} args.auditorId       the assigned onsite auditor (uploads + answers)
 * @param {string} args.organizationId
 * @param {Date}   [args.visitedAt]     when the visit happened
 * @returns {Promise<{auditId: string, photosRecorded: number, photosAlreadyRecorded: number, itemsAnswered: number}>}
 */
async function seedOnsiteAuditEvidence(args) {
    const {
        prisma: client = prisma,
        applicationId,
        auditorId,
        organizationId,
        visitedAt = new Date(),
    } = args || {};
    if (!applicationId) { throw new Error('seedOnsiteAuditEvidence: applicationId required'); }
    if (!auditorId) { throw new Error('seedOnsiteAuditEvidence: auditorId required'); }
    if (!organizationId) { throw new Error('seedOnsiteAuditEvidence: organizationId required'); }

    const armed = await armOnsiteEvidence(client, {
        applicationId,
        auditorId,
        organizationId,
        createdBy: auditorId,
        // The seeded visit is a visit. ONLINE_MEET arms nothing on purpose, and a
        // certificate resting on a meeting is what the gate exists to refuse.
        inspectionMode: 'ONSITE',
    });
    if (!armed.armed || !armed.auditChecklistId) {
        throw new Error(`seedOnsiteAuditEvidence: evidence chain not armed: ${armed.reason || 'ไม่ทราบสาเหตุ'}`);
    }
    const auditId = armed.auditChecklistId;

    // Checklist first, photographs second: uploadPhoto links a photo to the
    // checklist item it was taken for only when that item's row already exists.
    for (const item of onsiteService.CHECKLIST_TEMPLATE_2026) {
        await onsiteService.submitChecklistItem({
            auditId,
            itemCode: item.itemCode,
            response: 'PASS',
            notes: 'บันทึกจากชุดข้อมูลตัวอย่างสำหรับสาธิตและทดสอบระบบ',
            actorId: auditorId,
            prisma: client,
        });
    }

    let photosRecorded = 0;
    let photosAlreadyRecorded = 0;
    for (const fixture of ONSITE_PHOTO_FIXTURES) {
        const fileBuffer = await buildOnsitePhotoJpeg(fixture);
        try {
            await onsiteService.uploadPhoto({
                auditId,
                fileBuffer,
                fileName: fixture.fileName,
                mimeType: 'image/jpeg',
                gpsLat: ONSITE_FIXTURE_GPS.latitude,
                gpsLng: ONSITE_FIXTURE_GPS.longitude,
                capturedAt: visitedAt,
                caption: fixture.caption,
                checklistItemCode: fixture.itemCode,
                uploadedBy: auditorId,
                organizationId,
                prisma: client,
            });
            photosRecorded += 1;
        } catch (photoError) {
            // The same bytes on the same audit are refused by design — the gate counts
            // distinct photographs, so a second row would not be a second photograph.
            // On a re-seed that is the expected answer, not a failure.
            if (photoError && photoError.code === 'DUPLICATE_PHOTO') {
                photosAlreadyRecorded += 1;
                continue;
            }
            throw photoError;
        }
    }

    return {
        auditId,
        photosRecorded,
        photosAlreadyRecorded,
        itemsAnswered: onsiteService.CHECKLIST_TEMPLATE_2026.length,
    };
}
// ─── Main ────────────────────────────────────────────────

async function main() {
    console.log('GACP Thai — Consolidated Seed\n');

    // Upsert (not findUniqueOrThrow) so this seed is self-sufficient when
    // run on a fresh DB synced via `prisma db push` (which skips migration
    // SQL — including the INSERT in 20260427120000_add_organization_table).
    // In production where migrate deploy ran, the row already exists and
    // upsert's update path is a no-op.
    const defaultOrg = await prisma.organization.upsert({
        where: { slug: 'default' },
        update: {},
        create: {
            name: 'Default Organization',
            slug: 'default',
            code: 'DEFAULT',
            type: 'INTERNAL',
            isolationTier: 'SHARED',
            status: 'ACTIVE',
            createdBy: 'system',
        },
    });

    await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
    // ── 1. Applicants ────────────────────────────────────
    const applicantPw = await bcrypt.hash(PASSWORDS.APPLICANT, BCRYPT_ROUNDS);

    for (const a of APPLICANTS) {
        const user = await prisma.user.upsert({
            // healthId/providerId plaintext @unique were dropped in the PDPA
            // detokenize/encrypt work; resolve by the legacy *Hash unique the
            // create block below still sets.
            where: { healthIdHash: hashId(a.healthId) },
            // `role` is deliberately NOT in this clause — see
            // repairSeededUserRow above. The legacy spelling is repaired
            // below, guarded (W4 review round 2026-08-22).
            // `password` is deliberately NOT in this clause either — same rule as `role`,
            // for the same reason. A password on an existing account is a credential
            // someone holds, not a fixture; an unconditional update overwrote real users'
            // passwords on 2026-08-26 when this file was required by accident, and every
            // officer login in the pressed walk then failed with "รหัสผ่านไม่ถูกต้อง".
            // The fixture password is set once, on CREATE, and never again.
            update: {
                firstName: a.firstName,
                lastName: a.lastName,
            },
            create: {
                email: a.email,
                password: applicantPw,
                firstName: a.firstName,
                lastName: a.lastName,
                phoneNumber: a.phoneNumber,
                address: a.address,
                authType: 'HEALTH_ID',
                canonicalId: a.healthId,
                healthId: a.healthId,
                idCard: a.healthId,
                // คอลัมน์ค้นหาทั้งชุด — ถามที่เดียวกับประตูสมัครสมาชิก · เขียนแต่ *Hash เอง
                // เหมือนเดิม = สร้างบัญชีที่ล็อกอินไม่ได้บนเครื่องที่เปิด AUTH_LOOKUP_USE_HMAC
                ...identityLookupColumns(a.healthId, AUTH_TYPE_HEALTH),
                role: CANONICAL_ROLES.HEALTH,
                accountType: 'INDIVIDUAL',
                status: 'ACTIVE',
                isEmailVerified: true,
                ministryVerified: false,
                // organizationId is required NOT NULL since Phase D
                // (migration 20260429100000). The runWithTenantContext block
                // around this seed sets the AsyncLocalStorage context but
                // tenant-prisma-extension does not inject into upsert's
                // create payload — explicit pass is required here.
                organizationId: defaultOrg.id,
            },
        });
        const repaired = await repairSeededUserRow(user, CANONICAL_ROLES.HEALTH, defaultOrg.id);

        // Wave-B Phase-68 invariant: registration creates the applicant's
        // personal INDIVIDUAL entity in the SAME transaction as the user, so a
        // seeded applicant needs it too — findOrCreateApplicationForHealth
        // refuses to open a draft without one, which took every seeded farmer
        // out of the wizard at its first document upload (W4 2026-08-22).
        // Idempotent find-or-create: safe on every re-seed.
        //
        // Caught per account on purpose: one unrepairable row must not abort a
        // seed that still has the admin, the officers and every fixture left to
        // load. The failure is printed next to the account it belongs to, so it
        // is visible rather than fatal (W4 review round).
        let workspaceNote = '';
        try {
            const { entity, fresh } = await ensurePersonalIndividualEntity({ user: repaired.user });
            workspaceNote = ` — พื้นที่ทำงานส่วนบุคคล ${entity.id}${fresh ? ' (สร้างใหม่)' : ''}`;
        } catch (entityError) {
            workspaceNote = ` — [ข้าม] สร้างพื้นที่ทำงานส่วนบุคคลไม่สำเร็จ: ${entityError.message}`;
        }
        console.log(
            `ผู้ยื่นคำขอ: ${repaired.user.firstName} ${repaired.user.lastName} (${a.healthId})`
            + ` [${repaired.notes.join(', ')}]${workspaceNote}`,
        );
    }

    // ── 2. Admin ─────────────────────────────────────────
    const adminPw = await bcrypt.hash(PASSWORDS.ADMIN, BCRYPT_ROUNDS);

    const admin = await prisma.user.upsert({
        where: { providerIdHash: hashId(ADMIN.providerId) },
        // `role` deliberately absent — repaired below, guarded (see applicants).
        // `password` absent on purpose — see the applicant upsert for why.
        update: {
            firstName: ADMIN.firstName,
            lastName: ADMIN.lastName,
        },
        create: {
            email: ADMIN.email,
            password: adminPw,
            firstName: ADMIN.firstName,
            lastName: ADMIN.lastName,
            phoneNumber: ADMIN.phoneNumber,
            authType: 'PROVIDER_ID',
            canonicalId: ADMIN.providerId,
            providerId: ADMIN.providerId,
            idCard: ADMIN.providerId,
            ...identityLookupColumns(ADMIN.providerId, AUTH_TYPE_PROVIDER),
            role: CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
            accountType: 'PROVIDER',
            status: 'ACTIVE',
            ministryVerified: true,
            ministryVerifiedAt: new Date(),
            organizationId: defaultOrg.id,
        },
    });
    const adminRepaired = await repairSeededUserRow(admin, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, defaultOrg.id);
    console.log(`ผู้ดูแลระบบ: ${admin.firstName} ${admin.lastName} [${adminRepaired.notes.join(', ')}]`);

    // ── 3. Officers ──────────────────────────────────────
    const officerPw = await bcrypt.hash(PASSWORDS.OFFICER, BCRYPT_ROUNDS);

    for (const o of OFFICERS) {
        const officer = await prisma.user.upsert({
            where: { providerIdHash: hashId(o.providerId) },
            // `role` deliberately absent. This is the clause that would have
            // reverted an ACCOUNT_PLATFORM / ACCOUNT_DTAM row back to the legacy
            // union role 'account' on every re-seed — that split is an
            // audit-logged operator decision, not a fixture (W4 review round).
            // `password` absent on purpose — see the applicant upsert for why.
            update: {
                firstName: o.firstName,
                lastName: o.lastName,
            },
            create: {
                email: o.email,
                password: officerPw,
                firstName: o.firstName,
                lastName: o.lastName,
                authType: 'PROVIDER_ID',
                canonicalId: o.providerId,
                providerId: o.providerId,
                idCard: o.providerId,
                ...identityLookupColumns(o.providerId, AUTH_TYPE_PROVIDER),
                role: o.role,
                accountType: 'PROVIDER',
                status: 'ACTIVE',
                ministryVerified: true,
                ministryVerifiedAt: new Date(),
                organizationId: defaultOrg.id,
            },
        });
        const officerRepaired = await repairSeededUserRow(officer, o.role, defaultOrg.id);
        console.log(`${o.title}: ${o.firstName} ${o.lastName} [${officerRepaired.notes.join(', ')}]`);
    }

    // ── 4. Sample Applications ───────────────────────────
    const applicantHealthId = APPLICANTS[0].healthId;

    for (const app of SAMPLE_APPLICATIONS) {
        const hId = app.applicationNumber === 'APP-68-003'
            ? APPLICANTS[1].healthId
            : applicantHealthId;

        // Seed loads each SAMPLE_APPLICATIONS fixture straight at its pre-set
        // lifecycle status (see SAMPLE_APPLICATIONS[].status, seed-gacp.js:150+).
        // writeApplicationStatus() is a single-row RUNTIME transition guard
        // (from→to + assertTransition), not a fixture loader — it cannot place a
        // row at an arbitrary starting status. Keep the disable line-scoped +
        // justified (same convention as scripts/update-health1-certified.js:65)
        // so the bypass stays grep-visible and reviewable. The R1b concern was an
        // upsert the linter could NOT see at all; this one is documented on purpose.
        // eslint-disable-next-line gacp/no-direct-application-status-write
        await prisma.application.upsert({
            where: { applicationNumber: app.applicationNumber },
            update: {
                status: app.status,
                formData: app.formData,
                ...(app.phase2Status ? { phase2Status: app.phase2Status } : {}),
            },
            create: {
                applicationNumber: app.applicationNumber,
                healthId: hId,
                status: app.status,
                serviceType: app.serviceType,
                areaType: app.areaType,
                formData: app.formData,
                phase1Amount: app.phase1Amount,
                ...(app.phase2Amount != null ? { phase2Amount: app.phase2Amount } : {}),
                ...(app.phase2Status ? { phase2Status: app.phase2Status } : {}),
                organizationId: defaultOrg.id,
            },
        });
        console.log(`Application: ${app.applicationNumber} (${app.status})`);
    }

    // ── 5. ERP fixtures (Farm + Plots + PlantSpecies) ────
    // Required by scripts/test/validate-health-planting-flow.js.
    // The test logs in as APPLICANTS[0] and expects:
    //   GET /farms/my            → ≥1 farm (filters ownerId, isDeleted=false)
    //   GET /farms/:id/plots     → ≥2 plots (else creates a fallback)
    //   GET /plants              → ≥1 plant species
    //
    // Farm/Plot have no @@unique we can key on, so we derive deterministic
    // UUIDs from healthId (Farm) and farm-uuid + plot-name (Plot) and upsert
    // by `id`. seed-plants.js is NOT run in the erp-regression CI job, so we
    // also seed a minimal Turmeric (TUR) species inline. The fuller
    // plant-species catalogue (6 records) still lives in seed-plants.js for
    // the post-deploy hook.
    const erpApplicant = await prisma.user.findUnique({
        where: { healthIdHash: hashId(APPLICANTS[0].healthId) },
        select: { id: true, firstName: true, lastName: true },
    });
    if (!erpApplicant) {
        throw new Error(`ERP fixtures: applicant healthId=${APPLICANTS[0].healthId} not found`);
    }

    const farmId = deterministicUuid('erp-farm', APPLICANTS[0].healthId);
    const farm = await prisma.farm.upsert({
        where: { id: farmId },
        update: {
            farmName: 'แปลงทดสอบ ERP',
            status: 'APPROVED',
        },
        create: {
            id: farmId,
            ownerId: erpApplicant.id,
            farmName: 'แปลงทดสอบ ERP',
            farmType: 'CULTIVATION',
            // Realistic Chiang Mai (สันทราย) values — same district as the
            // applicant address in APPLICANTS[0].address above.
            address: '99/1 หมู่ 5',
            province: 'เชียงใหม่',
            district: 'สันทราย',
            subDistrict: 'แม่แฝก',
            postalCode: '50210',
            // Square metres, like every other write path on the platform.
            // 3,200 ตร.ม. is the SAME land this used to seed as `2` + 'rai';
            // only the way it is written down changed.
            //
            // This was the last place in the product that still wrote a legacy
            // unit. Migration 20260725190000_area_to_sqm converted the stored
            // rows and set the column default to 'sqm', but a seed that keeps
            // writing 'rai' re-creates the exact condition that migration
            // existed to end: every fresh demo or CI database was born with
            // legacy-unit rows, so no one could ever say "no non-sqm row
            // exists" — the precondition for retiring `areaUnit` at all.
            totalArea: 3200,
            cultivationArea: 3200,
            areaUnit: 'sqm',
            cultivationMethod: 'OUTDOOR',
            status: 'APPROVED',
            organizationId: defaultOrg.id,
        },
    });
    console.log(`Farm: ${farm.farmName} (owner=${erpApplicant.firstName} ${erpApplicant.lastName})`);

    // ผู้ยื่นคำขอคนที่สอง ต้องมีแปลงของตัวเองด้วย
    //
    // APP-68-003 เป็นของ APPLICANTS[1] (บรรทัด ~751) แต่ seed สร้างฟาร์มให้ APPLICANTS[0]
    // คนเดียว ⇒ พอเดินคำขอนั้นจนถึงการออกใบรับรอง มันตายที่
    // CERTIFICATE_FARM_LOCATION_MISSING — เจ้าของคำขอไม่มีที่ตั้งแปลงให้พิมพ์ลงใบ
    //
    // เจอตอนเดินประตูจริงครบสาย (ผู้จัดสรรงาน → ผู้ตรวจแปลง → ผู้อนุมัติ) เมื่อ 2026-09-10
    // เทสหน่วยมองไม่เห็น เพราะไม่มีตัวไหนออกใบรับรองจากคำขอของผู้ยื่นคนที่สอง
    const secondApplicant = await prisma.user.findUnique({
        where: { healthIdHash: hashId(APPLICANTS[1].healthId) },
        select: { id: true, firstName: true, lastName: true },
    });
    if (!secondApplicant) {
        throw new Error(`ERP fixtures: applicant healthId=${APPLICANTS[1].healthId} not found`);
    }
    const secondFarmId = deterministicUuid('erp-farm', APPLICANTS[1].healthId);
    const secondFarm = await prisma.farm.upsert({
        where: { id: secondFarmId },
        update: { farmName: 'แปลงสมหญิง ท่าศาลา', status: 'APPROVED' },
        create: {
            id: secondFarmId,
            ownerId: secondApplicant.id,
            farmName: 'แปลงสมหญิง ท่าศาลา',
            farmType: 'CULTIVATION',
            // อำเภอเดียวกับที่อยู่ของ APPLICANTS[1] ใน SAMPLE_APPLICATIONS
            address: '45 หมู่ 3',
            province: 'เชียงใหม่',
            district: 'เมืองเชียงใหม่',
            subDistrict: 'ท่าศาลา',
            postalCode: '50000',
            totalArea: 2400,
            cultivationArea: 2400,
            areaUnit: 'sqm',
            cultivationMethod: 'INDOOR',
            status: 'APPROVED',
            organizationId: defaultOrg.id,
        },
    });
    const secondPlotId = deterministicUuid('erp-plot', `${secondFarm.id}:แปลงในร่ม`);
    await prisma.plot.upsert({
        where: { id: secondPlotId },
        update: { name: 'แปลงในร่ม' },
        create: {
            id: secondPlotId,
            farmId: secondFarm.id,
            name: 'แปลงในร่ม',
            areaSqm: 2400,
            area: 2400,
            areaUnit: 'sqm',
            solarSystem: 'INDOOR',
            organizationId: defaultOrg.id,
        },
    });
    console.log(`Farm: ${secondFarm.farmName} (owner=${secondApplicant.firstName} ${secondApplicant.lastName})`);

    const plotsToSeed = [
        { name: 'แปลงเหนือ' },
        { name: 'แปลงใต้' },
    ];
    for (const p of plotsToSeed) {
        const plotId = deterministicUuid('erp-plot', `${farm.id}:${p.name}`);
        const plot = await prisma.plot.upsert({
            where: { id: plotId },
            update: { name: p.name },
            create: {
                id: plotId,
                farmId: farm.id,
                name: p.name,
                // 1,600 ตร.ม. — the same plot previously seeded as `1` + 'rai'.
                // See the farm above for why the unit is no longer written.
                areaSqm: 1600,
                // The retired pair, seeded from the same number so the previous
                // image can still read a freshly seeded database.
                area: 1600,
                areaUnit: 'sqm',
                solarSystem: 'OUTDOOR',
                organizationId: defaultOrg.id,
            },
        });
        // Backfill, not a re-issue. The upsert is keyed on a deterministic id, so a second
        // seed run over rows that already exist takes the `update` branch — and the extension
        // deliberately does not hook update, because replacing a code would orphan any sign
        // already printed with the old one. Rows seeded before plotCode existed would
        // therefore stay NULL forever, and the contract migration that makes the column
        // required would fail on exactly the data CI creates on every run.
        //
        // Filling a NULL is not replacing a code, so this is safe to do here and only here.
        if (!plot.plotCode) {
            const filled = await prisma.plot.update({
                where: { id: plot.id },
                data: { plotCode: generatePlotCode() },
            });
            console.log(`  └─ Plot: ${filled.name} (1,600 ตร.ม.) · ${filled.plotCode}`);
        } else {
            console.log(`  └─ Plot: ${plot.name} (1,600 ตร.ม.) · ${plot.plotCode}`);
        }
    }

    // Minimal Turmeric (TUR) species so /plants returns ≥1. The richer
    // catalogue (6 species + document requirements) is owned by
    // seed-plants.js and is not run in the ERP regression CI job.
    await prisma.plantSpecies.upsert({
        where: { code: 'TUR' },
        update: { isActive: true },
        create: {
            code: 'TUR',
            nameTH: 'ขมิ้นชัน',
            nameEN: 'Turmeric',
            group: 'GENERAL',
            requiresLicense: false,
            sortOrder: 3,
            isActive: true,
            gacpCategory: 'MEDICINAL',
        },
    });
    console.log('PlantSpecies: ขมิ้นชัน (TUR)');

    // ── 6. The onsite audit, and the certificate it entitles ─────
    //
    // The certificate is required downstream by:
    //   - createCycle()           — auto-links the latest active cert
    //                               for the farm; without one,
    //                               cycle.create throws "Active
    //                               certificate is required before
    //                               creating planting cycle"
    //                               (services/planting-service.js:192)
    //   - harvest-batches POST    — explicit cycle.certificateId guard
    //                               (routes/api/cultivation/
    //                                planting-cycles-activity-harvest-
    //                                routes.js:262)
    //
    // A SEED MAY NOT CREATE WHAT THE PRODUCT ITSELF CANNOT.
    //
    // This block used to end in a direct `certificate.upsert` — the only door in
    // the repository to a Certificate row that met no gate. An adversarial review
    // on 2026-08-26 enumerated every path in the tree that ends in such a row and
    // found exactly two: certificate-service.generateCertificate, which sits
    // behind assertOnsiteEvidenceSufficient and which every route, hook, handler
    // and script funnels through, and this one.
    //
    // Signing the row (fixed earlier the same day) made it verifiable, not true.
    // It still asserted that this farm had passed an onsite audit that nobody
    // carried out, and to anyone reading the database — or scanning its QR — it
    // was indistinguishable from a certificate that had. The signature made that
    // assertion harder to forge, which is not the same as making it correct.
    //
    // So the seed now records the VISIT and lets the product decide. It arms the
    // evidence chain through the one function allowed to open an audit, answers
    // the 24-item checklist through submitChecklistItem, uploads five distinct
    // photographs through uploadPhoto, and then asks generateCertificate for a
    // certificate exactly like every other caller. If the evidence is short the
    // gate refuses, and the seed stops with the gate's own message instead of
    // writing the row anyway. A demo dataset that wants an active certificate has
    // to seed what entitles it to one.
    //
    // WHAT THE SEED STILL DOES NOT DO: it does not call submitDecision. That door
    // is a runtime transition guard (AUDIT_CONFIRMED -> AUDIT_PASSED) and cannot
    // place a fixture at an arbitrary starting status — the same reason the
    // application upsert above carries a line-scoped eslint-disable. The pass is
    // therefore recorded through the JSON path generateCertificate already reads
    // (formData.auditResult + auditedAt, certificate-service.js:264-271), and the
    // audit row stays IN_PROGRESS, which is also what lets a re-seed re-answer the
    // checklist. The evidence the gate counts is identical either way.
    const thaiGacpStandard = await prisma.certificationStandard.upsert({
        where: { code: 'THAI_GACP' },
        update: { isActive: true },
        create: {
            code: 'THAI_GACP',
            name: 'Thai GACP',
            nameTH: 'มาตรฐาน GACP ไทย',
            description: 'Good Agricultural and Collection Practices for Thai herbal crops.',
            version: 'v2024',
            isActive: true,
            sortOrder: 1,
        },
    });
    // The certificate no longer reads this row: generateCertificate writes its own
    // standard fields (certificate-service.js:424-425). It stays because it is the
    // catalogue row the ERP regression job needs to be self-sufficient without
    // seed-plants.js / seed-standards.js, which own the fuller catalogue.
    console.log(`CertificationStandard: ${thaiGacpStandard.code} (${thaiGacpStandard.nameTH})`);

    const erpApplication = await prisma.application.findUnique({
        where: { applicationNumber: 'APP-68-002' },
        select: { id: true },
    });
    if (!erpApplication) {
        throw new Error('ERP fixtures: APP-68-002 (APPROVED sample) not found — needed to anchor the ERP certificate');
    }

    // ISO/IEC 17065 §7.6 — ผู้ที่เดินเข้าแปลง ไม่ใช่ผู้ที่ตัดสินให้การรับรอง
    // ค้นด้วยอีเมล ไม่ใช่ลำดับในอาร์เรย์ การสลับลำดับ OFFICERS จึงสลับสองบทบาทนี้ไม่ได้
    //
    // 2026-09-10 — คนที่สองเคยเป็น auditor2@gacp.go.th ที่ถือ role 'auditor' เหมือนคนแรก
    // โดยอาศัยแค่ "เป็นคนละ id" เป็นด่าน · ตอนนี้เขาถือบทบาท certificate_approver ของตัวเอง
    // และอีเมลเปลี่ยนตามงานเป็น approver@gacp.go.th
    const fieldInspectorFixture = OFFICERS.find((o) => o.email === 'inspector@gacp.go.th');
    const certificateApproverFixture = OFFICERS.find((o) => o.email === 'approver@gacp.go.th');
    if (!fieldInspectorFixture || !certificateApproverFixture) {
        throw new Error('ERP fixtures: ผู้ตรวจประเมินแปลง / ผู้อนุมัติใบรับรอง missing from OFFICERS');
    }
    const fieldInspector = await prisma.user.findUnique({
        where: { providerIdHash: hashId(fieldInspectorFixture.providerId) },
        select: { id: true, firstName: true, lastName: true },
    });
    const certificateApprover = await prisma.user.findUnique({
        where: { providerIdHash: hashId(certificateApproverFixture.providerId) },
        select: { id: true },
    });
    if (!fieldInspector || !certificateApprover) {
        throw new Error('ERP fixtures: seeded auditor accounts not found — the onsite audit has no one to record it');
    }

    const visitedAt = new Date();
    const evidence = await seedOnsiteAuditEvidence({
        prisma,
        applicationId: erpApplication.id,
        auditorId: fieldInspector.id,
        organizationId: defaultOrg.id,
        visitedAt,
    });
    console.log(
        `Onsite audit: ${evidence.auditId} โดย ${fieldInspector.firstName} ${fieldInspector.lastName}`
        + ` (ภาพใหม่ ${evidence.photosRecorded} รูป, มีอยู่แล้ว ${evidence.photosAlreadyRecorded} รูป,`
        + ` รายการตรวจ ${evidence.itemsAnswered} ข้อ)`,
    );

    // Repair, not tidying. A database seeded before this change holds GACP-ERP-<n>:
    // an ACTIVE certificate that no evidence entitled it to. generateCertificate
    // REUSES any live certificate for an application, so leaving that row standing
    // would make this whole change a no-op on exactly the datasets where the bad
    // row lives. It is voided through the product's own revocation door — status
    // 'revoked' with forensic who/why/when, soft-deleted so the issuance dedupe
    // frees a fresh mint — rather than deleted, because a certificate that was
    // issued is a fact and what changed is that it is withdrawn.
    //
    // Scoped to the certificate number this seed itself used to write, and only
    // when it is the newest live one: a properly issued GACP-TH-... certificate is
    // never touched, and generateCertificate simply reuses it below.
    const liveCert = await prisma.certificate.findFirst({
        where: { applicationId: erpApplication.id, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true, certificateNumber: true },
    });
    if (liveCert && String(liveCert.certificateNumber || '').startsWith('GACP-ERP-')) {
        await certificateService.revokeCertificateForApplication(erpApplication.id, {
            revokedBy: 'system-seed',
            reason: 'ใบรับรองชุดข้อมูลตัวอย่างที่ออกโดยไม่มีหลักฐานการตรวจประเมินในพื้นที่ ระบบจึงเพิกถอนและออกใบใหม่ผ่านการตรวจสอบหลักฐานตามปกติ',
            prisma,
        });
        console.log(`Certificate: ${liveCert.certificateNumber} ถูกเพิกถอน (ออกโดยไม่มีหลักฐานการตรวจในพื้นที่)`);
    }

    // The audit-pass record generateCertificate requires (certificate-service.js:264).
    // Read-modify-write, and it must run AFTER arming: armOnsiteEvidence has just
    // pinned formData.onsiteAuditId, and a blob captured before that write would
    // roll the pin back, leaving the gate to re-resolve instead of verifying the
    // audit this pass was recorded against. It must also run after the revocation
    // above, which deliberately clears the pass record it finds.
    const erpAppRow = await prisma.application.findUnique({
        where: { id: erpApplication.id },
        select: { formData: true },
    });
    const erpFormData = (erpAppRow && typeof erpAppRow.formData === 'object' && erpAppRow.formData)
        ? erpAppRow.formData
        : {};
    await prisma.application.update({
        where: { id: erpApplication.id },
        data: {
            formData: {
                ...erpFormData,
                // Which farm this application is about. resolveFarmForCertificate reads
                // formData.farmId first; without it issuance invents a fresh "Certified
                // Farm", and the certificate would then belong to a farm that is not the
                // one createCycle() looks at — leaving the ERP flow exactly as blocked as
                // it is with no certificate at all.
                farmId: farm.id,
                auditResult: 'PASS',
                auditedAt: visitedAt.toISOString(),
            },
        },
    });

    // ผู้ประเมินและผู้ตัดสิน ต้องถูกบันทึกไว้บนแถวคำขอ ไม่ใช่แค่บนบันทึกการตรวจ
    //
    // ด่านแยกหน้าที่ (services/certification-decision-separation.js) อ่าน
    // Application.auditorId กับ Application.headAuditorId เป็นแหล่งความจริง · ก่อนหน้านี้
    // seed ปล่อยทั้งสองคอลัมน์เป็น NULL ⇒ ใบที่ seed สร้างจะถูกปฏิเสธด้วย EVALUATOR_UNKNOWN
    // ตลอดไป ("ไม่มีบันทึกว่าใครประเมิน จึงพิสูจน์การแยกหน้าที่ไม่ได้")
    await prisma.application.update({
        where: { id: erpApplication.id },
        data: { auditorId: fieldInspector.id, headAuditorId: certificateApprover.id },
    });

    const erpCertificate = await certificateService.generateCertificate(
        erpApplication.id,
        certificateApprover.id,
        { prisma },
    );
    // The gate above proves the evidence; this proves the certificate landed on the
    // farm the ERP flow uses. A mismatch is silent otherwise: every row would look
    // right and createCycle would still refuse.
    if (erpCertificate.farmId !== farm.id) {
        throw new Error(
            `ERP fixtures: certificate ${erpCertificate.certificateNumber} was issued against farm `
            + `${erpCertificate.farmId}, not the ERP farm ${farm.id} — createCycle() would still refuse`,
        );
    }
    console.log(`Certificate: ${erpCertificate.certificateNumber} (${erpCertificate.status}, expires ${erpCertificate.expiryDate.toISOString().slice(0, 10)})`);

    // ── Summary ──────────────────────────────────────────
    console.log('\n GACP Thai Seed Complete!');
    console.log('━'.repeat(58));
    console.log('\n Test Accounts:');
    console.log('┌──────────────────────────┬───────────────┬──────────────┐');
    console.log('│ บทบาท                    │ ID            │ รหัสผ่าน     │');
    console.log('├──────────────────────────┼───────────────┼──────────────┤');
    for (const a of APPLICANTS) {
        console.log(`│ ผู้ยื่นคำขอ              │ ${a.healthId}│ ${PASSWORDS.APPLICANT}  │`);
    }
    console.log(`│ ผู้ดูแลระบบ (Admin)      │ ${ADMIN.providerId}│ ${PASSWORDS.ADMIN}  │`);
    for (const o of OFFICERS) {
        const t = o.title.substring(0, 24).padEnd(24);
        console.log(`│ ${t}│ ${o.providerId}│ ${PASSWORDS.OFFICER}   │`);
    }
    console.log('└──────────────────────────┴───────────────┴──────────────┘');
    });
}

// Exported for __tests__/unit/seed-certificate-rests-on-real-evidence.test.js, which
// runs the evidence step against an in-memory client and then asks the REAL gate
// (services/onsite-evidence-gate.js) whether what the seed wrote is sufficient — the
// only way to prove the seeded certificate goes through the gate without running the
// seed against a database. Exporting is safe precisely because of the guard below:
// requiring this file seeds nothing, and the test exercises that too.
module.exports = {
    ONSITE_FIXTURE_GPS,
    ONSITE_PHOTO_FIXTURES,
    buildOnsitePhotoJpeg,
    seedOnsiteAuditEvidence,
};

// SEEDING IS SOMETHING YOU RUN, NOT SOMETHING THAT HAPPENS BECAUSE YOU READ THIS FILE.
//
// This call used to sit at module scope with no guard, so `require('./seed-gacp')` — the
// ordinary way to inspect a module's exports, or to check that it parses — seeded whatever
// DATABASE_URL happened to point at. On 2026-08-26 that is exactly what occurred: a worker
// required this file to read its column names and it wrote to the shared Supabase dataset,
// adding 3 users, 3 applications, 2 plots, and a certificate — GACP-ERP-100012, status
// active, signature NULL, because the seed then wrote that row with a direct upsert instead
// of going through generateCertificate, its fail-closed signing path and its evidence gate.
// Section 6 above no longer has such a door; the history is kept because it is why this guard
// exists.
//
// The guard costs one line. Without it, every `require` of this file is a write to a live
// database, and reading a file is not supposed to be a destructive act.
if (require.main === module) {
    main()
        .catch((e) => {
            console.error('Seed error:', e);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
} else {
    console.warn(
        '[seed-gacp] required as a module — NOT seeding. Run it directly (node prisma/seed-gacp.js) if that is what you meant.',
    );
}
