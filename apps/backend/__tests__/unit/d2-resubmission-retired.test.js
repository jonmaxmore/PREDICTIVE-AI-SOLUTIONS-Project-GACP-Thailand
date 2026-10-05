'use strict';

/**
 * R2 mechanism-1 M6 / D-2 (evidence/R2-special-reopen/decisions-final.md:15,66):
 * the "แก้ไขได้ไม่เกิน 3 ครั้ง" (max-3-resubmissions) rule and its resubmission
 * fee are PERMANENTLY CANCELLED. This is a filesystem grep-pin that fails if any
 * of the retired symbols is ever re-introduced into backend source, so a dead
 * fee/threshold can never silently come back and change money behaviour.
 *
 * Retired (proven dead — imported/defined but never read in any branch, fee
 * calculation, invoice line, or checkout amount at removal time):
 *   - SUBMISSION_THRESHOLD  (was = 3)   modules/billing/internal/payment-constants.js
 *   - FEES.RESUBMISSION     (was = 5000) config/business-rules.js FEE_DEFAULTS
 *   - keyMap 'fee.resubmission' SystemConfig override  config/business-rules.js
 *   - CONFIG.resubmissionStateRate (only reader of FEES.RESUBMISSION)
 *   - PAYMENT_TYPES value 'resubmission'
 *
 * The patterns are deliberately precise so they do NOT match unrelated, still-live
 * symbols that merely share the substring RESUBMISSION:
 *   - NotifyType.RESUBMISSION_RECEIVED (services/notification-service.js) — a live
 *     NOTIFICATION type, unrelated to the fee.
 *
 * PAYMENT.RESUBMISSION_FEE was the one this file left open — "separate dead
 * constant, out of D-2 scope, left for the reviewer to decide". The operator
 * decided on 2026-09-05 ("hardcode ที่เป็นตัวเลขเก่า ให้ทำการคลีนทั้งหมด") and it is
 * deleted. Verified dead first: `grep -rn RESUBMISSION_FEE` across services,
 * modules, routes, controllers, shared, config, jobs, middleware, constants,
 * utils and scripts returned exactly one line — its own declaration. It is
 * pinned below with the rest, so the amount cannot return by habit.
 *   - NotifyType.RESUBMISSION_RECEIVED (services/notification-service.js) — a live
 *     NOTIFICATION type, unrelated to the fee.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

// Source dirs that could contain a real reference (exclude __tests__, node_modules).
const SOURCE_DIRS = [
    'services', 'modules', 'routes', 'controllers',
    'shared', 'config', 'jobs', 'middleware', 'constants', 'utils',
];

// The exact retired symbols. Each pattern matches ONLY the retired form.
const RETIRED = [
    { name: 'SUBMISSION_THRESHOLD (max-3-resubmissions counter)', re: /\bSUBMISSION_THRESHOLD\b/ },
    { name: 'CONFIG.resubmissionStateRate (dead resubmission fee rate)', re: /\bresubmissionStateRate\b/ },
    // Deleted 2026-09-05 — see the header. Matches the declaration form only, so
    // NotifyType.RESUBMISSION_RECEIVED and any live symbol sharing the substring
    // stay unaffected.
    { name: 'PAYMENT.RESUBMISSION_FEE (dead 5,000 THB in the fee config)', re: /\bRESUBMISSION_FEE\s*:/ },
    { name: 'resubmissionAmount (pre-rename dead fee field)', re: /\bresubmissionAmount\b/ },
    { name: "SystemConfig key 'fee.resubmission'", re: /fee\.resubmission/ },
    { name: 'FEES.RESUBMISSION (dead resubmission fee default)', re: /FEES\.RESUBMISSION\b/ },
    { name: "PAYMENT_TYPES value 'resubmission'", re: /(['"])resubmission\1/ },
];

/** Recursively collect *.js / *.ts files under a dir (skipping node_modules, __tests__). */
function collectSourceFiles(dir) {
    /** @type {string[]} */
    const out = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out; // dir may not exist (e.g. no controllers/) — fine.
    }
    for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '__tests__') { continue; }
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            out.push(...collectSourceFiles(full));
        } else if (e.isFile() && /\.(js|ts)$/.test(e.name)) {
            out.push(full);
        }
    }
    return out;
}

const ALL_SOURCE_FILES = SOURCE_DIRS.flatMap((d) => collectSourceFiles(path.join(BACKEND_ROOT, d)));

/** Return "relpath:line" for every line in backend source matching `re`. */
function hitsFor(re) {
    const hits = [];
    for (const file of ALL_SOURCE_FILES) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
            if (re.test(lines[i])) {
                hits.push(`${path.relative(BACKEND_ROOT, file)}:${i + 1}`);
            }
        }
    }
    return hits;
}

describe('R2 D-2 — retired max-3-resubmissions config has ZERO backend references', () => {
    test('the grep-pin actually scanned a non-trivial backend surface', () => {
        // Guards against a silently-broken scan reporting a false PASS.
        expect(ALL_SOURCE_FILES.length).toBeGreaterThan(100);
    });

    test.each(RETIRED)('no backend source references $name', ({ re }) => {
        expect(hitsFor(re)).toEqual([]);
    });
});
