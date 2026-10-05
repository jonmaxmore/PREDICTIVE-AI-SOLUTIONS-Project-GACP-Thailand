/**
 * ESLint Configuration - Flat Config (ESLint 9.x)
 * Enforces strict code quality for production
 */
const js = require('@eslint/js');

// Phase A6 §A6-1 — local plugin with `gacp/no-cross-module-internal`.
// Currently zero violations because no services have been moved into
// modules/ yet; rule starts at "warn" so future migrations have a
// soft-landing window. Flips to "error" once modules/ is the canonical
// home for the affected domains (see modules/README.md migration plan).
const gacpPlugin = require('./eslint-rules/index.js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node.js globals
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        global: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        // Node 18+ built-ins (project runs on Node 24)
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        // Jest globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
      },
    },
    plugins: {
      gacp: gacpPlugin,
    },
    rules: {
      // === Phase A6 module boundaries (RATCHETED 2026-05-04) ===
      // Flags `require()` of `modules/<other>/internal/*` from outside
      // the same module. Locked at 0 violations since landing — Phase A6
      // hadn't yet migrated services into modules/, so there were no
      // legitimate uses for the rule to guard. Promoted to `error` now so
      // any future cross-module internal reach fails CI on the PR that
      // introduces it instead of being noticed only post-merge.
      'gacp/no-cross-module-internal': 'error',

      // === PR-WF-1: canonical status writer (RATCHETED 2026-04-29) ===
      // Flags direct `prisma.application.update({ data: { status: ... } })`
      // outside services/application-status-writer.js.
      //
      // Migration history:
      //   - Initial baseline: 45 violations across ~30 files (warn).
      //   - Phase A6 / batch 1+2 (PR #31, #35): cleared payment finalization,
      //     review/revision, sync-controller, payment phase flow setup.
      //   - Phase A6 / batch 3 (this PR, 2026-04-29): cleared remaining
      //     production sites (audits, quotes, cron, admin, e2e, workflow
      //     handlers, scheduler, webhook flow, scripts) to 0 real violations.
      //
      // Net 45 → 0; rule promoted to error to lock the regression in.
      'gacp/no-direct-application-status-write': 'error',

      // === Direct AuditLog / Notification creates (RATCHETED 2026-05-04) ===
      // Flags `prisma.auditLog.create()` outside middleware/audit-logger.js
      // and `prisma.notification.create()` outside
      // services/notification-service.js.
      //
      // Why this matters — two distinct concerns the rule enforces:
      //
      // 1. Cron / public / pre-tenant-bind callers MUST go through the
      //    canonical writers because direct creates silently 500 when no
      //    AsyncLocalStorage tenant context is bound (the extension can't
      //    auto-inject organizationId, and Notification.organizationId /
      //    AuditLog.organizationId are NOT NULL).
      //
      // 2. Even from authenticated contexts where tenant extension would
      //    auto-inject, going through createNotification() unlocks
      //    user-preference channels (in-app vs email vs SMS), NotifyType
      //    templates, and the email/SMS fanout in sendNotification().
      //    Direct creates skip all of that — applicants don't get emails
      //    even when their account opted in.
      //
      // Migration history:
      //   - 2026-05-03 baseline: 17 direct prisma.notification.create
      //     sites in authenticated provider/admin handlers. Rule at
      //     `warn`.
      //   - 2026-05-04 sweep (this PR): all 16 surviving sites migrated
      //     to `createNotification` / `createBulkNotifications`
      //     (the 17th was a duplicate already cleared). Rule promoted
      //     to `error` to lock the regression.
      //
      // The auditLog half of the rule has been at 0 violations since
      // PR #199 routed every direct create through auditLogger.log.
      'gacp/no-direct-audit-or-notification-write': 'error',

      // === PR 2d: legacy status vocabulary ratchet (2026-08-01) ===
      // PR 2c deleted three translation tables (~100 entries) and every legacy
      // Application.status spelling that fed them. They did not arrive all at
      // once — each was added by someone hitting an unrecognised status and
      // reaching for the smallest fix, one more alias just for this case. That
      // is how the layer reached a size nobody could remove: at any moment some
      // live code depended on some entry.
      //
      // Landing at `error` with 0 violations rather than `warn` with a
      // backlog: there is no migration to schedule, because 2b closed the
      // writer vocabulary and 2c removed the last reader. The only thing left
      // to prevent is regrowth, and a warning that nobody must act on today is
      // a warning people learn to scroll past.
      //
      // Scoped by PATH, not by word: PaymentSlip / PurchaseInvoice /
      // NotifyType legitimately own PENDING_REVIEW, DOCUMENT_APPROVED and
      // CAR_SUBMITTED, and exempting those words everywhere would let them back
      // into an Application status set — the exact category error 2c removed.
      'gacp/no-legacy-status-vocabulary': 'error',

      // === CRITICAL: Production Safety ===
      'no-console': 'off',
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // === CRITICAL: Error Prevention ===
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'valid-typeof': 'error',

      // === Security ===
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'curly': ['error', 'all'],

      // === Best Practices ===
      'no-case-declarations': 'error',
      'no-fallthrough': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',

      // === Style ===
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
    },
  },
  {
    // Test files - relax console warnings
    files: ['**/*.test.js', '**/*.spec.js', '**/__tests__/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Ignore patterns
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.turbo/**',
      '*.min.js',
      'playwright-report/**',
    ],
  },
];
