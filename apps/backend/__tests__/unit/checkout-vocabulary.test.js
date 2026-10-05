'use strict';

/**
 * Wave 1 (EXPAND) — the checkout engine's vocabulary, schema, and migration
 * agreement. docs/payment-refactor/step2-data-model-design.md (v2, approved).
 *
 * What Wave 1 adds, and what this suite pins:
 *
 *   shared/checkout-status.js          CHECKOUT_STATUSES + guarded transitions.
 *                                      The ONLY path into SETTLED is the
 *                                      verified Stripe webhook (SYSTEM), so the
 *                                      vocabulary module is where that shape is
 *                                      first made testable.
 *   (shared/dtam-remittance-status.js was deleted with the DTAM remittance
 *   pipeline — operator 2026-09-11 "ถอดออกทั้งระบบ"; its table and columns were
 *   dropped by migration 20260929155037. The frozen expand migration is still
 *   read below as written.)
 *   prisma/schema/billing.prisma       CheckoutOrder / StripeWebhookEvent /
 *                                      CheckoutDocument.
 *   migration 20260802150000           creates the four tables WITH the
 *                                      String+CHECK constraints the executive
 *                                      decision locked (R1) — the DB refuses a
 *                                      value the JS vocabulary refuses.
 *
 * Plus the canonical legal-entity spelling (executive decision 3):
 * "บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด" — "โซลูชัน" with น-หนู, and
 * "พรีดิกทีฟ" with ก-ไก่. The wrong spellings render onto tax documents if
 * they survive anywhere, so they are pinned to zero occurrences.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '../..');
const REPO_ROOT = path.join(BACKEND_ROOT, '../..');

const {
    CHECKOUT_STATUSES,
    MILESTONES,
    ALLOWED_CHECKOUT_TRANSITIONS,
    canTransitionCheckout,
    assertCheckoutVocabularyIsTotal,
} = require('../../shared/checkout-status');

describe('checkout status vocabulary', () => {
    test('the vocabulary is exactly the four approved states, frozen', () => {
        expect([...CHECKOUT_STATUSES].sort()).toEqual(
            ['CANCELLED', 'EXPIRED', 'PENDING_PAYMENT', 'SETTLED'].sort(),
        );
        expect(Object.isFrozen(CHECKOUT_STATUSES)).toBe(true);
    });

    test('milestones are exactly M1 and M2', () => {
        expect([...MILESTONES]).toEqual(['M1', 'M2']);
        expect(Object.isFrozen(MILESTONES)).toBe(true);
    });

    test('SETTLED is terminal and reachable only from PENDING_PAYMENT', () => {
        // The webhook settles a pending order. Nothing settles an expired or
        // cancelled one (a new attempt re-opens PENDING_PAYMENT first), and
        // nothing leaves SETTLED — money moved.
        expect(canTransitionCheckout('PENDING_PAYMENT', 'SETTLED')).toBe(true);
        expect(canTransitionCheckout('EXPIRED', 'SETTLED')).toBe(false);
        expect(canTransitionCheckout('CANCELLED', 'SETTLED')).toBe(false);
        expect(ALLOWED_CHECKOUT_TRANSITIONS.SETTLED).toEqual([]);
    });

    test('an expired order can re-open for another attempt; a cancelled one cannot', () => {
        expect(canTransitionCheckout('EXPIRED', 'PENDING_PAYMENT')).toBe(true);
        expect(canTransitionCheckout('CANCELLED', 'PENDING_PAYMENT')).toBe(false);
    });

    test('unknown values are refused, not passed through', () => {
        expect(canTransitionCheckout('PENDING_PAYMENT', 'SLIP_UNDER_REVIEW')).toBe(false);
        expect(canTransitionCheckout('nonsense', 'SETTLED')).toBe(false);
        expect(canTransitionCheckout(null, undefined)).toBe(false);
    });

    test('the transition table is total over the vocabulary (boot assertion)', () => {
        expect(() => assertCheckoutVocabularyIsTotal()).not.toThrow();
        const covered = Object.keys(ALLOWED_CHECKOUT_TRANSITIONS).sort();
        expect(covered).toEqual([...CHECKOUT_STATUSES].sort());
    });
});

describe('schema and migration agree (EXPAND only)', () => {
    const billing = fs.readFileSync(path.join(BACKEND_ROOT, 'prisma/schema/billing.prisma'), 'utf8');
    const migrationDir = path.join(BACKEND_ROOT, 'prisma/migrations/20260802150000_wave1_checkout_engine_expand');
    const migration = fs.readFileSync(path.join(migrationDir, 'migration.sql'), 'utf8');

    test('the three checkout-engine models exist in the schema (DtamRemittanceBatch dropped)', () => {
        for (const model of ['model CheckoutOrder', 'model StripeWebhookEvent', 'model CheckoutDocument']) {
            expect(billing).toContain(model);
        }
        expect(billing).not.toContain('model DtamRemittanceBatch');
    });

    test('CheckoutOrder carries the four breakdown columns as Decimal(15,2)', () => {
        for (const col of ['platform_fee_net', 'platform_fee_vat', 'platform_fee_gross', 'total_payable_amount']) {
            expect(billing).toContain(`@map("${col}")`);
        }
        const block = billing.slice(billing.indexOf('model CheckoutOrder'), billing.indexOf('model StripeWebhookEvent'));
        expect((block.match(/Decimal\s+@db\.Decimal\(15, 2\)/g) || []).length).toBe(4);
        expect(block).not.toContain('dtam_fee_amount');
    });

    test('the migration creates all four tables', () => {
        for (const table of ['checkout_orders', 'dtam_remittance_batches', 'stripe_webhook_events', 'checkout_documents']) {
            expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
        }
    });

    test('R1 (String + CHECK): the DB refuses what the JS vocabulary refuses', () => {
        // Status CHECKs mirror the frozen vocabularies exactly.
        for (const status of CHECKOUT_STATUSES) {
            expect(migration).toContain(`'${status}'`);
        }
        // The remittance vocabulary module is gone; the applied (frozen)
        // migration still carries its CHECK as written (dropped by 20260929155037).
        for (const status of ['PENDING', 'BATCHED', 'REMITTED', 'RECONCILED']) {
            expect(migration).toContain(`'${status}'`);
        }
        expect(migration).toMatch(/CONSTRAINT "checkout_orders_status_check"/);
        expect(migration).toMatch(/CONSTRAINT "checkout_orders_milestone_check"/);
        expect(migration).toMatch(/CONSTRAINT "checkout_orders_dtam_remittance_status_check"/);
        expect(migration).toMatch(/CONSTRAINT "dtam_remittance_batches_status_check"/);
    });

    test('the breakdown arithmetic is enforced in the database', () => {
        expect(migration).toMatch(/platform_fee_gross"\s*=\s*"platform_fee_net"\s*\+\s*"platform_fee_vat"/);
        expect(migration).toMatch(/total_payable_amount"\s*=\s*"dtam_fee_amount"\s*\+\s*"platform_fee_gross"/);
    });

    test('EXPAND discipline: the migration drops nothing', () => {
        // SQL comments stripped first — the header documents the manual
        // ROLLBACK as DROP statements, which is prose, not DDL.
        const ddl = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
        expect(ddl).not.toMatch(/DROP\s+TABLE/i);
        expect(ddl).not.toMatch(/DROP\s+COLUMN/i);
    });

    test('tenant scoping registers the two tenant-owned models, not the webhook store', () => {
        const ext = fs.readFileSync(path.join(BACKEND_ROOT, 'services/tenant-prisma-extension.js'), 'utf8');
        expect(ext).toContain("'CheckoutOrder'");
        expect(ext).not.toContain("'DtamRemittanceBatch'");
        expect(ext).toContain("'CheckoutDocument'");
        // Stripe events arrive with no tenant context; org resolves through the
        // order they reference. Registering the store would make the dedup
        // insert silently tenant-stamped and break cross-checks.
        expect(ext).not.toContain("'StripeWebhookEvent'");
    });
});

describe('Stripe secret isolation (executive decision 5)', () => {
    const template = fs.readFileSync(path.join(BACKEND_ROOT, '.env.example'), 'utf8');

    test('the backend template documents both server-side Stripe secrets', () => {
        expect(template).toMatch(/^STRIPE_SECRET_KEY=/m);
        expect(template).toMatch(/^STRIPE_WEBHOOK_SECRET=/m);
    });

    test('no template line carries a real-looking Stripe key', () => {
        expect(template).not.toMatch(/sk_(test|live)_[A-Za-z0-9]{8,}/);
        expect(template).not.toMatch(/whsec_[A-Za-z0-9]{8,}/);
    });

    test('no production source hardcodes a secret key literal', () => {
        const offenders = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (['node_modules', '__tests__'].includes(entry.name)) { continue; }
                    walk(full);
                } else if (entry.name.endsWith('.js')) {
                    if (/sk_(test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/.test(fs.readFileSync(full, 'utf8'))) {
                        offenders.push(path.relative(BACKEND_ROOT, full));
                    }
                }
            }
        };
        for (const dir of ['routes', 'services', 'config', 'shared', 'middleware', 'jobs']) {
            walk(path.join(BACKEND_ROOT, dir));
        }
        expect(offenders).toEqual([]);
    });
});

describe('canonical legal-entity spelling (executive decision 3)', () => {
    const WRONG = ['โซลูชั่น', 'พรีดิคทีฟ'];

    function scan(dir, exts, out = []) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (['node_modules', '.next', 'build', '.dart_tool'].includes(entry.name)) { continue; }
                scan(full, exts, out);
            } else if (exts.some((e) => entry.name.endsWith(e))) {
                const src = fs.readFileSync(full, 'utf8');
                for (const wrong of WRONG) {
                    // The one allowed mention is the invoice-issuers comment
                    // that DOCUMENTS the distinction ("โซลูชัน not โซลูชั่น —
                    // official spelling per DBD records").
                    const lines = src.split('\n').filter((l) => l.includes(wrong)
                        && !l.includes('official spelling per DBD')
                        && !l.includes('(note'));
                    for (const _l of lines) {
                        out.push(`${path.relative(REPO_ROOT, full)} -> ${wrong}`);
                    }
                }
            }
        }
        return out;
    }

    test('no source in any app carries a wrong spelling of the legal name', () => {
        const offenders = [
            ...scan(path.join(REPO_ROOT, 'apps/backend/config'), ['.js']),
            ...scan(path.join(REPO_ROOT, 'apps/backend/prisma'), ['.js', '.prisma']),
            ...scan(path.join(REPO_ROOT, 'apps/backend/services'), ['.js']),
            ...scan(path.join(REPO_ROOT, 'apps/web-app/src'), ['.ts', '.tsx']),
            ...scan(path.join(REPO_ROOT, 'apps/web-app/playwright'), ['.ts']),
            ...scan(path.join(REPO_ROOT, 'apps/mobile-app/lib'), ['.dart']),
        ];
        expect([...new Set(offenders)]).toEqual([]);
    });

    test('the canonical spelling is present where documents are issued', () => {
        const issuers = fs.readFileSync(path.join(BACKEND_ROOT, 'config/invoice-issuers.js'), 'utf8');
        expect(issuers).toContain('พรีดิกทีฟ เอไอ โซลูชัน');
    });
});
