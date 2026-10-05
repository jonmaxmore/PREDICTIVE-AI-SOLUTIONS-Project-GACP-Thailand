const fs = require('fs');
const path = require('path');

const providerRoutesDir = path.join(__dirname, '../../routes/api/provider');
const providerCmsPath = path.join(__dirname, '../../routes/api/provider-cms.js');

const CANONICAL_PROVIDER_MODULES = [
  'reviewer.js',
  'scheduler.js',
  'auditor.js',
  'applications.js',
  'admin.js',
  'certificates.js',
  'analytics.js',
];

const BANNED_LEGACY_PATTERNS = [
  /\/workflow-transition(?:\/|$)/,
  /\/audit-timeline(?:\/|$)/,
  /\/start-inspection(?:\/|$)/,
  /\/decision(?:\/|$)/,
  /\/audits\/schedule(?:\/|$)/,
  /\/revision\/reminder-run(?:\/|$)/,
  /\/batch-action(?:\/|$)/,
];

const CANONICAL_PROVIDER_PATHS = [
  '/reviewer/dashboard',
  '/scheduler/dashboard',
  '/scheduler/audits/schedules',
  '/auditor/dashboard',
  '/auditor/applications/:id/inspection-starts',
  '/auditor/applications/:id/audit-decisions',
  '/applications/:id/workflow-transitions',
  '/applications/:id/revision-expirations',
  '/applications/:id/audit-timelines',
  '/admin/revision-reminder-runs',
  '/admin/batch-actions',
  '/certificates/dashboard',
  '/analytics/performance',
];

function isKebabCasePath(pathname) {
  return pathname
    .split('/')
    .filter(Boolean)
    .every((segment) => {
      if (segment.startsWith(':')) {
        return true;
      }
      // Optional `.ext` suffix for file-extension routes
      // (e.g. `/audit-log/export.csv` is a standard URL pattern; the
      // dot is a content-type hint, not a path-naming violation).
      return /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)?$/.test(segment);
    });
}

function collectRouterPaths(sourceCode) {
  const regex = /router\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/g;
  const paths = [];
  let match = regex.exec(sourceCode);
  while (match) {
    paths.push(match[1]);
    match = regex.exec(sourceCode);
  }
  return paths;
}

describe('Route naming policy (provider canonical namespace)', () => {
  it('keeps canonical provider paths lowercase + kebab-case', () => {
    for (const pathname of CANONICAL_PROVIDER_PATHS) {
      expect(isKebabCasePath(pathname)).toBe(true);
    }
  });

  it('keeps provider module routes kebab-case and noun-style', () => {
    for (const file of CANONICAL_PROVIDER_MODULES) {
      const fullPath = path.join(providerRoutesDir, file);
      const source = fs.readFileSync(fullPath, 'utf8');
      const paths = collectRouterPaths(source);

      for (const pathname of paths) {
        expect(isKebabCasePath(pathname)).toBe(true);
        for (const legacyPattern of BANNED_LEGACY_PATTERNS) {
          expect(legacyPattern.test(pathname)).toBe(false);
        }
      }
    }
  });

  it('keeps legacy rewrite mappings inside alias adapter only', () => {
    if (!fs.existsSync(providerCmsPath)) {
      // provider-cms.js was consolidated; skip this test
      return;
    }
    const source = fs.readFileSync(providerCmsPath, 'utf8');
    const rewriteFragments = [
      '/workflow-transitions',
      '/revision-expirations',
      '/audit-timelines',
      '/inspection-starts',
      '/audit-decisions',
      '/scheduler/audits/schedules',
      '/admin/revision-reminder-runs',
      '/admin/batch-actions',
    ];

    for (const fragment of rewriteFragments) {
      expect(source.includes(fragment)).toBe(true);
    }
  });
});
