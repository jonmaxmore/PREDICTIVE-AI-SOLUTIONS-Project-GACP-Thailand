#!/usr/bin/env node
/**
 * heal-null-holders — ใส่ผู้ถือ (entityId) ให้คำขอและฟาร์มเก่าที่ยังว่าง ตามกฎ spec §3.5
 * (design note 2026-09-30-remove-workspace-mode-design · ขั้น D1 ของ runbook
 * docs/operations/runbooks/2026-09-30-remove-workspace-mode.md)
 *
 * ทำไมต้องมี: หลัง R2 การอ่านฝั่งผู้ยื่นตามสมาชิกภาพของผู้ถือเท่านั้น แถวที่ entityId ว่าง
 * จะไม่มีใครเห็น จึงต้องเติมก่อนสลับ — การเติมเป็นการเพิ่มข้อมูล โค้ดเก่าทนได้
 *
 * กฎ (ไม่มีการเดา — แถวที่กฎวางไม่ได้ไปอยู่ในรายการให้ operator ตัดสิน):
 *   คำขอ: formData.applicantType เป็น INDIVIDUAL หรือไม่ระบุ และผู้ยื่น (healthId → User)
 *         มีสมาชิกภาพ OWNER ที่ ACTIVE บน Entity ชนิด INDIVIDUAL (ไม่ถูกลบ) อยู่หนึ่งเดียวพอดี
 *   ฟาร์ม: entityId ของคำขอที่ใบรับรองระบุฟาร์มนี้ (Certificate.farmId) ถ้าไม่ว่าง ไม่ขัดกัน
 *         และเจ้าของฟาร์มมีสมาชิกภาพ ACTIVE บน entity นั้น — ถ้าไม่ ACTIVE = วางไม่ได้ (operator ตัดสิน
 *         ไม่ตกไปหา entity ส่วนตัว เพราะบริษัทถือใบรับรอง ไม่ใช่บุคคล — operator 2026-09-07)
 *         ฟาร์มที่ไม่มีผู้ถือจากใบรับรองเลย ใช้ Entity ส่วนตัวหนึ่งเดียวของเจ้าของฟาร์ม (Farm.ownerId)
 *   วางไม่ได้: คำขอ DRAFT → UNPLACED_DRAFT_DELETE_ON_OPERATOR_WORD (ลบเมื่อ operator สั่ง, Q2)
 *              อื่นๆ ทั้งหมด → UNPLACED_OPERATOR_DECIDES (operator ตัดสินรายแถว)
 *   ฟาร์มไม่ใช้ป้าย DRAFT: ฟาร์มถูกสร้างเป็น DRAFT และส่วนใหญ่อยู่อย่างนั้นตลอด
 *   (services/farm-service.js:241) ป้าย "ลบได้" กับฟาร์มจึงชวนลบของที่ใช้งานอยู่
 *
 * planHeal ไม่เขียนอะไรเลย · applyHeal เขียนเฉพาะแถวที่คอลัมน์ยังว่าง ณ ตอนเขียน
 * (updateMany where { id, entityId: null }) — ผู้ถือที่ถูกเติมระหว่าง plan กับ apply ไม่ถูกทับ
 *
 * ต้อง export DATABASE_URL ในเชลล์เดียวกับคำสั่ง — ค่าที่มาจากไฟล์ .env ถูกปฏิเสธ (snapshot ตอนเริ่ม
 * ก่อน require @prisma/client) และ client ถูกตรึงกับ url นั้นตรงๆ
 *
 *   node scripts/heal-null-holders.js --db-label=staging
 *       ดูอย่างเดียว → evidence/heal-null-holders/<label>-<db>-<ISO>-plan.csv
 *       บรรทัดแรก: "# heal-null-holders plan label=<label> db=<fingerprint 8 hex> rows=<n>"
 *   node scripts/heal-null-holders.js --apply --db-label=staging --plan=<ไฟล์แผนที่ตรวจแล้ว>
 *       operator เท่านั้น · ปฏิเสธก่อนต่อฐานถ้าไม่มี --plan/--db-label, label ไม่ตรงแผน หรือ
 *       ลายนิ้วมือฐาน (sha256 ของ user@host:port/db ไม่รวมรหัสผ่าน) ไม่ตรงแผน · วางแผนใหม่แล้ว
 *       เทียบรายแถว (table,id,chosenEntityId,rule) — ต่างแม้แถวเดียว = ปฏิเสธ ไม่เขียนอะไร (exit 3)
 *       → <label>-<db>-<ISO>-applied-rollback.csv = เฉพาะแถวที่รอบนี้เขียนจริง (count===1)
 *
 * ไม่พิมพ์ connection string หรือส่วนใดของมัน — พิมพ์ได้แค่ลายนิ้วมือ 8 ตัวที่ย้อนกลับไม่ได้
 */

'use strict';

// Snapshot before anything else is required: @prisma/client loads a .env file into
// process.env when DATABASE_URL is missing, and that value must never be the target.
const STARTUP_ENV = Object.freeze({ DATABASE_URL: process.env.DATABASE_URL });

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RULES = Object.freeze({
    APP_FILER_SINGLE_PERSONAL_ENTITY: 'APP_FILER_SINGLE_PERSONAL_ENTITY',
    FARM_CERTIFICATE_APPLICATION_ENTITY: 'FARM_CERTIFICATE_APPLICATION_ENTITY',
    FARM_OWNER_SINGLE_PERSONAL_ENTITY: 'FARM_OWNER_SINGLE_PERSONAL_ENTITY',
    UNPLACED_DRAFT_DELETE_ON_OPERATOR_WORD: 'UNPLACED_DRAFT_DELETE_ON_OPERATOR_WORD',
    UNPLACED_OPERATOR_DECIDES: 'UNPLACED_OPERATOR_DECIDES',
});

const TABLES = Object.freeze({ applications: 'application', farms: 'farm' });
const CSV_COLUMNS = ['table', 'id', 'status', 'chosenEntityId', 'rule', 'evidence'];
const EVIDENCE_DIR = path.resolve(__dirname, '..', '..', '..', 'evidence', 'heal-null-holders');
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DB_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

const uniq = (list) => [...new Set(list.filter(Boolean))];

function unplaced({ table, status, evidence }) {
    const draft = table === 'applications' && String(status || '').toUpperCase() === 'DRAFT';
    return {
        chosenEntityId: null,
        rule: draft ? RULES.UNPLACED_DRAFT_DELETE_ON_OPERATOR_WORD : RULES.UNPLACED_OPERATOR_DECIDES,
        evidence,
    };
}

/**
 * @param {{ status?: string, applicantType?: unknown, personalEntityIds: string[] }} input
 * @returns {{ chosenEntityId: string|null, rule: string, evidence: string }}
 */
function decideApplicationHolder({ status, applicantType, personalEntityIds }) {
    const declared = applicantType === null || applicantType === undefined ? '' : String(applicantType).trim().toUpperCase();
    const declaredText = declared || 'absent';
    const candidates = uniq(personalEntityIds || []);
    if (declared && declared !== 'INDIVIDUAL') {
        return unplaced({ table: 'applications', status, evidence: `applicantType=${declaredText}: not INDIVIDUAL` });
    }
    const evidence = `applicantType=${declaredText}; filer OWNER INDIVIDUAL ACTIVE memberships=${candidates.length}`
        + (candidates.length ? ` [${candidates.join(' ')}]` : '');
    if (candidates.length !== 1) {
        return unplaced({ table: 'applications', status, evidence });
    }
    return { chosenEntityId: candidates[0], rule: RULES.APP_FILER_SINGLE_PERSONAL_ENTITY, evidence };
}

/**
 * The certificate rule chooses only an entity on which the farm owner holds an
 * ACTIVE membership (`ownerActiveEntityIds`, any role, entity not deleted); a
 * missing list counts as none, so the rule fails closed. When the owner is not
 * active there the farm is unplaced (final review I2 + re-review): the personal
 * rule applies only to a farm with no certificate holder at all.
 * @param {{ status?: string, certificateEntityIds: string[], personalEntityIds: string[], ownerActiveEntityIds?: string[], certificateNumbers?: string[] }} input
 * @returns {{ chosenEntityId: string|null, rule: string, evidence: string }}
 */
function decideFarmHolder({ status, certificateEntityIds, personalEntityIds, ownerActiveEntityIds = [], certificateNumbers = [] }) {
    const fromCertificates = uniq(certificateEntityIds || []);
    const personal = uniq(personalEntityIds || []);
    const ownerActive = new Set(uniq(ownerActiveEntityIds || []));
    const certText = `certificate application holders=${fromCertificates.length}`
        + (fromCertificates.length ? ` [${fromCertificates.join(' ')}]` : '')
        + (certificateNumbers.length ? ` via ${uniq(certificateNumbers).join(' ')}` : '');
    if (fromCertificates.length > 1) {
        return unplaced({ table: 'farms', status, evidence: `${certText}: two or more candidates` });
    }
    if (fromCertificates.length === 1) {
        if (ownerActive.has(fromCertificates[0])) {
            return { chosenEntityId: fromCertificates[0], rule: RULES.FARM_CERTIFICATE_APPLICATION_ENTITY, evidence: certText };
        }
        // A certified farm is never handed to a person while a company holds its
        // certificate (operator 2026-09-07): the operator decides, not the personal rule.
        return unplaced({ table: 'farms', status, evidence: `${certText}: owner not ACTIVE on ${fromCertificates[0]}` });
    }
    const evidence = `${certText}; owner OWNER INDIVIDUAL ACTIVE memberships=${personal.length}`
        + (personal.length ? ` [${personal.join(' ')}]` : '');
    if (personal.length !== 1) {
        return unplaced({ table: 'farms', status, evidence });
    }
    return { chosenEntityId: personal[0], rule: RULES.FARM_OWNER_SINGLE_PERSONAL_ENTITY, evidence };
}

/** userId → entity ids of every ACTIVE membership (any role, entity not deleted). Read only. */
async function activeEntitiesByUser(prisma, userIds) {
    const ids = uniq(userIds);
    const map = new Map(ids.map((id) => [id, []]));
    if (!ids.length) { return map; }
    const memberships = await prisma.entityMembership.findMany({
        where: { userId: { in: ids }, status: 'ACTIVE', entity: { isDeleted: false } },
        select: { userId: true, entityId: true },
    });
    for (const m of memberships) { map.get(m.userId).push(m.entityId); }
    return map;
}

/** userId → personal entity ids (OWNER, ACTIVE, INDIVIDUAL, entity not deleted). Read only. */
async function personalEntitiesByUser(prisma, userIds) {
    const ids = uniq(userIds);
    const map = new Map(ids.map((id) => [id, []]));
    if (!ids.length) { return map; }
    const memberships = await prisma.entityMembership.findMany({
        where: { userId: { in: ids }, role: 'OWNER', status: 'ACTIVE', entity: { type: 'INDIVIDUAL', isDeleted: false } },
        select: { userId: true, entityId: true },
    });
    for (const m of memberships) { map.get(m.userId).push(m.entityId); }
    return map;
}

/**
 * Build the heal plan. READ ONLY — issues findMany and nothing else.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<{ rows: Array<{ table: 'applications'|'farms', id: string, status: string|null, chosenEntityId: string|null, rule: string, evidence: string }> }>}
 */
async function planHeal(prisma) {
    const [applications, farms] = await Promise.all([
        prisma.application.findMany({
            where: { entityId: null }, select: { id: true, status: true, healthId: true, formData: true }, orderBy: { id: 'asc' },
        }),
        prisma.farm.findMany({
            where: { entityId: null }, select: { id: true, status: true, ownerId: true }, orderBy: { id: 'asc' },
        }),
    ]);

    const filers = applications.length
        ? await prisma.user.findMany({
            where: { canonicalId: { in: uniq(applications.map((a) => a.healthId)) } },
            select: { id: true, canonicalId: true },
        })
        : [];
    const userIdByCanonical = new Map(filers.map((u) => [u.canonicalId, u.id]));

    const certificates = farms.length
        ? await prisma.certificate.findMany({
            where: { farmId: { in: farms.map((f) => f.id) } },
            select: { farmId: true, certificateNumber: true, application: { select: { entityId: true } } },
        })
        : [];

    const personal = await personalEntitiesByUser(prisma, [
        ...filers.map((u) => u.id),
        ...farms.map((f) => f.ownerId),
    ]);
    const ownerActive = await activeEntitiesByUser(prisma, farms.map((f) => f.ownerId));

    const rows = [];
    for (const a of applications) {
        const filerId = userIdByCanonical.get(a.healthId);
        const formData = a.formData && typeof a.formData === 'object' && !Array.isArray(a.formData) ? a.formData : {};
        const decision = decideApplicationHolder({
            status: a.status,
            applicantType: formData.applicantType,
            personalEntityIds: filerId ? personal.get(filerId) : [],
        });
        rows.push({
            table: 'applications', id: a.id, status: a.status ?? null, ...decision,
            evidence: filerId ? decision.evidence : `filer not found; ${decision.evidence}`,
        });
    }
    for (const f of farms) {
        const naming = certificates.filter((c) => c.farmId === f.id && c.application && c.application.entityId);
        const decision = decideFarmHolder({
            status: f.status,
            certificateEntityIds: naming.map((c) => c.application.entityId),
            certificateNumbers: naming.map((c) => c.certificateNumber),
            personalEntityIds: personal.get(f.ownerId) || [],
            ownerActiveEntityIds: ownerActive.get(f.ownerId) || [],
        });
        rows.push({ table: 'farms', id: f.id, status: f.status ?? null, ...decision });
    }
    return { rows };
}

/**
 * Write the placed rows of a plan. Only a column that is still NULL is written,
 * so a holder filled after the plan is never overwritten. Unplaced rows are
 * never touched.
 * @returns {Promise<{ updated: Array<{table,id,entityId}>, skipped: Array<{table,id,reason}> }>}
 */
async function applyHeal(prisma, plan) {
    const updated = [];
    const skipped = [];
    for (const row of (plan && plan.rows) || []) {
        if (!row.chosenEntityId) { continue; }
        const model = TABLES[row.table];
        if (!model) { throw new Error(`unknown table in plan: ${row.table}`); }
        const { count } = await prisma[model].updateMany({
            where: { id: row.id, entityId: null },
            data: { entityId: row.chosenEntityId },
        });
        if (count === 1) {
            updated.push({ table: row.table, id: row.id, entityId: row.chosenEntityId });
        } else {
            skipped.push({ table: row.table, id: row.id, reason: 'ALREADY_FILLED' });
        }
    }
    return { updated, skipped };
}

function parseArgs(argv) {
    const out = { apply: false, dbLabel: null, plan: null };
    for (const arg of argv) {
        if (arg === '--apply') { out.apply = true; continue; }
        if (arg.startsWith('--db-label=')) {
            const label = arg.slice('--db-label='.length);
            if (!DB_LABEL_PATTERN.test(label)) {
                throw new Error('--db-label must be lower-case letters, digits and dashes (max 40)');
            }
            out.dbLabel = label;
            continue;
        }
        if (arg.startsWith('--plan=')) {
            const plan = arg.slice('--plan='.length);
            if (!plan) { throw new Error('--plan needs a path to the reviewed dry-run CSV'); }
            out.plan = plan;
            continue;
        }
        throw new Error(`unknown argument: ${arg} (allowed: --apply, --db-label=<name>, --plan=<dry-run csv>)`);
    }
    return out;
}

/**
 * Which database a url points at, as 8 hex chars: sha256 of user@host:port/db.
 * The user part is kept because on the Supabase pooler the project ref lives in
 * the user name (postgres.<ref>) and the host is shared. The password is never
 * hashed in, and nothing here can be turned back into the url.
 */
function dbFingerprint(url) {
    const parsed = new URL(url);
    return crypto.createHash('sha256')
        .update(`${parsed.username}@${parsed.hostname}:${parsed.port}${parsed.pathname}`)
        .digest('hex').slice(0, 8);
}

/** A file-name label for the target DB. Never returns any part of the url. */
function dbLabelFor(url, explicit = null) {
    if (explicit) { return explicit; }
    if (!url) { return 'unknown'; }
    let parsed;
    try { parsed = new URL(url); } catch { return 'unknown'; }
    if (LOOPBACK_HOSTS.has(parsed.hostname)) { return 'local'; }
    return `remote-${dbFingerprint(url)}`;
}

function csvField(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns = CSV_COLUMNS) {
    const lines = [columns.join(',')];
    for (const row of rows) { lines.push(columns.map((c) => csvField(row[c])).join(',')); }
    return `${lines.join('\n')}\n`;
}

/** Minimal RFC-4180 reader for the files toCsv writes ('#' lines are headers). */
function parseCsv(text) {
    const records = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') { quoted = false; } else { field += ch; }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === ',') {
            row.push(field); field = '';
        } else if (ch === '\n') {
            row.push(field); records.push(row); row = []; field = '';
        } else if (ch !== '\r') {
            field += ch;
        }
    }
    if (field || row.length) { row.push(field); records.push(row); }
    return records;
}

const PLAN_HEADER = /^# heal-null-holders plan label=([a-z0-9-]+) db=([0-9a-f]{8}) rows=(\d+)$/;

/** Read a dry-run plan file. Throws on anything that is not one. */
function readPlanFile(file) {
    const text = fs.readFileSync(file, 'utf8');
    const newline = text.indexOf('\n');
    const header = PLAN_HEADER.exec(newline === -1 ? text : text.slice(0, newline));
    if (!header) { throw new Error('--plan is not a heal-null-holders dry-run plan (first line does not match)'); }
    const [columns, ...records] = parseCsv(text.slice(newline + 1));
    if (!columns || columns.join(',') !== CSV_COLUMNS.join(',')) { throw new Error('--plan has unexpected columns'); }
    const rows = records.map((r) => Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, r[i] ?? ''])));
    if (rows.length !== Number(header[3])) { throw new Error('--plan row count does not match its header'); }
    return { label: header[1], fingerprint: header[2], rows };
}

const COMPARED = ['table', 'id', 'chosenEntityId', 'rule'];
const keyOf = (r) => COMPARED.map((c) => (r[c] === null || r[c] === undefined ? '' : String(r[c]))).join('|');

/** Row-for-row difference between the reviewed plan and a fresh one: ids only. */
function diffPlans(reviewed, fresh) {
    const a = new Map(reviewed.map((r) => [`${r.table}|${r.id}`, keyOf(r)]));
    const b = new Map(fresh.map((r) => [`${r.table}|${r.id}`, keyOf(r)]));
    const differ = [];
    for (const [k, v] of b) { if (a.get(k) !== v) { differ.push(k); } }
    for (const k of a.keys()) { if (!b.has(k)) { differ.push(k); } }
    return differ.sort();
}

function countByRule(rows) {
    const counts = {};
    for (const r of rows) { counts[`${r.table} ${r.rule}`] = (counts[`${r.table} ${r.rule}`] || 0) + 1; }
    return counts;
}

function connectTo(url) {
    // Loaded only after the startup check, and pinned to the url that check saw:
    // whatever @prisma/client may read from a .env file is never the target.
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient({ datasources: { db: { url } } });
}

/**
 * CLI. Exit codes: 0 ok · 2 refused before connecting · 3 the database no
 * longer matches the reviewed plan (nothing written) · 1 failure.
 */
async function main(argv, deps = {}) {
    const {
        env = STARTUP_ENV,
        connect = connectTo,
        planHeal: plan = planHeal,
        applyHeal: apply = applyHeal,
        evidenceDir = EVIDENCE_DIR,
        now = () => new Date(),
        out = { log: (m) => console.log(m), error: (m) => console.error(m) },
    } = deps;
    const refuse = (message) => { out.error(`ปฏิเสธ (ยังไม่ได้ต่อฐานข้อมูล): ${message}`); return 2; };

    let args;
    try { args = parseArgs(argv); } catch (error) { return refuse(error.message); }

    // (a) Only a DATABASE_URL that was in the process environment when this script
    // started counts. A value a .env file supplies later is not the operator's choice.
    const url = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
    if (!url) {
        return refuse('DATABASE_URL must be exported in this shell before the command (a .env file is never used)');
    }
    let fingerprint;
    try { fingerprint = dbFingerprint(url); } catch { return refuse('DATABASE_URL is not a valid url'); }

    // (b) + Important 1: --apply is bound to the reviewed plan, its label and its database.
    let reviewed = null;
    if (args.apply) {
        if (!args.plan) { return refuse('--apply needs --plan=<the dry-run CSV you reviewed>'); }
        if (!args.dbLabel) { return refuse('--apply needs --db-label=<the label of that dry run>'); }
        try { reviewed = readPlanFile(args.plan); } catch (error) { return refuse(error.message); }
        if (reviewed.fingerprint !== fingerprint) {
            return refuse(`database fingerprint ${fingerprint} is not the one the plan was made on (${reviewed.fingerprint})`);
        }
        if (reviewed.label !== args.dbLabel) {
            return refuse(`--db-label=${args.dbLabel} but the plan was made for ${reviewed.label}`);
        }
    }

    const label = args.dbLabel || dbLabelFor(url);
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const base = path.join(evidenceDir, `${label}-${fingerprint}-${stamp}`);
    const prisma = connect(url);
    try {
        const fresh = await plan(prisma);
        out.log(`ฐานข้อมูล: ${label} (db=${fingerprint}) · แถวผู้ถือว่าง ${fresh.rows.length} แถว`);
        for (const [key, n] of Object.entries(countByRule(fresh.rows))) { out.log(`  ${key}: ${n}`); }

        if (!args.apply) {
            fs.mkdirSync(evidenceDir, { recursive: true });
            const planPath = `${base}-plan.csv`;
            fs.writeFileSync(planPath,
                `# heal-null-holders plan label=${label} db=${fingerprint} rows=${fresh.rows.length}\n${toCsv(fresh.rows)}`);
            out.log(`แผน (dry run): ${planPath}`);
            out.log('ดูอย่างเดียว — ไม่เขียนฐานข้อมูล · ตรวจไฟล์แผนแล้วให้ operator รัน --apply --plan=<ไฟล์นี้>');
            return 0;
        }

        const differ = diffPlans(reviewed.rows, fresh.rows);
        if (differ.length) {
            out.error(`ปฏิเสธ (ยังไม่เขียนอะไร): ฐานข้อมูลเปลี่ยนไปจากแผนที่ตรวจแล้ว ${differ.length} แถว — ทำ dry run ใหม่แล้วตรวจอีกรอบ`);
            for (const k of differ) { out.error(`  ${k}`); }
            return 3;
        }

        const result = await apply(prisma, fresh);
        // Important 2: the rollback list is what this run wrote, and nothing else.
        fs.mkdirSync(evidenceDir, { recursive: true });
        const rollbackPath = `${base}-applied-rollback.csv`;
        fs.writeFileSync(rollbackPath,
            `# heal-null-holders ROLLBACK LIST label=${label} db=${fingerprint} written=${result.updated.length}`
            + ` (only rows this run set; set entityId back to NULL for these rows only)\n`
            + toCsv(result.updated, ['table', 'id', 'entityId']));
        out.log(`เขียนแล้ว ${result.updated.length} แถว · รายการย้อนกลับ: ${rollbackPath}`);
        out.log(`ข้าม ${result.skipped.length} แถว (ถูกเติมไปก่อนแล้ว ไม่ได้เขียน ไม่อยู่ในรายการย้อนกลับ)`);
        const left = fresh.rows.filter((r) => !r.chosenEntityId).length;
        out.log(`วางไม่ได้ ${left} แถว — รอ operator ตัดสินตามแผน (ไม่มีการลบใดๆ จากสคริปต์นี้)`);
        return 0;
    } finally {
        await prisma.$disconnect().catch(() => {});
    }
}

module.exports = {
    RULES,
    decideApplicationHolder,
    decideFarmHolder,
    planHeal,
    applyHeal,
    parseArgs,
    dbFingerprint,
    dbLabelFor,
    toCsv,
    readPlanFile,
    diffPlans,
    main,
};

if (require.main === module) {
    main(process.argv.slice(2))
        .then((code) => { process.exit(code); })
        .catch((error) => { console.error(`ล้มเหลว: ${error.message}`); process.exit(1); });
}
