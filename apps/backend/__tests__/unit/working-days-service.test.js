/**
 * Unit tests for services/working-days-service.js.
 *
 * This module is DISTINCT from utils/working-days.js (the ICT-aware deadline
 * calculator covered by working-days.test.js). The service module powers the
 * applicant status payload (routes/api/helpers/application-payload-builders.js),
 * the /auto-cancel cron reminder window, and the working-days API.
 *
 * Regression focus — `countWorkingDays` used to name its second parameter
 * `toDate`, shadowing the module-level `toDate()` date-parser helper. Every
 * call therefore threw `TypeError: toDate is not a function`, 500-ing the
 * applicant status endpoints precisely while an application sat in
 * REVISION_REQUESTED / CAR_PENDING with a live deadline. The parameter was
 * renamed to `toDateValue`; these tests lock that it parses dates and counts
 * correctly and never throws.
 *
 * Dates use the local-component `new Date(year, monthIndex, day)` form so the
 * weekday is deterministic regardless of host TZ (the module reads getDay()/
 * getFullYear() in local time). June 1 2026 is a Monday.
 */

const fs = require('fs');
const path = require('path');

const workingDaysService = require('../../services/working-days-service');
const {
    isWorkingDay,
    addWorkingDays,
    countWorkingDays,
    toDateKey,
} = workingDaysService;

const MON_JUN_1 = new Date(2026, 5, 1);   // Monday
const FRI_JUN_5 = new Date(2026, 5, 5);   // Friday
const SAT_JUN_6 = new Date(2026, 5, 6);   // Saturday
const SUN_JUN_7 = new Date(2026, 5, 7);   // Sunday
const MON_JUN_8 = new Date(2026, 5, 8);   // Monday (next week)

describe('working-days-service — countWorkingDays (regression: shadowed toDate)', () => {
    it('does NOT throw (the parameter no longer shadows the toDate helper)', () => {
        expect(() => countWorkingDays(MON_JUN_1, FRI_JUN_5)).not.toThrow();
    });

    it('counts Mon–Fri inclusive as 5 working days', () => {
        expect(countWorkingDays(MON_JUN_1, FRI_JUN_5)).toBe(5);
    });

    it('counts Mon–next-Mon inclusive as 6 working days (skips the weekend)', () => {
        expect(countWorkingDays(MON_JUN_1, MON_JUN_8)).toBe(6);
    });

    it('counts a pure weekend (Sat–Sun) as 0', () => {
        expect(countWorkingDays(SAT_JUN_6, SUN_JUN_7)).toBe(0);
    });

    it('returns 0 for a reversed range (from > to)', () => {
        expect(countWorkingDays(FRI_JUN_5, MON_JUN_1)).toBe(0);
    });

    it('excludes a holiday inside the range', () => {
        // Wed Jun 3 declared a holiday → Mon–Fri drops to 4.
        const holidays = new Set([toDateKey(new Date(2026, 5, 3))]);
        expect(countWorkingDays(MON_JUN_1, FRI_JUN_5, holidays)).toBe(4);
    });

    it('accepts ISO-string inputs (parsed via the toDate helper)', () => {
        expect(countWorkingDays('2026-06-01T00:00:00+07:00', '2026-06-01T00:00:00+07:00')).toBeGreaterThanOrEqual(0);
    });

    it('returns 0 when either endpoint is unparseable', () => {
        expect(countWorkingDays('not-a-date', FRI_JUN_5)).toBe(0);
        expect(countWorkingDays(MON_JUN_1, 'not-a-date')).toBe(0);
    });
});

describe('working-days-service — sibling helpers (baseline coverage)', () => {
    it('isWorkingDay: weekday true, weekend false, holiday false', () => {
        expect(isWorkingDay(MON_JUN_1)).toBe(true);
        expect(isWorkingDay(SAT_JUN_6)).toBe(false);
        expect(isWorkingDay(MON_JUN_1, new Set([toDateKey(MON_JUN_1)]))).toBe(false);
    });

    it('addWorkingDays: +5 from Monday lands on the next Monday (skips weekend)', () => {
        const result = addWorkingDays(MON_JUN_1, 5);
        expect(toDateKey(result)).toBe(toDateKey(MON_JUN_8));
    });

    it('addWorkingDays: 0/negative returns the start date unchanged', () => {
        expect(toDateKey(addWorkingDays(MON_JUN_1, 0))).toBe(toDateKey(MON_JUN_1));
    });

    it('toDateKey: formats YYYY-MM-DD and rejects garbage', () => {
        expect(toDateKey(MON_JUN_1)).toBe('2026-06-01');
        expect(toDateKey('not-a-date')).toBeNull();
    });
});

/**
 * L-001 (the audit ledger) — SSOT pin for the Thai holiday calendar.
 *
 * The backend had TWO holiday sources: the canonical ICT calendar in
 * utils/working-days.js, and a runtime one this service built in
 * `loadHolidaySet()` out of env TH_PUBLIC_HOLIDAYS + the systemConfig row
 * `public_holidays_th`. Neither of those two inputs is seeded anywhere in the
 * repo, so the second calendar resolved to an EMPTY set in every environment
 * built from this tree — with the state of the staging DB and env NOT yet
 * verified (operator check pending, L-001 F1: a hand-set row or var on a
 * deployed system would have made that environment holiday-aware here). It was
 * a holiday source that looked authoritative, was wired into
 * /api/system/working-days and /api/cron/auto-cancel, and — everywhere this
 * repo can account for — silently contributed nothing. That is the shape of the
 * Blocker F deadline bug (workflow-reject-deadline-holiday.test.js), one
 * indirection away.
 *
 * These tests pin the collapse, NOT the arithmetic: the describe blocks above
 * still lock this module's weekend/holiday-set formulas unchanged. What is
 * pinned here is *ownership* — exactly one file under backend services/,
 * utils/, shared/ and config/ may name a holiday table. That is the same
 * assertion probe `holiday-single-source` makes (scripts/probes/holiday-
 * single-source.sh), restated in the suite so it fails in `jest` too and not
 * only in the probe runner.
 */
const BACKEND_ROOT = path.resolve(__dirname, '../..');
// Same three tokens, same four directories as scripts/probes/holiday-single-source.sh.
const HOLIDAY_SOURCE_TOKENS = /RECURRING_HOLIDAYS|PUBLIC_HOLIDAYS|EXTRA_HOLIDAYS/;
const PROBE_SCANNED_DIRS = ['services', 'utils', 'shared', 'config'];

function collectJsFiles(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
        return out;
    }
    for (const entry of entries) {
        if (entry.name === 'node_modules') { continue; }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectJsFiles(full, out);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

describe('L-001 — the Thai holiday calendar has exactly ONE defining file', () => {
    const serviceSrc = fs.readFileSync(
        path.join(BACKEND_ROOT, 'services/working-days-service.js'),
        'utf8',
    );

    it('working-days-service names no holiday table of its own', () => {
        expect(serviceSrc).not.toMatch(HOLIDAY_SOURCE_TOKENS);
    });

    it('working-days-service reads no holiday source from env or systemConfig', () => {
        expect(serviceSrc).not.toMatch(/process\.env/);
        expect(serviceSrc).not.toMatch(/systemConfig/);
        expect(serviceSrc).not.toMatch(/prisma/i);
    });

    it('working-days-service no longer exports a holiday loader', () => {
        expect(workingDaysService.loadHolidaySet).toBeUndefined();
    });

    it.each([
        'routes/api/system/system.js',
        'routes/api/system/cron.js',
    ])('%s does not build its own holiday set', (relPath) => {
        const src = fs.readFileSync(path.join(BACKEND_ROOT, relPath), 'utf8');
        expect(src).not.toMatch(/loadHolidaySet/);
        expect(src).not.toMatch(HOLIDAY_SOURCE_TOKENS);
    });

    it('exactly one file under services/ utils/ shared/ config/ defines holidays', () => {
        const defining = PROBE_SCANNED_DIRS
            .flatMap((dir) => collectJsFiles(path.join(BACKEND_ROOT, dir)))
            .filter((file) => HOLIDAY_SOURCE_TOKENS.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(BACKEND_ROOT, file).split(path.sep).join('/')) // posix-normalised: this suite first ran on Windows 2026-08-14 and failed on separators alone
            .sort();

        expect(defining).toEqual(['utils/working-days.js']);
    });
});
