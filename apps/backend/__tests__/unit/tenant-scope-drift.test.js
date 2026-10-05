/**
 * C3-01 (audit 2026-06-10) — tenant-scope drift ratchet.
 *
 * ADR-014: TENANT_SCOPED_MODELS in services/tenant-prisma-extension.js is the
 * runtime registry the Prisma extension uses to inject/verify organizationId.
 * It is maintained BY HAND against the Prisma schema — and it had silently
 * drifted: 9 models carry a REQUIRED organizationId column but are absent from
 * the registry (4 billing models + PeriodClose + the 4 Wave-C entity-domain
 * models).
 *
 * This suite is the behavior-neutral fix the audit recommended (option A:
 * CI drift-check only — adding a model to the runtime set changes read-backstop
 * behavior under TENANT_READ_ORG_SCOPE and is a separate owner-gated decision):
 *
 *   1. Every schema model with a REQUIRED organizationId must be in the runtime
 *      registry OR in the documented KNOWN_DRIFT list below. A NEW tenant-owned
 *      model can no longer be added without consciously choosing a side.
 *   2. KNOWN_DRIFT is a RATCHET: every entry must still be genuinely drifted.
 *      The moment someone adds one to the runtime set, this test forces the
 *      exemption to be deleted (list can only shrink).
 *   3. Reverse direction: every registry entry must exist in the schema with a
 *      REQUIRED organizationId — catches renames/deletes leaving stale entries.
 *
 * Pure file-system scan (no requires of runtime modules, no DB) so it runs on
 * any machine. The model-block regex is pinned by a sanity floor (test 4) so a
 * schema-format change breaks LOUDLY instead of passing vacuously.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_DIR = path.resolve(__dirname, '../../prisma/schema');
const EXTENSION_PATH = path.resolve(__dirname, '../../services/tenant-prisma-extension.js');

/**
 * Documented drift — models with a REQUIRED organizationId that are
 * INTENTIONALLY not in the runtime registry (yet). Each entry needs a reason.
 * Do NOT add new models here to silence test 1 without a written reason and
 * an owner decision; the registry is the default home.
 */
const KNOWN_DRIFT = {
    // ── Billing (audit C3-01): every live create path passes organizationId
    //    explicitly; adding them to the registry also enables the org READ
    //    backstop (TENANT_READ_ORG_SCOPE), which changes the rows financial
    //    reports/reconciliation see — owner-gated, re-verify on staging first.
    BankAccount: 'C3-01 billing drift — creates pass organizationId explicitly; registry add = read-backstop change (owner-gated)',
    // Quotation was exempted here until F-G4-64 (2026-08-28): it is now IN the
    // registry (coordinator ruling 6 is the owner decision this list waits for),
    // so its exemption is deleted — this list only shrinks.
    PeriodClose: 'C3-01 billing drift (found by this scan, not in the original audit) — same class as BankAccount',
    // ── Entity domain (Wave C): scoped via the separate legal-applicant Entity
    //    dimension (ENTITY_SCOPED_MODELS / entity-service sets organizationId
    //    explicitly). Tenant-registry membership is a deliberate non-goal.
    Entity: 'Wave-C entity domain — scoped via the entity dimension; entity-service sets organizationId explicitly',
    EntityMembership: 'Wave-C entity domain — intentionally readable across entities (picker UI); org set explicitly',
    EntityMembershipEvent: 'Wave-C entity domain — event log for memberships; org set explicitly',
    EntityContextSwitch: 'Wave-C entity domain — audit trail of context switches; org set explicitly',
    // ── Work-distribution ledger (Phase 1A-1C, #489-500): recordAssignment and the
    //    ledger query service (services/assignment-ledger-query-service.js) set/filter
    //    organizationId explicitly (manual groupBy + fail-closed 403 on every read).
    //    The writer is append-only + best-effort (never throws). Registry add = enabling
    //    the read-backstop on the ledger queries — a runtime change that's owner-gated
    //    and must be staging-verified — same class as the BankAccount billing entries.
    AssignmentLedgerEntry: 'work-distribution ledger — query service scopes organizationId explicitly (fail-closed); registry add = read-backstop change (owner-gated), same class as BankAccount',
};

function scanSchemaModels() {
    const models = {};
    for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'))) {
        const src = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
        for (const m of src.matchAll(/(?:^|\n)model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
            const [, name, body] = m;
            models[name] = {
                file,
                requiredOrg: /^\s*organizationId\s+String(?!\?)/m.test(body),
            };
        }
    }
    return models;
}

function readRuntimeRegistry() {
    const src = fs.readFileSync(EXTENSION_PATH, 'utf8');
    const setMatch = src.match(/const TENANT_SCOPED_MODELS = new Set\(\[([\s\S]*?)\]\)/);
    if (!setMatch) {
        throw new Error('TENANT_SCOPED_MODELS Set literal not found in tenant-prisma-extension.js — update this test if the registry moved');
    }
    return new Set([...setMatch[1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
}

describe('C3-01 — TENANT_SCOPED_MODELS vs prisma schema (drift ratchet)', () => {
    const models = scanSchemaModels();
    const registry = readRuntimeRegistry();

    it('every model with a REQUIRED organizationId is in the registry or documented in KNOWN_DRIFT', () => {
        const unaccounted = Object.entries(models)
            .filter(([name, v]) => v.requiredOrg && !registry.has(name) && !(name in KNOWN_DRIFT))
            .map(([name, v]) => `${name} (${v.file})`);
        expect(unaccounted).toEqual([]); // new tenant-owned model? add to TENANT_SCOPED_MODELS (default) or document the exemption
    });

    it('KNOWN_DRIFT is a ratchet — every exemption is still genuinely drifted', () => {
        const stale = Object.keys(KNOWN_DRIFT).filter(
            (name) => registry.has(name) || !models[name] || !models[name].requiredOrg,
        );
        expect(stale).toEqual([]); // model was registered/renamed → delete its exemption
    });

    it('every registry entry exists in the schema with a REQUIRED organizationId (no stale entries)', () => {
        const stale = [...registry].filter((name) => !models[name] || !models[name].requiredOrg);
        expect(stale).toEqual([]);
    });

    it('sanity floor — the scanner still parses the schema (regex not silently broken)', () => {
        expect(Object.keys(models).length).toBeGreaterThanOrEqual(80);
        expect(registry.size).toBeGreaterThanOrEqual(50);
        // spot-pin two knowns from opposite sides
        expect(models.Application.requiredOrg).toBe(true);
        expect(registry.has('Application')).toBe(true);
    });
});
