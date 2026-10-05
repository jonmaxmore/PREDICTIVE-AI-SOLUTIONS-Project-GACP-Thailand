'use strict';

/**
 * heal-null-holders — the placement rules of spec §3.5 and the CLI's safety
 * switches, as pure functions (remove-workspace-mode Task 7).
 *
 * The real-Postgres half (dry run writes nothing, --apply fills only NULL
 * columns) is __tests__/integration/heal-null-holders-real-postgres.test.js.
 */

const {
    decideApplicationHolder,
    decideFarmHolder,
    parseArgs,
    dbLabelFor,
    toCsv,
    RULES,
} = require('../../scripts/heal-null-holders');

describe('application rule (spec §3.5)', () => {
    test('INDIVIDUAL declared + filer has exactly one OWNER INDIVIDUAL membership → that entity', () => {
        const d = decideApplicationHolder({ status: 'SUBMITTED', applicantType: 'INDIVIDUAL', personalEntityIds: ['e1'] });
        expect(d.chosenEntityId).toBe('e1');
        expect(d.rule).toBe(RULES.APP_FILER_SINGLE_PERSONAL_ENTITY);
    });

    test.each([[undefined], [null], [''], ['  ']])('absent applicantType (%p) counts as INDIVIDUAL', (applicantType) => {
        const d = decideApplicationHolder({ status: 'DRAFT', applicantType, personalEntityIds: ['e1'] });
        expect(d.chosenEntityId).toBe('e1');
        expect(d.rule).toBe(RULES.APP_FILER_SINGLE_PERSONAL_ENTITY);
    });

    test('lower-case individual is the same declaration', () => {
        expect(decideApplicationHolder({ status: 'DRAFT', applicantType: 'individual', personalEntityIds: ['e1'] }).chosenEntityId).toBe('e1');
    });

    test.each([['JURISTIC'], ['COMMUNITY_ENTERPRISE'], ['COMMUNITY'], ['something-else']])(
        '%s declared → unplaced, even when the filer has one personal entity',
        (applicantType) => {
            const d = decideApplicationHolder({ status: 'SUBMITTED', applicantType, personalEntityIds: ['e1'] });
            expect(d.chosenEntityId).toBeNull();
            expect(d.rule).toBe(RULES.UNPLACED_OPERATOR_DECIDES);
            expect(d.evidence).toContain(String(applicantType).toUpperCase());
        },
    );

    test('two candidate personal entities → unplaced', () => {
        const d = decideApplicationHolder({ status: 'SUBMITTED', applicantType: 'INDIVIDUAL', personalEntityIds: ['e1', 'e2'] });
        expect(d.chosenEntityId).toBeNull();
        expect(d.rule).toBe(RULES.UNPLACED_OPERATOR_DECIDES);
        expect(d.evidence).toContain('2');
    });

    test('no candidate (filer missing or no personal entity) → unplaced', () => {
        expect(decideApplicationHolder({ status: 'SUBMITTED', applicantType: null, personalEntityIds: [] }).chosenEntityId).toBeNull();
    });

    test('unplaced DRAFT → UNPLACED_DRAFT_DELETE_ON_OPERATOR_WORD; non-draft → UNPLACED_OPERATOR_DECIDES (Q2)', () => {
        expect(decideApplicationHolder({ status: 'DRAFT', applicantType: 'JURISTIC', personalEntityIds: [] }).rule)
            .toBe('UNPLACED_DRAFT_DELETE_ON_OPERATOR_WORD');
        expect(decideApplicationHolder({ status: 'CERTIFIED', applicantType: 'JURISTIC', personalEntityIds: [] }).rule)
            .toBe('UNPLACED_OPERATOR_DECIDES');
    });
});

describe('farm rule (spec §3.5)', () => {
    test("the certificate's application entityId wins over the owner's personal entity", () => {
        const d = decideFarmHolder({
            certificateEntityIds: ['company'], personalEntityIds: ['personal'], ownerActiveEntityIds: ['company', 'personal'],
        });
        expect(d.chosenEntityId).toBe('company');
        expect(d.rule).toBe(RULES.FARM_CERTIFICATE_APPLICATION_ENTITY);
    });

    test('several certificates naming the same entity still place it', () => {
        expect(decideFarmHolder({ certificateEntityIds: ['c', 'c'], personalEntityIds: [], ownerActiveEntityIds: ['c'] }).chosenEntityId)
            .toBe('c');
    });

    // Final review I2 (2026-10-03): the certificate rule may only choose an entity on
    // which the farm owner holds an ACTIVE membership; otherwise the next rule decides.
    // Re-review minor (2026-10-03): a certified farm is never handed to a person while its
    // certificate is held by a company (operator 2026-09-07) — the operator decides instead.
    test("the certificate's entity where the owner is NOT an active member → unplaced, never the owner's personal entity", () => {
        const d = decideFarmHolder({
            certificateEntityIds: ['company'], personalEntityIds: ['personal'], ownerActiveEntityIds: ['personal'],
        });
        expect(d.chosenEntityId).toBeNull();
        expect(d.rule).toBe(RULES.UNPLACED_OPERATOR_DECIDES);
        expect(d.evidence).toMatch(/certificate application holders=1 \[company\]/);
        expect(d.evidence).toMatch(/owner not ACTIVE on company/);
    });

    test("the certificate's entity where the owner is not active, and no personal entity → unplaced", () => {
        const d = decideFarmHolder({ certificateEntityIds: ['company'], personalEntityIds: [], ownerActiveEntityIds: [] });
        expect(d.chosenEntityId).toBeNull();
        expect(d.rule).toBe(RULES.UNPLACED_OPERATOR_DECIDES);
    });

    test('ownerActiveEntityIds missing → the certificate rule never chooses (fail closed)', () => {
        const d = decideFarmHolder({ certificateEntityIds: ['company'], personalEntityIds: [] });
        expect(d.chosenEntityId).toBeNull();
    });

    test('certificates naming two different entities → unplaced (two candidates)', () => {
        const d = decideFarmHolder({ certificateEntityIds: ['c1', 'c2'], personalEntityIds: ['p'] });
        expect(d.chosenEntityId).toBeNull();
        expect(d.rule).toBe(RULES.UNPLACED_OPERATOR_DECIDES);
    });

    test('no certificate entity → the single personal entity of the owner', () => {
        const d = decideFarmHolder({ certificateEntityIds: [], personalEntityIds: ['p'] });
        expect(d.chosenEntityId).toBe('p');
        expect(d.rule).toBe(RULES.FARM_OWNER_SINGLE_PERSONAL_ENTITY);
    });

    test('no certificate entity and two personal entities → unplaced', () => {
        expect(decideFarmHolder({ certificateEntityIds: [], personalEntityIds: ['p1', 'p2'] }).chosenEntityId).toBeNull();
    });

    test('nothing at all → unplaced, operator decides (a farm DRAFT is not a deletable draft)', () => {
        const d = decideFarmHolder({ certificateEntityIds: [], personalEntityIds: [] });
        expect(d.chosenEntityId).toBeNull();
        expect(d.rule).toBe(RULES.UNPLACED_OPERATOR_DECIDES);
    });
});

describe('CLI switches', () => {
    test('default is a dry run', () => {
        expect(parseArgs([])).toEqual({ apply: false, dbLabel: null, plan: null });
    });

    test('--apply only when spelled exactly', () => {
        expect(parseArgs(['--apply']).apply).toBe(true);
        for (const near of ['apply', '--aply', '--apply=true', '--APPLY', '-a']) {
            expect(() => parseArgs([near])).toThrow(/unknown argument/i);
        }
    });

    test('--db-label=<name> is accepted and sanitised', () => {
        expect(parseArgs(['--db-label=staging']).dbLabel).toBe('staging');
        expect(() => parseArgs(['--db-label=../x'])).toThrow(/db-label/i);
    });
});

describe('db label never prints the url', () => {
    const SECRET = 's3cr3t-pw';
    test('loopback → local', () => {
        expect(dbLabelFor(`postgresql://u:${SECRET}@127.0.0.1:5432/x`)).toBe('local');
        expect(dbLabelFor(`postgresql://u:${SECRET}@localhost:5432/x`)).toBe('local');
    });

    test('an explicit label wins', () => {
        expect(dbLabelFor(`postgresql://u:${SECRET}@db.example.test:5432/x`, 'demo')).toBe('demo');
    });

    test('a remote host without a label becomes a fingerprint that holds no part of the url', () => {
        const url = `postgresql://postgres.abcref:${SECRET}@pooler.example.test:6543/postgres`;
        const label = dbLabelFor(url);
        expect(label).toMatch(/^remote-[0-9a-f]{8}$/);
        for (const part of ['abcref', SECRET, 'pooler', 'example', '6543']) {
            expect(label).not.toContain(part);
        }
        expect(dbLabelFor(url)).toBe(label);
    });

    test('missing url → unknown', () => {
        expect(dbLabelFor(undefined)).toBe('unknown');
    });
});

describe('csv', () => {
    test('header + quoted fields', () => {
        const csv = toCsv([{ table: 'applications', id: 'a1', status: 'DRAFT', chosenEntityId: null, rule: 'R', evidence: 'x, "y"' }]);
        const lines = csv.trim().split('\n');
        expect(lines[0]).toBe('table,id,status,chosenEntityId,rule,evidence');
        expect(lines[1]).toBe('applications,a1,DRAFT,,R,"x, ""y"""');
    });
});

// ── Round 1 (review 2026-10-03): the CLI may only write to the database the operator
// reviewed. Every refusal below happens before a connection is opened.
describe('main() — refusals and the dry-run path (fakes, no database)', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { main, dbFingerprint } = require('../../scripts/heal-null-holders');

    const URL_A = 'postgresql://postgres.refaaa:pw-a@pooler.example.test:6543/postgres';
    const URL_B = 'postgresql://postgres.refbbb:pw-b@pooler.example.test:6543/postgres';
    const ROWS = [
        { table: 'applications', id: 'a1', status: 'DRAFT', chosenEntityId: 'e1', rule: RULES.APP_FILER_SINGLE_PERSONAL_ENTITY, evidence: 'x, "y"' },
        { table: 'farms', id: 'f1', status: 'DRAFT', chosenEntityId: null, rule: RULES.UNPLACED_OPERATOR_DECIDES, evidence: 'none' },
        { table: 'farms', id: 'f2', status: 'DRAFT', chosenEntityId: 'e2', rule: RULES.FARM_OWNER_SINGLE_PERSONAL_ENTITY, evidence: 'p' },
    ];

    let dir;
    let lines;
    function harness({ url = URL_A, rows = ROWS, applyResult } = {}) {
        const fake = { $disconnect: jest.fn(async () => {}) };
        const deps = {
            env: url === null ? {} : { DATABASE_URL: url },
            connect: jest.fn(() => fake),
            planHeal: jest.fn(async () => ({ rows: rows.map((r) => ({ ...r })) })),
            applyHeal: jest.fn(async () => applyResult || { updated: [], skipped: [] }),
            evidenceDir: dir,
            now: () => new Date('2026-10-03T01:02:03.004Z'),
            out: { log: (m) => lines.push(m), error: (m) => lines.push(m) },
        };
        return deps;
    }
    const filesIn = () => fs.readdirSync(dir).sort();
    const allOutput = () => lines.join('\n');

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-cli-'));
        lines = [];
    });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    async function dryRun(deps, label = 'staging') {
        expect(await main([`--db-label=${label}`], deps)).toBe(0);
        const plan = filesIn().find((f) => f.endsWith('.csv'));
        return path.join(dir, plan);
    }

    test('DATABASE_URL absent from the startup environment → refused, never connects', async () => {
        const deps = harness({ url: null }); // null = key absent (undefined would take the default)
        expect(await main([], deps)).toBe(2);
        expect(deps.connect).not.toHaveBeenCalled();
        expect(allOutput()).toMatch(/DATABASE_URL/);
    });

    test('DATABASE_URL empty → refused, never connects', async () => {
        const deps = harness({ url: '   ' });
        expect(await main([], deps)).toBe(2);
        expect(deps.connect).not.toHaveBeenCalled();
    });

    test('dry run: plans, writes the plan CSV with the db fingerprint, never reaches applyHeal', async () => {
        const deps = harness();
        const planPath = await dryRun(deps);
        expect(deps.connect).toHaveBeenCalledWith(URL_A);
        expect(deps.planHeal).toHaveBeenCalledTimes(1);
        expect(deps.applyHeal).not.toHaveBeenCalled();
        const fp = dbFingerprint(URL_A);
        expect(path.basename(planPath)).toBe(`staging-${fp}-2026-10-03T01-02-03-004Z-plan.csv`);
        const text = fs.readFileSync(planPath, 'utf8');
        expect(text.split('\n')[0]).toBe(`# heal-null-holders plan label=staging db=${fp} rows=3`);
        expect(text).not.toContain('refaaa');
        expect(text).not.toContain('pw-a');
        expect(allOutput()).not.toMatch(/refaaa|pw-a|pooler/);
    });

    test('--apply without --plan → refused, never connects', async () => {
        const deps = harness();
        expect(await main(['--apply', '--db-label=staging'], deps)).toBe(2);
        expect(deps.connect).not.toHaveBeenCalled();
        expect(allOutput()).toMatch(/--plan/);
    });

    test('--apply without --db-label → refused, never connects', async () => {
        const planPath = await dryRun(harness());
        const deps = harness();
        expect(await main(['--apply', `--plan=${planPath}`], deps)).toBe(2);
        expect(deps.connect).not.toHaveBeenCalled();
    });

    test('--apply against a different database than the plan was made on → refused before connecting', async () => {
        const planPath = await dryRun(harness({ url: URL_A }));
        const deps = harness({ url: URL_B });
        expect(await main(['--apply', '--db-label=staging', `--plan=${planPath}`], deps)).toBe(2);
        expect(deps.connect).not.toHaveBeenCalled();
        expect(deps.applyHeal).not.toHaveBeenCalled();
        expect(allOutput()).toMatch(/fingerprint/i);
        expect(allOutput()).not.toMatch(/refaaa|refbbb|pw-/);
    });

    test('--apply whose --db-label differs from the plan label → refused before connecting', async () => {
        const planPath = await dryRun(harness(), 'staging');
        const deps = harness();
        expect(await main(['--apply', '--db-label=demo', `--plan=${planPath}`], deps)).toBe(2);
        expect(deps.connect).not.toHaveBeenCalled();
    });

    test('--apply when the re-plan differs from the reviewed plan → refused, applyHeal never called', async () => {
        const planPath = await dryRun(harness());
        const changed = ROWS.map((r) => (r.id === 'f1' ? { ...r, chosenEntityId: 'e9', rule: RULES.FARM_OWNER_SINGLE_PERSONAL_ENTITY } : r));
        const deps = harness({ rows: changed });
        expect(await main(['--apply', '--db-label=staging', `--plan=${planPath}`], deps)).toBe(3);
        expect(deps.applyHeal).not.toHaveBeenCalled();
        expect(allOutput()).toMatch(/f1/);
    });

    test('--apply when the re-plan has an extra row → refused', async () => {
        const planPath = await dryRun(harness());
        const deps = harness({ rows: [...ROWS, { table: 'farms', id: 'f3', status: 'DRAFT', chosenEntityId: null, rule: RULES.UNPLACED_OPERATOR_DECIDES, evidence: '' }] });
        expect(await main(['--apply', '--db-label=staging', `--plan=${planPath}`], deps)).toBe(3);
        expect(deps.applyHeal).not.toHaveBeenCalled();
    });

    test('--apply on a matching plan writes the rollback list from result.updated only (ALREADY_FILLED excluded)', async () => {
        const planPath = await dryRun(harness());
        const deps = harness({
            applyResult: {
                updated: [{ table: 'applications', id: 'a1', entityId: 'e1' }],
                skipped: [{ table: 'farms', id: 'f2', reason: 'ALREADY_FILLED' }],
            },
        });
        expect(await main(['--apply', '--db-label=staging', `--plan=${planPath}`], deps)).toBe(0);
        expect(deps.applyHeal).toHaveBeenCalledTimes(1);
        const rollback = filesIn().find((f) => f.endsWith('-rollback.csv'));
        expect(rollback).toBeDefined();
        const text = fs.readFileSync(path.join(dir, rollback), 'utf8').trim().split('\n');
        expect(text[0]).toMatch(/^# heal-null-holders ROLLBACK LIST label=staging db=[0-9a-f]{8} written=1/);
        expect(text[1]).toBe('table,id,entityId');
        expect(text.slice(2)).toEqual(['applications,a1,e1']);
        expect(text.join('\n')).not.toContain('f2');
        // The plan file the operator reviewed is never overwritten by the apply.
        expect(fs.readFileSync(planPath, 'utf8').split('\n')[0]).toMatch(/ plan /);
    });

    test('a value placed into process.env after the module loaded (as dotenv would) is not trusted', () => {
        const { spawnSync } = require('child_process');
        const script = path.resolve(__dirname, '../../scripts/heal-null-holders.js');
        const env = { ...process.env };
        delete env.DATABASE_URL;
        const child = spawnSync(process.execPath, ['-e', [
            `const m = require(${JSON.stringify(script)});`,
            "process.env.DATABASE_URL = 'postgresql://u:dotenv-pw@127.0.0.1:1/fromdotenv';",
            "m.main(['--db-label=x']).then((c) => process.exit(c), () => process.exit(9));",
        ].join('\n')], { env, encoding: 'utf8', timeout: 20000 });
        expect(child.status).toBe(2);
        expect(child.stderr + child.stdout).toMatch(/DATABASE_URL/);
        expect(child.stderr + child.stdout).not.toContain('dotenv-pw');
    });
});
