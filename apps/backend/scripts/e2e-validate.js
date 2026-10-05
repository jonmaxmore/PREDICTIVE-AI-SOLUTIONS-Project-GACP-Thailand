/**
 * Comprehensive E2E Validation Script
 * Tests all renamed modules load correctly without runtime errors
 */
const path = require('path');
const results = { pass: 0, fail: 0, errors: [] };

/**
 * The Prisma schema is a FOLDER, not a file.
 *
 * These checks used to read prisma/schema.prisma, which was deleted on 2026-03-12 when the
 * schema became a prismaSchemaFolder (prisma/schema/, 31 files). readFileSync then threw
 * ENOENT and four checks reported FAILED — not because the schema was wrong, but because
 * the validator was looking in a place that no longer exists. A check that fails for a
 * reason unrelated to what it asserts is worse than no check: it trains the reader to
 * ignore red.
 *
 * Reading every .prisma file and joining them gives the same text the old single file did,
 * so the assertions below are unchanged.
 */
function readPrismaSchema() {
    const dir = path.join(__dirname, '..', 'prisma', 'schema');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.prisma')).sort();
    if (files.length === 0) {
        throw new Error(`no .prisma files under ${dir} — the schema folder is empty or has moved`);
    }
    return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}


function test(name, fn) {
    try {
        fn();
        results.pass++;
        console.log(`${name}`);
    } catch (e) {
        results.fail++;
        results.errors.push({ name, error: e.message });
        console.log(`${name}: ${e.message}`);
    }
}

console.log('\n=== 1. MODULE LOADING ===\n');

test('canonical-rbac.js loads', () => {
    const rbac = require('../shared/canonical-rbac');
    if (!rbac.CANONICAL_ROLES) {throw new Error('Missing CANONICAL_ROLES');}
    if (!rbac.normalizeRole) {throw new Error('Missing normalizeRole');}
    if (!rbac.isProviderRole) {throw new Error('Missing isProviderRole');}
    if (rbac.CANONICAL_ROLES.Applicant) {throw new Error('Applicant still in CANONICAL_ROLES!');}
});

test('canonical-rbac normalizeRole works', () => {
    const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
    // แผนที่ปิด — คำปัจจุบันแปลเป็นตัวมันเอง
    for (const r of Object.values(CANONICAL_ROLES)) {
        if (normalizeRole(r) !== r) {throw new Error(`${r}→${normalizeRole(r)} (แผนที่ไม่ปิด)`);}
    }
    // คำที่ปลดระวางแล้วต้องแปลไม่ออก (operator 2026-09-10 "เลิกใช้ของเก่า")
    for (const r of ['health', 'admin', 'account', 'auditor', 'scheduler', 'platform_admin']) {
        if (normalizeRole(r) !== null) {throw new Error(`${r} ควรแปลไม่ออก แต่ได้ ${normalizeRole(r)}`);}
    }
});

test('canonical-rbac isProviderRole works', () => {
    const { isProviderRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
    if (isProviderRole(CANONICAL_ROLES.HEALTH)) {throw new Error('ผู้ขอรับรองไม่ใช่เจ้าหน้าที่');}
    for (const r of [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
        CANONICAL_ROLES.DISPATCHER, CANONICAL_ROLES.FIELD_INSPECTOR,
        CANONICAL_ROLES.CERTIFICATE_APPROVER, CANONICAL_ROLES.DOCUMENT_REVIEWER,
        CANONICAL_ROLES.FINANCE_OFFICER_DTAM, CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]) {
        if (!isProviderRole(r)) {throw new Error(`${r} ควรเป็นเจ้าหน้าที่`);}
    }
});

test('role-middleware.js loads', () => {
    const m = require('../middleware/role-middleware');
    if (!m.healthOnly) {throw new Error('Missing healthOnly');}
    if (!m.healthOrProvider) {throw new Error('Missing healthOrProvider');}
    if (!m.providerOnly) {throw new Error('Missing providerOnly');}
    if (m.ApplicantOnly) {throw new Error('ApplicantOnly still exported!');}
    if (m.ApplicantOrprovider) {throw new Error('ApplicantOrPROVIDER still exported!');}
});

test('zod-schemas.js loads', () => {
    const z = require('../shared/zod-schemas');
    if (!z.PROVIDERLoginSchema) {throw new Error('Missing PROVIDERLoginSchema');}
});

test('constants.js loads', () => {
    const c = require('../shared/constants');
    if (!c) {throw new Error('Missing constants');}
});

console.log('\n=== 2. ROUTE MODULE LOADING ===\n');

const routeModules = [
    'routes/api/applications',
    'routes/api/invoices',
    'routes/api/audits',
    'routes/api/audits-reassign',
    'routes/api/harvest-batches',
    'routes/api/tickets',
    'routes/api/public',
    'routes/api/preview',
    'routes/api/quotes',
    'routes/api/admin/users',
    'routes/api/admin/applications',
    'routes/api/provider',
    'routes/api/provider/applications',
    'routes/api/provider/head-auditor',
];

for (const mod of routeModules) {
    test(`${mod} loads`, () => {
        require(path.join('..', mod));
    });
}

console.log('\n=== 3. HANDLER MODULES ===\n');

const handlers = [
    'routes/api/provider/handlers/workflow-transitions-handler',
    'routes/api/provider/handlers/workflow-revision-expirations-handler',
    'routes/api/provider/handlers/auditor-audit-decision-handler',
    'routes/api/provider/handlers/auditor-inspection-start-handler',
    'routes/api/provider/handlers/scheduler-audit-schedules-post-handler',
];

for (const h of handlers) {
    test(`${h} loads`, () => {
        require(path.join('..', h));
    });
}

console.log('\n=== 4. SERVICE MODULES ===\n');

const services = [
    'services/certificate-service',
    'services/invoice-service',
    'services/notification-service',
    'services/pdf/certificate-template-service',
    'services/pdf/audit-report-service',
    'services/pdf/car-report-service',
    'services/security-compliance',
    'services/media/signature-service',
];

for (const s of services) {
    test(`${s} loads`, () => {
        require(path.join('..', s));
    });
}

console.log('\n=== 5. JOB MODULES ===\n');

test('sla-processor.js loads', () => {
    require('../jobs/sla-processor');
});

console.log('\n=== 6. NO LEGACY REFERENCES ===\n');

const fs = require('fs');
function checkFile(fp, patterns) {
    if (!fs.existsSync(fp)) {return;}
    const content = fs.readFileSync(fp, 'utf8');
    for (const p of patterns) {
        if (content.includes(p)) {throw new Error(`Found "${p}" in ${path.basename(fp)}`);}
    }
}

test('canonical-rbac has no Applicant in CANONICAL_ROLES', () => {
    const fp = path.join(__dirname, '..', 'shared', 'canonical-rbac.js');
    const c = fs.readFileSync(fp, 'utf8');
    // Check CANONICAL_ROLES section only
    const section = c.split('CANONICAL_ROLES')[1].split('}')[0];
    if (section.includes('Applicant')) {throw new Error('Applicant still in CANONICAL_ROLES');}
});

test('role-middleware has no ApplicantOnly', () => {
    checkFile(path.join(__dirname, '..', 'middleware', 'role-middleware.js'), ['ApplicantOnly', 'ApplicantOrPROVIDER']);
});

test('schema has no DTAMPROVIDER model', () => {
    const c = readPrismaSchema();
    if (c.includes('model DTAMPROVIDER')) {throw new Error('DTAMPROVIDER model still exists');}
});

test('schema role default is HEALTH', () => {
    const c = readPrismaSchema();
    if (!c.includes('@default("HEALTH")')) {throw new Error('Role default is not HEALTH');}
});

test('schema Application relation is applicant', () => {
    const c = readPrismaSchema();
    // Match the model by its OPENING BRACE, not by name prefix. Plain
    // `split('model Application')` also matches `model ApplicationDocument`,
    // `model ApplicationRevision` and every other sibling that starts with the
    // same word — and once the schema became a folder read as one string, one
    // of those came first and this check read the wrong model's body, then
    // reported the Application model as missing a relation it has had all along
    // (application.prisma:13).
    const match = c.match(/model\s+Application\s*\{([\s\S]*?)\n\}/);
    if (!match) { throw new Error('model Application not found in the schema'); }
    const appSection = match[1];
    if (appSection.includes('Applicant   User')) {throw new Error('Application still has Applicant relation');}
    if (!appSection.includes('applicant')) {throw new Error('Application missing applicant relation');}
});

test('schema Certificate has applicantName', () => {
    const c = readPrismaSchema();
    if (c.includes('ApplicantName String')) {throw new Error('ApplicantName column still exists');}
    if (!c.includes('applicantName String')) {throw new Error('applicantName column missing');}
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`\n  RESULTS: ${results.pass} passed, ${results.fail} failed\n`);
if (results.errors.length > 0) {
    console.log('  FAILURES:');
    results.errors.forEach(e => console.log(`    - ${e.name}: ${e.error}`));
}
console.log('');
process.exit(results.fail > 0 ? 1 : 0);
