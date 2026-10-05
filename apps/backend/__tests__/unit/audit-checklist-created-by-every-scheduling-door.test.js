'use strict';

/**
 * Only one function may create an AuditChecklist row, and this test finds the creators
 * by scanning the source rather than by reading a list somebody maintained.
 *
 * A certificate cannot be issued without an AuditChecklist row: the onsite evidence gate
 * counts photos and checklist items keyed to it (onsite-evidence-gate.js), and with no row
 * it refuses with NO_ONSITE_AUDIT. Conversely, whoever creates that row decides which farms
 * can be certified, so `auditChecklist.create` is a certificate-issuing act wherever it
 * appears.
 *
 * The history this file exists to stop repeating:
 *
 *   2026-08-25 — two doors reached AUDIT_CONFIRMED and only one armed the evidence chain.
 *       /provider/scheduler/queue -> POST /api/audit/scheduling/assign — created the row
 *       /provider/calendar        -> scheduler-audit-schedules-post-handler.js — created nothing
 *     A scheduler booking through the calendar produced an audit that could be carried out
 *     in full and still never issue a certificate. Fixed by extracting one shared armer.
 *
 *   2026-08-26 — a THIRD creator, in controllers/audit-checklist-controller.js, which is
 *     not a scheduling door and so was never on anyone's list. It created the row inline
 *     and never read inspectionMode, so an ONLINE_MEET audit got an evidence record and a
 *     farm nobody visited could be certified. The previous version of this test read
 *     exactly two hard-coded paths and was green throughout.
 *
 * A test that looks only where you already thought to look is not a net. The creator list
 * below is therefore DERIVED: walk the repository, read every source file, and let the
 * source say who creates audit rows. A fourth creator added next month fails this test on
 * the commit that adds it, wherever in the tree it is put.
 */
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SHARED = path.join(__dirname, '../../services/audit/arm-onsite-evidence.js');
const SCHEDULING_SERVICE = path.join(__dirname, '../../services/audit-scheduling-service.js');
const CALENDAR_HANDLER = path.join(
  __dirname,
  '../../routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js',
);
const CHECKLIST_CONTROLLER = path.join(__dirname, '../../controllers/audit-checklist-controller.js');

/**
 * The single file permitted to create an AuditChecklist row, repo-relative with forward
 * slashes. Adding a path here is a decision to let another place issue certificates and
 * belongs in review, which is the point of making it a diff.
 */
const ALLOWED_CREATORS = ['apps/backend/services/audit/arm-onsite-evidence.js'];

// Directories that hold no shippable creator: dependencies, build output, captured
// evidence, and test trees (a mocked `auditChecklist.create` in a test is not a creator).
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', '.vscode',
  'coverage', 'dist', 'build', 'out',
  'evidence', 'reports', 'test-reports', 'test-results', 'playwright-report',
  '__tests__', 'tests', 'chaos-tests',
  'storage', 'public', 'migrations',
]);
const SOURCE_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const IS_TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// Prisma delegate writes, and the raw-SQL way around them. `upsert` and `createMany`
// count: they insert rows just as `create` does, and an evidence rule that only knows
// the word "create" is a rule with a documented bypass.
const DELEGATE_CREATE = /auditChecklist\s*\.\s*(?:create|createMany|upsert)\s*\(/;
const RAW_INSERT = /insert\s+into\s+["'`]?(?:public\.)?["'`]?audit_checklists/i;

function scanRepositoryForAuditChecklistCreators(root) {
  const creators = [];
  let filesScanned = 0;

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
      return; // unreadable directory: nothing to assert about, and the count guard below
    } //        would catch a walk that failed wholesale
    for (const entry of entries) {
      if (entry.isSymbolicLink()) { continue; }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) { walk(full); }
        continue;
      }
      if (!SOURCE_EXT.has(path.extname(entry.name))) { continue; }
      if (IS_TEST_FILE.test(entry.name)) { continue; }
      filesScanned += 1;
      const source = fs.readFileSync(full, 'utf8');
      if (DELEGATE_CREATE.test(source) || RAW_INSERT.test(source)) {
        creators.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };

  walk(root);
  return { creators: creators.sort(), filesScanned };
}

describe('who may create an AuditChecklist row', () => {
  const scan = scanRepositoryForAuditChecklistCreators(REPO_ROOT);

  it('the scan actually read the repository (a scan that finds nothing must fail, not pass)', () => {
    // Without these two, a walker broken by a moved directory or a bad regex would report
    // zero creators and the suite would go green on an empty set — the failure mode that
    // makes an enforcement test worse than no test.
    expect(scan.filesScanned).toBeGreaterThan(500);
    expect(scan.creators.length).toBeGreaterThan(0);
  });

  it('finds the shared armer, proving the pattern matches a real creator', () => {
    expect(scan.creators).toContain('apps/backend/services/audit/arm-onsite-evidence.js');
  });

  it('finds NO creator outside the allowed list, wherever in the tree it was added', () => {
    const unexpected = scan.creators.filter((file) => !ALLOWED_CREATORS.includes(file));
    expect(unexpected).toEqual([]);
  });

  it('every allowed creator still exists (a stale allowance is a hole nobody is watching)', () => {
    for (const allowed of ALLOWED_CREATORS) {
      expect(fs.existsSync(path.join(REPO_ROOT, allowed))).toBe(true);
    }
  });
});

describe('every door that opens an audit goes through the shared armer', () => {
  it('the shared function exists', () => {
    expect(fs.existsSync(SHARED)).toBe(true);
  });

  it.each([
    ['the scheduler queue door', SCHEDULING_SERVICE],
    ['the calendar door', CALENDAR_HANDLER],
    ['the checklist controller (found 2026-08-26 creating rows inline)', CHECKLIST_CONTROLLER],
  ])('%s calls armOnsiteEvidence', (_label, file) => {
    expect(fs.readFileSync(file, 'utf8')).toMatch(/armOnsiteEvidence/);
  });

  it('the checklist controller reads inspectionMode instead of ignoring it', () => {
    // The defect was not a missing call; it was a creator that had no opinion about
    // whether anyone went to the farm. Passing an undefined mode into the armer would
    // satisfy the grep above and refuse every audit, so pin the read too.
    const controller = fs.readFileSync(CHECKLIST_CONTROLLER, 'utf8');
    expect(controller).toMatch(/inspectionMode/);
  });
});

describe('armOnsiteEvidence', () => {
  const { armOnsiteEvidence, CERTIFIABLE_INSPECTION_MODES } = require('../../services/audit/arm-onsite-evidence');

  // `application` is part of the contract as of 2026-08-26: arming re-points
  // Application.formData.onsiteAuditId at the audit it armed, so a stale pin
  // from a previous (failed) audit cannot decide which photographs a
  // certificate rests on. See the module header for why that lives here.
  function makeTx(existing = null, formData = {}) {
    return {
      auditChecklist: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'chk-1', ...data })),
      },
      application: {
        findUnique: jest.fn().mockResolvedValue({ formData }),
        update: jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
      },
    };
  }

  const base = {
    applicationId: 'app-1',
    auditorId: 'auditor-1',
    organizationId: 'org-1',
    createdBy: 'scheduler-1',
  };

  it('creates the checklist for an ONSITE audit', async () => {
    const tx = makeTx();
    const result = await armOnsiteEvidence(tx, { ...base, inspectionMode: 'ONSITE' });

    expect(tx.auditChecklist.create).toHaveBeenCalledTimes(1);
    expect(result.armed).toBe(true);
    const { data } = tx.auditChecklist.create.mock.calls[0][0];
    expect(data.applicationId).toBe('app-1');
    expect(data.auditorId).toBe('auditor-1');
    expect(data.organizationId).toBe('org-1');
    expect(data.status).toBe('IN_PROGRESS');
  });

  it('is idempotent — an audit already in progress is not duplicated', async () => {
    const tx = makeTx({ id: 'chk-existing' });
    const result = await armOnsiteEvidence(tx, { ...base, inspectionMode: 'ONSITE' });

    expect(tx.auditChecklist.create).not.toHaveBeenCalled();
    expect(result.armed).toBe(true);
    expect(result.auditChecklistId).toBe('chk-existing');
  });

  it('does NOT arm an ONLINE_MEET audit, and says so rather than staying silent', async () => {
    const tx = makeTx();
    const result = await armOnsiteEvidence(tx, { ...base, inspectionMode: 'ONLINE_MEET' });

    expect(tx.auditChecklist.create).not.toHaveBeenCalled();
    expect(result.armed).toBe(false);
    // The caller must be able to tell the scheduler why, at scheduling time.
    expect(result.reason).toBeTruthy();
    expect(result.canLeadToCertificate).toBe(false);
  });

  it('names which modes can lead to a certificate, so no caller has to guess', () => {
    expect(CERTIFIABLE_INSPECTION_MODES).toContain('ONSITE');
    expect(CERTIFIABLE_INSPECTION_MODES).not.toContain('ONLINE_MEET');
  });

  it('treats an unknown mode as not certifiable, because failing open here issues an unbacked certificate', async () => {
    const tx = makeTx();
    const result = await armOnsiteEvidence(tx, { ...base, inspectionMode: 'SOMETHING_NEW' });

    expect(tx.auditChecklist.create).not.toHaveBeenCalled();
    expect(result.armed).toBe(false);
    expect(result.canLeadToCertificate).toBe(false);
  });
});
