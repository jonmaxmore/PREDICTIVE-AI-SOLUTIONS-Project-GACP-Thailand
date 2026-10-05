#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * GACP System Integrity Check — "หมอตรวจสุขภาพระบบ"
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Catches the EXACT type of bugs that plagued us for 6 months:
 * Validation schema mismatches (frontend vs backend)
 * Port configuration mismatches
 * i18n language consistency (no English on Thai pages)
 * Missing file references (import integrity)
 * Stage/Status enum consistency
 * 
 * Run: node scripts/system-integrity-check.js
 * Invoked by: .husky/pre-commit (step 1/2) and `pnpm doctor`.
 *   Corrected 2026-08-14: this line used to claim "runs automatically on every push
 *   via GitHub Actions". Actions is permanently unavailable, so the pre-commit hook
 *   is the ONLY thing that runs this — a red here blocks commits repo-wide.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'apps', 'backend');
const FRONTEND = path.join(ROOT, 'apps', 'web-app', 'src');

let passed = 0;
let failed = 0;
let warnings = 0;

function check(name, condition, details = '') {
  if (condition) {
    console.log(`${name}`);
    passed++;
  } else {
    console.log(`FAIL: ${name}`);
    if (details) console.log(`     → ${details}`);
    failed++;
  }
}

function warn(name, details = '') {
  console.log(`WARN: ${name}`);
  if (details) console.log(`     → ${details}`);
  warnings++;
}

function readFile(filepath) {
  try {
    return fs.readFileSync(filepath, 'utf-8');
  } catch {
    return null;
  }
}

function extractMinValue(content, fieldName) {
  // Match patterns like: .min(8, 'message') or .min(8)
  const patterns = [
    new RegExp(`${fieldName}[\\s\\S]{0,100}\\.min\\((\\d+)`, 'i'),
    new RegExp(`\\.min\\((\\d+)[^)]*${fieldName}`, 'i'),
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m) return parseInt(m[1]);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n GACP System Integrity Check');
console.log('═══════════════════════════════════════════════════════\n');

// ── 1. PORT Configuration Sync ──────────────────────────────────────
console.log('1. Port Configuration');

const rootPkg = readFile(path.join(ROOT, 'package.json'));
const backendEnv = readFile(path.join(BACKEND, '.env')) || '';
const backendEnvExample = readFile(path.join(BACKEND, '.env.example')) || '';
const serverJs = readFile(path.join(BACKEND, 'server.js')) || '';

if (rootPkg) {
  const pkg = JSON.parse(rootPkg);
  const devScript = pkg.scripts?.dev || '';
  const startScript = pkg.scripts?.start || '';
  
  // Check PORT in dev script
  const devPort = devScript.match(/PORT=(\d+)/)?.[1];
  const startPort = startScript.match(/PORT=(\d+)/)?.[1];
  const envPort = backendEnv.match(/^PORT=(\d+)/m)?.[1] || backendEnvExample.match(/^PORT=(\d+)/m)?.[1];
  
  check(
    'Root package.json dev PORT matches backend .env PORT',
    !devPort || !envPort || devPort === envPort,
    `package.json PORT=${devPort}, .env PORT=${envPort}`
  );
  
  check(
    'Root package.json start PORT matches backend .env PORT',
    !startPort || !envPort || startPort === envPort,
    `package.json PORT=${startPort}, .env PORT=${envPort}`
  );
  
  check(
    'Backend PORT is 8000 (production standard)',
    envPort === '8000' || devPort === '8000',
    `Current PORT=${envPort || devPort || 'not set'}`
  );
}

// ── 2. Password Validation Sync ─────────────────────────────────────
console.log('\n 2. Password Validation Sync');

// Password rules split (auth audit 2026-06-11):
//  - LOGIN validates PRESENCE only (min 1) on both BE + FE, so a legacy user
//    whose password predates the strong policy can still sign in.
//  - SETTING a password (register) enforces the STRONG policy, whose single
//    source of truth is backend utils/password-policy.js (PASSWORD_MIN_LENGTH).
// This check verifies (a) login is presence-only on both sides, and (b) the FE
// register form's min matches the backend strong-policy minimum.
const backendPasswordPolicy = readFile(path.join(BACKEND, 'utils', 'password-policy.js'));
const backendAuthSchemas = readFile(path.join(BACKEND, 'shared', 'schemas', 'auth-schemas.js'));
const frontendLoginPage = readFile(path.join(FRONTEND, 'app', 'auth', '_components', 'health-login-page.tsx'));
const frontendRegisterPage = readFile(path.join(FRONTEND, 'app', '(auth)', 'register', 'page.tsx'));

if (frontendLoginPage) {
  const loginMin = extractMinValue(frontendLoginPage, 'password');
  check(
    `Login password is presence-only on the frontend (min ${loginMin})`,
    loginMin === 1,
    `Login must accept legacy passwords (min 1); frontend login enforces min ${loginMin}`
  );
} else {
  warn('Could not read frontend login page for password validation check');
}

if (backendPasswordPolicy && frontendRegisterPage) {
  const backendStrongMin = parseInt((backendPasswordPolicy.match(/MIN_LENGTH\s*=\s*(\d+)/) || [])[1], 10);
  const frontendRegisterMin = extractMinValue(frontendRegisterPage, 'password');
  check(
    `Register password min matches the strong policy: backend(${backendStrongMin}) === frontend(${frontendRegisterMin})`,
    backendStrongMin === frontendRegisterMin,
    `Backend strong policy is min ${backendStrongMin}; frontend register enforces min ${frontendRegisterMin}`
  );
} else {
  warn('Could not read password-policy / register page for password validation check');
}

// ── 3. Thai ID Validation Sync ──────────────────────────────────────
console.log('\n 3. Thai ID Validation Sync');

if (backendAuthSchemas) {
  const hasThaiIdBackend = backendAuthSchemas.includes('13') && /refine|regex|test/.test(backendAuthSchemas);
  check('Backend validates 13-digit Thai ID pattern', hasThaiIdBackend);
}

// ── 4. i18n Consistency ─────────────────────────────────────────────
console.log('\n 4. i18n Error Message Consistency');

const apiClient = readFile(path.join(FRONTEND, 'lib', 'api', 'api-client.ts'));
if (apiClient) {
  // Check for English-only error messages in toUserFriendlyError
  const errorSection = apiClient.match(/toUserFriendlyError[\s\S]*?^\s{4}\}/m)?.[0] || '';
  
  const englishOnlyPatterns = [
    /return\s+'[A-Z][a-zA-Z\s]+[.!]'/,
    /return\s+`[A-Z][a-zA-Z\s]+`/,
  ];
  
  let hasEnglishOnly = false;
  for (const p of englishOnlyPatterns) {
    if (p.test(errorSection)) {
      hasEnglishOnly = true;
      break;
    }
  }
  
  check(
    'Error messages in api-client.ts are in Thai (not English)',
    !hasEnglishOnly,
    'Found English-only error messages in toUserFriendlyError()'
  );
  
  // Check that common error types have Thai translations
  const hasInvalidCredentialsThai = /invalid.?credentials[\s\S]{0,100}[กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ]/i.test(apiClient);
  const hasLoginFailedThai = /login.?failed[\s\S]{0,100}[กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ]/i.test(apiClient);
  
  check('Invalid credentials error has Thai translation', hasInvalidCredentialsThai);
  check('Login failed error has Thai translation', hasLoginFailedThai);
}

// ── 5. HealthDashboardStage Enum Consistency ────────────────────────
console.log('\n 5. Dashboard Stage Consistency');

const stageFile = readFile(path.join(FRONTEND, 'lib', 'health-dashboard-stage.ts'));
if (stageFile) {
  // Read the stage list out of the HEALTH_DASHBOARD_STAGES declaration rather
  // than restating it here. The previous version hardcoded nine names and a
  // literal `=== 9`, so it stayed green while going out of date — which is the
  // failure mode this whole section exists to catch.
  const unionBlock = stageFile.match(/HEALTH_DASHBOARD_STAGES = \[([\s\S]*?)\] as const;/);
  const expectedStages = unionBlock
    ? (unionBlock[1].match(/'[A-Z][A-Z0-9_]*'/g) || []).map((quoted) => quoted.slice(1, -1))
    : [];

  check('HEALTH_DASHBOARD_STAGES declaration is readable', expectedStages.length > 0,
    'could not parse the stage union — the declaration was renamed or reformatted, so this section is no longer checking anything');

  // Block ends at the line-leading `};` — a label may interpolate the fee catalogue
  // (`${SERVICE_NAME.PHASE_1}`, fix/fee-line-descriptions round 5), so a bare `}` is not the end.
  const labelBlock = stageFile.match(/STAGE_LABEL_TH[\s\S]*?\{([\s\S]*?)\n\};/);
  if (labelBlock) {
    const blockContent = labelBlock[1];
    const missing = expectedStages.filter(s => !blockContent.includes(s));

    check(`STAGE_LABEL_TH covers all ${expectedStages.length} stages`, missing.length === 0,
      `Missing: ${missing.join(', ') || 'none'}`);
    
    // Check that all Record<HealthDashboardStage, ...> in the file have all keys
    const records = stageFile.matchAll(/Record<HealthDashboardStage,\s*\w+>\s*=\s*\{([\s\S]*?)\n\};/g);
    for (const r of records) {
      const recordContent = r[1];
      for (const stage of expectedStages) {
        const hasKey = recordContent.includes(stage);
        if (!hasKey) {
          check(`Stage '${stage}' present in Record`, false, `Missing in Record block`);
        }
      }
    }
  }
  
  // Check for OLD stage names that shouldn't be used in typed Records
  const oldStages = ['WAITING_DOCUMENT_REVIEW', 'WAITING_PAYMENT', 'WAITING_AUDIT'];
  const typedRecordPattern = /Record<HealthDashboardStage/;
  
  // Find files that use typed Records with old stage names
  const dashboardClientView = readFile(path.join(FRONTEND, 'app', 'health', 'dashboard', 'client-view.tsx'));
  if (dashboardClientView && typedRecordPattern.test(dashboardClientView)) {
    for (const old of oldStages) {
      const hasOldInTypedRecord = new RegExp(`Record<HealthDashboardStage[\\s\\S]{0,500}${old}`).test(dashboardClientView);
      check(
        `dashboard/client-view.tsx does NOT use old stage '${old}' in typed Record`,
        !hasOldInTypedRecord,
        `Old stage name will cause TS build failure`
      );
    }
  }
}

// ── 6. File Reference Integrity ─────────────────────────────────────
console.log('\n 6. Page/ClientView Integrity');

// The route list is ENUMERATED, not hardcoded. It used to be 7 names frozen in
// 2026-04 while app/health grew to 27 route directories — 20 of them (billing,
// establishments, herbs, official-documents, sop-builder, site-analysis, surveys,
// tracking, …) were never checked, so the section guarded a shrinking fraction of
// the surface its title claims (2026-08-14 rules audit).
const healthRoot = path.join(FRONTEND, 'app', 'health');
const clientViewPages = [];

if (fs.existsSync(healthRoot)) {
  for (const entry of fs.readdirSync(healthRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(healthRoot, entry.name);
    const pageFile = readFile(path.join(dir, 'page.tsx'));
    if (!pageFile) continue;
    const importsClientView = pageFile.includes('client-view') || pageFile.includes('ClientView') || pageFile.includes('profile-client');
    if (!importsClientView) continue;
    clientViewPages.push({
      name: `app/health/${entry.name}`,
      hasUseClient: pageFile.includes("'use client'"),
      hasClientView: !!(readFile(path.join(dir, 'client-view.tsx')) || readFile(path.join(dir, 'profile-client.tsx'))),
    });
  }
}

// An empty scan is a failure, not a pass: it means the tree moved and this
// section is asserting over nothing.
check(
  `app/health/*: ClientView pages found to check (${clientViewPages.length})`,
  clientViewPages.length > 0,
  `No page.tsx under ${path.relative(ROOT, healthRoot)} imports ClientView — the pattern moved or this scan points at the wrong tree`
);

if (clientViewPages.length > 0) {
  const missingView = clientViewPages.filter((p) => !p.hasClientView).map((p) => p.name);
  check(
    `${clientViewPages.length} ClientView pages: client-view.tsx exists`,
    missingView.length === 0,
    `page.tsx imports ClientView but client-view.tsx is missing: ${missingView.join(', ')}`
  );

  const notServer = clientViewPages.filter((p) => p.hasUseClient).map((p) => p.name);
  check(
    `${clientViewPages.length} ClientView pages: page.tsx is a Server Component`,
    notServer.length === 0,
    `page.tsx should be a Server Component when using the ClientView pattern: ${notServer.join(', ')}`
  );
}

// ── 8. Navigation Link Integrity ────────────────────────────────────
console.log('\n 8. Navigation Link Integrity');

// Extract all /health/* hrefs from nav files.
// NOTE (2026-04-30): app-shell.tsx and mobile-bottom-nav.tsx removed in
// Phase 11 cleanup — they were never imported. The active nav surface
// is dashboard-layout.tsx, which builds nav from healthNavigation in
// constants.ts (covered below) so we don't need to re-scan it.
const navFiles = [
  { name: 'constants.ts', content: readFile(path.join(FRONTEND, 'lib', 'constants.ts')) },
];

for (const { name, content } of navFiles) {
  if (!content) continue;
  const hrefs = content.match(/href:\s*'\/health\/([^']+)'/g) || [];
  for (const href of hrefs) {
    const pathMatch = href.match(/href:\s*'(\/health\/[^']+)'/);
    if (!pathMatch) continue;
    const navPath = pathMatch[1];
    // Convert /health/foo to apps/web-app/src/app/health/foo
    const fsPath = path.join(FRONTEND, 'app', navPath.replace(/^\//, ''));
    const pageExists = fs.existsSync(path.join(fsPath, 'page.tsx')) || 
                       fs.existsSync(path.join(fsPath, 'page.ts'));
    check(
      `${name}: ${navPath} → page exists`,
      pageExists,
      `Nav link points to ${navPath} but no page.tsx found at ${fsPath}`
    );
  }
}

// Check that no nav link uses /health/invoices (old broken path)
for (const { name, content } of navFiles) {
  if (!content) continue;
  const hasOldInvoices = content.includes('/health/invoices');
  check(
    `${name}: no broken /health/invoices link`,
    !hasOldInvoices,
    `Found /health/invoices — should be /health/payments`
  );
}

// ── 8b. nav-config.ts SSOT — getNavForRole(role).path must be a real page ──
// (tile-home-redesign Task 7, Step 1) — nav-config.ts is the single source
// of navigation for EVERY role (health + provider-side officer roles), but
// nothing had ever checked that its `path` values point at real pages —
// section 8 above only ever scanned the legacy /health/* constants.ts list.
// That gap let Tasks 1/4 ship several officer-role tiles pointing at
// nonexistent pages (/provider/appointments, /provider/audit-history,
// /provider/review, /provider/transactions, /admin/reports) straight
// through two review rounds each. This block is a Node script — no `tsx`/
// `ts-node` is wired into pre-commit (see .husky/pre-commit: worktrees may
// have no node_modules) — so, matching this whole file's existing style
// (regex-based static parsing, e.g. section 5's HEALTH_DASHBOARD_STAGES
// read), it parses nav-config.ts as text rather than executing it.
console.log('\n 8b. Navigation SSOT Integrity (nav-config.ts — getNavForRole)');

const navConfigContent = readFile(path.join(FRONTEND, 'lib', 'navigation', 'nav-config.ts'));

if (navConfigContent) {
  // Parse getNavForRole's own `if (canonical === 'x' [|| canonical === 'y']) { return SOME_NAV; }`
  // branches to get a role → array-name map, instead of hardcoding role
  // names a second time here — a new role branch is picked up automatically,
  // and the check fails loudly (below) if the function is restructured.
  const roleToArray = {};
  const branchPattern = /if\s*\(([^)]+)\)\s*\{\s*return\s+(\w+);\s*\}/g;
  let branchMatch;
  while ((branchMatch = branchPattern.exec(navConfigContent))) {
    const [, condition, arrayName] = branchMatch;
    const roleMatches = condition.match(/canonical === '([a-z_]+)'/g) || [];
    for (const roleToken of roleMatches) {
      const role = roleToken.match(/'([a-z_]+)'/)[1];
      roleToArray[role] = arrayName;
    }
  }

  check(
    'nav-config.ts: getNavForRole role→array branches are parseable',
    Object.keys(roleToArray).length > 0,
    'Could not parse any "if (canonical === ...) { return X_NAV; }" branch out of getNavForRole — the function was rewritten and this section no longer checks anything'
  );

  // Route groups (e.g. (auth), (marketing), (public)) are invisible in the
  // URL, so a nav path may resolve INSIDE one. Only top-level groups are
  // handled (the only depth this repo currently has under src/app) —
  // extend if a nested group ever appears.
  const appRoot = path.join(FRONTEND, 'app');
  const routeGroups = fs.existsSync(appRoot)
    ? fs.readdirSync(appRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\(.+\)$/.test(e.name))
        .map((e) => e.name)
    : [];

  const pageExistsAt = (segments) => {
    const dir = path.join(appRoot, ...segments);
    return fs.existsSync(path.join(dir, 'page.tsx')) || fs.existsSync(path.join(dir, 'page.ts'));
  };

  const navPathResolves = (navPath) => {
    const segments = navPath.replace(/^\//, '').split('/').filter(Boolean);
    if (pageExistsAt(segments)) return true;
    return routeGroups.some((group) => pageExistsAt([group, ...segments]));
  };

  for (const [role, arrayName] of Object.entries(roleToArray)) {
    const arrayPattern = new RegExp(`export const ${arrayName}: NavItem\\[\\] = \\[([\\s\\S]*?)\\n\\];`);
    const arrayMatch = navConfigContent.match(arrayPattern);
    if (!arrayMatch) {
      check(
        `nav-config.ts: ${arrayName} (role '${role}') is parseable`,
        false,
        `getNavForRole returns ${arrayName} for role '${role}' but no matching "export const ${arrayName}: NavItem[] = [...]" block was found`
      );
      continue;
    }
    const itemBlock = arrayMatch[1];
    // Every NavItem literal in this file writes `key` immediately before
    // `path` (nav-config.ts's own field order) — walk key→path pairs in
    // source order so a failure names the item, not just the bare path.
    const itemPattern = /key:\s*'([^']+)'[\s\S]*?path:\s*'([^']+)'/g;
    let itemMatch;
    let itemsFound = 0;
    while ((itemMatch = itemPattern.exec(itemBlock))) {
      itemsFound++;
      const [, key, navPath] = itemMatch;
      check(
        `nav-config.ts: ${arrayName}['${key}'] (role '${role}') → ${navPath} → page exists`,
        navPathResolves(navPath),
        `getNavForRole('${role}') item '${key}' points to ${navPath} but no page.tsx/page.ts was found under src/app (checked top-level route groups too: ${routeGroups.join(', ') || 'none present'})`
      );
    }
    check(
      `nav-config.ts: ${arrayName} has at least one {key, path} item to check`,
      itemsFound > 0,
      `${arrayName} block matched but no {key, path} pairs were extracted — the item shape changed and this section is no longer checking anything for role '${role}'`
    );
  }
}

// ── 9. DEMO_MODE Production Safety ─────────────────────────────────
console.log('\n 9. Production Safety');

const constantsFile = readFile(path.join(FRONTEND, 'lib', 'constants.ts'));
if (constantsFile) {
  const demoModeOn = /DEMO_MODE\s*=\s*true/.test(constantsFile);
  check(
    'DEMO_MODE is disabled (false) for production',
    !demoModeOn,
    'DEMO_MODE = true bypasses ALL wizard validation! Set to false for production.'
  );
}

// ── 10. Fee Constant Duplication Check ──────────────────────────────
console.log('\n 10. Fee Constant Integrity');

// Two decays fixed 2026-08-14 (rules audit): `check('fees.ts exists', true)` was a
// literal `true` that could never fail, and the plant-selection-config target still
// pointed at the deleted new-legacy path, so `if (plantConfig)` skipped the guard in
// silence. Targets are now asserted to exist before their content is judged — a
// moved file fails loudly instead of disappearing from the report.
const feeTargets = [
  { name: 'constants/fees.ts', file: path.join(FRONTEND, 'constants', 'fees.ts') },
  { name: 'health/applications/renewal/types.tsx', file: path.join(FRONTEND, 'app', 'health', 'applications', 'renewal', 'types.tsx') },
  { name: 'applications/new/_steps/steps/plant-selection-config.ts', file: path.join(FRONTEND, 'app', 'health', 'applications', 'new', '_steps', 'steps', 'plant-selection-config.ts') },
];

const feeSources = {};
for (const t of feeTargets) {
  const content = readFile(t.file);
  feeSources[t.name] = content;
  check(
    `${t.name} exists (fee SSOT surface)`,
    !!content,
    `Target missing — this guard judges nothing until it is repointed at where the file moved`
  );
}

const renewalTypes = feeSources['health/applications/renewal/types.tsx'];
if (renewalTypes) {
  const hasDuplicateFee = /export\s+const\s+RENEWAL_FEE\s*=\s*\d/.test(renewalTypes);
  check(
    'renewal/types.tsx: no duplicate RENEWAL_FEE constant',
    !hasDuplicateFee,
    'RENEWAL_FEE should be re-exported from @/constants/fees, not redefined'
  );
}

const plantConfig = feeSources['applications/new/_steps/steps/plant-selection-config.ts'];
if (plantConfig) {
  const hasDuplicateFee = /export\s+const\s+CULTIVATION_FEE_PER_METHOD\s*=\s*\d/.test(plantConfig);
  check(
    'plant-selection-config.ts: no duplicate fee constant',
    !hasDuplicateFee,
    'CULTIVATION_FEE_PER_METHOD should be re-exported from @/constants/fees'
  );
}

// (Section 11 "Backend Port Consistency" removed — it validated
//  config/api.config.ts, which had 0 importers and was deleted as dead code
//  (audit §3). The canonical backend port lives in docker-compose / env.)

// ── 12. Deprecated Export Check ─────────────────────────────────────
console.log('\n 12. Dead Code Check');

const stageFileClean = readFile(path.join(FRONTEND, 'lib', 'health-dashboard-stage.ts'));
if (stageFileClean) {
  const hasDeprecatedExport = /export\s+const\s+HEALTH_STAGE_LABEL_TH/.test(stageFileClean);
  check(
    'health-dashboard-stage.ts: no deprecated HEALTH_STAGE_LABEL_TH export',
    !hasDeprecatedExport,
    'Deprecated export found — use STAGE_LABEL_TH instead'
  );
  
  const hasDeprecatedBadge = /export\s+const\s+HEALTH_STAGE_BADGE_COLOR/.test(stageFileClean);
  check(
    'health-dashboard-stage.ts: no deprecated HEALTH_STAGE_BADGE_COLOR export',
    !hasDeprecatedBadge,
    'Deprecated export found — use STAGE_BADGE_STYLE instead'
  );
}

// ── 13. Hardcoded Fee Strings in JSX ── REMOVED 2026-08-14, see below ───
//
// This section printed a heading and executed ZERO assertions. Its only target,
// app/health/help-center.tsx, was deleted (`git ls-files` finds no such file);
// readFile returned null, `continue` skipped the loop body, and the empty section
// read as green in every pre-commit run since. A guard that cannot fail is not a
// guard — it is the phantom class the audit ledger already counts, so it is buried
// here rather than left to look like coverage.
//
// The RULE it meant to enforce is real and currently VIOLATED. Pointing the same
// patterns (/5,000|25,000|30,000\s*บาท/) at the live surface instead of one dead
// file finds 2 hits (measured 2026-08-14):
//   apps/web-app/src/app/health/payments/slip-upload-modal.tsx:627
//   apps/web-app/src/components/help/faq-data.ts:85
// Restoring it as a src-wide scan therefore fails today, and this script is run by
// .husky/pre-commit — a red here blocks every commit in the repo. Paying that debt
// is web-app copy work plus an operator ruling on whether fee amounts may appear in
// prose at all (dated data, not constants). Restore the scan in the same change
// that fixes those two strings; do not restore it aimed at a file list.

// ── 14. User-Facing English Error Messages ──────────────────────────
console.log('\n 14. User-Facing Error Localization');

// Was a 4-file list, 2 of which (hooks/use-master-data.ts,
// app/provider/planting/page.tsx) had been deleted and were skipped in silence —
// the section reported green while checking half of what it named (2026-08-14
// rules audit). It now scans the whole src tree, so a file list can never rot again.
const englishErrorPattern = /setError\(\s*[^)]*['"]Failed to (fetch|load)[^'"]*['"]\s*\)/;

function collectSourceFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      collectSourceFiles(p, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(p);
    }
  }
  return acc;
}

const srcFiles = collectSourceFiles(FRONTEND);
check(
  `web-app src scanned for English setError() copy (${srcFiles.length} files)`,
  srcFiles.length > 0,
  `No .ts/.tsx files found under ${path.relative(ROOT, FRONTEND)} — the scan found nothing to judge`
);

if (srcFiles.length > 0) {
  const offenders = srcFiles
    .filter((f) => englishErrorPattern.test(readFile(f) || ''))
    .map((f) => path.relative(FRONTEND, f).replace(/\\/g, '/'));
  check(
    'no English "Failed to fetch/load" in setError() anywhere in src',
    offenders.length === 0,
    `User-facing errors should be in Thai. Use translateError() or write Thai strings directly: ${offenders.join(', ')}`
  );
}

// ── 15. Error Translator Coverage ───────────────────────────────────
console.log('\n 15. Error Translator Coverage');

const errorTranslator = readFile(path.join(FRONTEND, 'utils', 'error-translator.ts'));
if (errorTranslator) {
  const requiredMappings = [
    'Invalid credentials',
    'Failed to fetch',
    'Internal Server Error',
    'User already exists',
    'Password too weak',
  ];
  for (const mapping of requiredMappings) {
    check(
      `error-translator.ts maps "${mapping}" to Thai`,
      errorTranslator.includes(mapping),
      `Missing translation mapping for "${mapping}"`
    );
  }

  // Fallback: any unmatched English error should return Thai generic
  const hasFallback = errorTranslator.includes('เกิดข้อผิดพลาด');
  check(
    'error-translator.ts has Thai fallback for unknown English errors',
    hasFallback,
    'Missing generic Thai fallback message'
  );
}

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('\n SYSTEM INTEGRITY CHECK FAILED');
  console.log('   Fix the issues above before deploying to production!\n');
  process.exit(1);
} else {
  console.log('\n ALL CHECKS PASSED — System is consistent\n');
  process.exit(0);
}

