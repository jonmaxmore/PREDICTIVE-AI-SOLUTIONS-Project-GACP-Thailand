'use strict';

/**
 * Machine guard for operator ruling 2026-09-26 ("เวลาไทยทั้งหมด"): business code
 * reads days, months, years and clock times only through the Bangkok zone
 * helpers. The rules and blind spots are listed in
 * test-support/business-date-scan.js.
 *
 * What it scans (non-test source only; *.test.* and __tests__/ are skipped):
 *   backend: services/ routes/ controllers/ jobs/ cron/ shared/ utils/ config/
 *            middleware/ modules/ constants/ validation/ and server.js
 *            — every .js file; not scripts/ or prisma/ (operator tooling).
 *   web-app: every .ts/.tsx under src/ that is NOT a 'use client' module (server
 *            components, route helpers, services, page configs, shared
 *            formatters), plus the client modules named in WEB_CLIENT_FILES
 *            that compute business days (finance period pickers, the date
 *            input). Other 'use client' components render in the viewer's
 *            browser and are out of this guard's scope.
 * Allowed to touch the raw clock: the two zone helpers in ZONE_HELPERS.
 */

const fs = require('fs');
const path = require('path');
const { scanSource } = require('../../test-support/business-date-scan');

const BACKEND = path.resolve(__dirname, '../..');
const WEB_SRC = path.resolve(BACKEND, '../web-app/src');

const BACKEND_DIRS = [
    'services', 'routes', 'controllers', 'jobs', 'cron', 'shared', 'utils', 'config',
    'middleware', 'modules', 'constants', 'validation', 'server.js',
];
const WEB_CLIENT_FILES = [
    'app/provider/accounting/wht/client-view.tsx',
    'components/ui/date-input.tsx',
];
const ZONE_HELPERS = new Set([
    path.join(BACKEND, 'utils/working-days.js'),
    path.join(WEB_SRC, 'lib/format/thai-date.ts'),
]);

function walk(target, exts) {
    if (!fs.existsSync(target)) { return []; }
    if (fs.statSync(target).isFile()) { return [target]; }
    return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(target, entry.name);
        if (entry.isDirectory()) {
            return ['node_modules', '__tests__', '__mocks__'].includes(entry.name) ? [] : walk(full, exts);
        }
        if (!exts.some((ext) => entry.name.endsWith(ext))) { return []; }
        if (/\.(test|spec)\.[jt]sx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) { return []; }
        return [full];
    });
}

function isClientModule(src) {
    return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use client['"]/.test(src);
}

function scannedFiles() {
    const backend = BACKEND_DIRS.flatMap((d) => walk(path.join(BACKEND, d), ['.js']));
    const web = walk(WEB_SRC, ['.ts', '.tsx']).filter((f) => {
        const rel = path.relative(WEB_SRC, f);
        return WEB_CLIENT_FILES.includes(rel) || !isClientModule(fs.readFileSync(f, 'utf8'));
    });
    return [...backend, ...web].filter((f) => !ZONE_HELPERS.has(f));
}

describe('the scanner (selftest: it fails on each forbidden shape and passes the zoned ones)', () => {
    it.each([
        ['const y = new Date().getFullYear() + 543;', 'process-clock calendar/clock read or write'],
        ['d.setHours(0, 0, 0, 0);', 'process-clock calendar/clock read or write'],
        ['const m = d.getUTCMonth() + 1;', 'UTC calendar/clock read'],
        // Fix round 2 (re-review blind spots):
        ['if (when.toDateString() === now.toDateString()) {}', 'process-clock day string (toDateString)'],
        ["const s = when.toLocaleString('th-TH');", 'locale date/time without timeZone'],
        ["const s = row.createdAt.toLocaleString('th-TH');", 'locale date/time without timeZone'],
        ["const s = x.toLocaleString('th-TH');", 'locale date/time without timeZone'],
        ['const hh = d.getHours();', 'process-clock calendar/clock read or write'],
        ['const mm = d.getMinutes();', 'process-clock calendar/clock read or write'],
        ['const hh = d.getUTCHours();', 'UTC calendar/clock read'],
        ['const y = Date.prototype.getFullYear.call(d);', 'process-clock calendar/clock read or write'],
        ['const day = d.toJSON().slice(0, 10);', 'UTC ISO day/month slice'],
        ['const start = new Date(`${day}T00:00:00`);', 'zone-less wall-clock parse (reads the time in the process zone)'],
        ["const at = new Date('2026-09-17T09:00');", 'zone-less wall-clock parse (reads the time in the process zone)'],
        // Fix round 3 (re-review 2 blind spots):
        ["const s = user.lastLogin.toLocaleString('th-TH');", 'locale date/time without timeZone'],
        ["const s = cert.expiration.toLocaleString('th-TH');", 'locale date/time without timeZone'],
        ["const s = row.createdOn.toLocaleString('th-TH');", 'locale date/time without timeZone'],
        ["const s = session.toLocaleString('th-TH');", 'locale date/time without timeZone'],
        ["const s = (row.createdAt || now).toLocaleString('th-TH');", 'locale date/time without timeZone'],
        ["const s = invoice.due.toLocaleString('th-TH');", 'locale date/time without timeZone'],
        ["const at = new Date(day + 'T00:00:00');", 'zone-less wall-clock parse (reads the time in the process zone)'],
        ["const y = d['getFullYear']();", 'calendar/clock method called by computed name'],
        ["const day = new Date().toISOString().slice(0, 10);", 'UTC ISO day/month slice'],
        ["const day = new Date().toISOString().split('T')[0];", 'UTC ISO day/month slice'],
        ["d.toLocaleDateString('th-TH')", 'locale date/time without timeZone'],
        ["d.toLocaleTimeString('th-TH', { hour: '2-digit' })", 'locale date/time without timeZone'],
        ["new Date(x).toLocaleString('th-TH')", 'locale date/time without timeZone'],
        ["new Intl.DateTimeFormat('th-TH', {\n  year: 'numeric',\n  month: 'long',\n})", 'locale date/time without timeZone'],
        ['const start = new Date(y, m - 1, 1);', 'multi-argument new Date (process-clock calendar)'],
    ])('flags %s', (src, rule) => {
        expect(scanSource(src).map((h) => h.rule)).toContain(rule);
    });

    it.each([
        ["d.toLocaleDateString('th-TH', { timeZone: DEFAULT_TIME_ZONE })"],
        ["new Intl.DateTimeFormat('th-TH', {\n  timeZone: THAI_TIME_ZONE,\n  year: 'numeric',\n})"],
        ["amount.toLocaleString('th-TH')"],
        ["Number(v).toLocaleString('th-TH')"],
        ["invoice.totalAmount.toLocaleString('th-TH')"],
        ["(a + b).toLocaleString()"],
        ["(data.amount || 0).toLocaleString()"],
        ["n.toLocaleString('th-TH', { minimumFractionDigits: 2 })"],
        ["invoice.dueAmount.toLocaleString('th-TH')"],
        ["const at = new Date(day + 'T00:00:00+07:00');"],
        ['const start = new Date(`${day}T00:00:00+07:00`);'],
        ["const at = new Date('2026-09-17T02:00:00.000Z');"],
        ['const due = new Date(Date.UTC(y, m, 15));'],
        ['const later = new Date(\n    issued.getTime() + ms,\n);'],
        ['// comment: d.getFullYear() would be wrong here'],
        ['/* d.getDate() */ const x = getZonedParts(d).day;'],
    ])('passes %s', (src) => {
        expect(scanSource(src)).toEqual([]);
    });
});

describe('business code reads dates only through the Bangkok zone helpers', () => {
    const files = scannedFiles();

    it('scans a real tree (not an empty glob)', () => {
        const rel = files.map((f) => path.relative(path.resolve(BACKEND, '..'), f));
        expect(rel).toContain(path.join('backend', 'services', 'vat-report-service.js'));
        expect(rel).toContain(path.join('web-app', 'src', 'lib', 'services', 'accounting-service.ts'));
        expect(files.length).toBeGreaterThan(500);
    });

    it('has no process-clock or UTC calendar reads, UTC day slices or zone-less locale dates', () => {
        const offenders = [];
        for (const file of files) {
            for (const hit of scanSource(fs.readFileSync(file, 'utf8'))) {
                offenders.push(`${path.relative(path.resolve(BACKEND, '..'), file)}:${hit.line} ${hit.rule}: ${hit.text}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
