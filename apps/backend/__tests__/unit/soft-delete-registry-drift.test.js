/**
 * DB-03 drift guard — the soft-delete registry is hand-maintained, and the audit
 * found it had silently diverged from the schema by 7 models (CreditNote,
 * DebitNote, Entity, JournalEntry, Organization, PurchaseInvoice, Quotation):
 * they carry an `isDeleted` column but were absent from SOFT_DELETE_MODELS, so
 * their reads were NOT auto-filtered and every caller had to remember
 * `where: { isDeleted: false }` by hand.
 *
 * This test parses the Prisma schema at runtime and asserts every model that
 * carries an `isDeleted` field is classified in EXACTLY ONE of:
 *   - SOFT_DELETE_MODELS          (auto-filtered by soft-delete-extension), or
 *   - SOFT_DELETE_EXEMPT_MODELS   (deliberately not auto-filtered)
 *
 * and that neither set names a model that lacks the column. Adding or removing
 * `isDeleted` on any model now fails here until the change is reflected in the
 * registry — the drift can no longer happen unnoticed.
 */

const fs = require('fs');
const path = require('path');
const {
    SOFT_DELETE_MODELS,
    SOFT_DELETE_EXEMPT_MODELS,
} = require('../../services/soft-delete-extension');

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'prisma', 'schema');

/**
 * Parse every `prisma/schema/*.prisma` file and return the set of model names
 * whose block contains an `isDeleted` field. Deliberately simple — mirrors the
 * `model … { … isDeleted … }` shape the extension cares about, nothing more.
 */
function modelsWithIsDeletedFromSchema() {
    const found = new Set();
    const files = fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'));
    for (const file of files) {
        const text = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
        const lines = text.split('\n');
        let currentModel = null;
        let hasIsDeleted = false;
        for (const raw of lines) {
            const line = raw.trim();
            const open = line.match(/^model\s+([A-Za-z0-9_]+)\s*\{/);
            if (open) {
                currentModel = open[1];
                hasIsDeleted = false;
                continue;
            }
            if (currentModel) {
                if (/^isDeleted\s+/.test(line)) {
                    hasIsDeleted = true;
                }
                if (line === '}') {
                    if (hasIsDeleted) {
                        found.add(currentModel);
                    }
                    currentModel = null;
                    hasIsDeleted = false;
                }
            }
        }
    }
    return found;
}

describe('DB-03 — soft-delete registry stays in sync with the schema', () => {
    const schemaModels = modelsWithIsDeletedFromSchema();

    it('finds the isDeleted-bearing models in the schema (sanity: parser works)', () => {
        // If this drops to ~0 the parser broke and every assertion below would
        // pass vacuously. Pin a floor and a couple of known members.
        expect(schemaModels.size).toBeGreaterThanOrEqual(20);
        expect(schemaModels.has('Application')).toBe(true);
        expect(schemaModels.has('CreditNote')).toBe(true);
    });

    it('every isDeleted model is classified in EXACTLY ONE registry set', () => {
        const unclassified = [];
        const doubleClassified = [];
        for (const model of schemaModels) {
            const inAuto = SOFT_DELETE_MODELS.has(model);
            const inExempt = SOFT_DELETE_EXEMPT_MODELS.has(model);
            if (!inAuto && !inExempt) { unclassified.push(model); }
            if (inAuto && inExempt) { doubleClassified.push(model); }
        }
        // unclassified === the original DB-03 drift (silent absence).
        expect({ unclassified, doubleClassified }).toEqual({
            unclassified: [],
            doubleClassified: [],
        });
    });

    it('neither registry set names a model that lacks an isDeleted column (no stale entries)', () => {
        const staleAuto = [...SOFT_DELETE_MODELS].filter((m) => !schemaModels.has(m));
        const staleExempt = [...SOFT_DELETE_EXEMPT_MODELS].filter((m) => !schemaModels.has(m));
        expect({ staleAuto, staleExempt }).toEqual({ staleAuto: [], staleExempt: [] });
    });

    it('the two registry sets are disjoint', () => {
        const overlap = [...SOFT_DELETE_EXEMPT_MODELS].filter((m) => SOFT_DELETE_MODELS.has(m));
        expect(overlap).toEqual([]);
    });

    it('pins the DB-03 exempt set to the seven verified models', () => {
        // Locks the deliberate-exemption decision. Changing this set is a
        // conscious act that must update this list in the same commit.
        expect([...SOFT_DELETE_EXEMPT_MODELS].sort()).toEqual([
            'CreditNote',
            'DebitNote',
            'Entity',
            'JournalEntry',
            'Organization',
            'PurchaseInvoice',
            'Quotation',
        ]);
    });
});
