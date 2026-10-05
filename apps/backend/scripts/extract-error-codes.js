#!/usr/bin/env node
/**
 * extract-error-codes.js — cross-platform error-code extractor & auditor.
 *
 * USAGE:
 *   node scripts/extract-error-codes.js                # default: list discovered codes (text)
 *   node scripts/extract-error-codes.js --json         # emit JSON to stdout
 *   node scripts/extract-error-codes.js --validate     # exit 1 if catalog is missing codes
 *   node scripts/extract-error-codes.js --markdown     # write docs/api/error-codes.md
 *   node scripts/extract-error-codes.js --report       # human-readable drift summary
 *
 * The script walks `routes/`, `services/`, `middleware/`, `shared/`
 * under `apps/backend/` and matches three throw idioms:
 *
 *   1. `code: 'UPPER_SNAKE'`        — Express handler / direct payload
 *   2. `.code = 'UPPER_SNAKE'`      — error mutation pattern
 *   3. `makeError('UPPER_SNAKE',…)` — the service-layer factory pattern
 *
 * It then dedupes against `shared/error-codes.js` and reports any new
 * codes that lack a catalog row. In CI / pre-commit this means a new
 * throw without a catalog row breaks the build.
 *
 * Cross-platform notes:
 *   - Uses Node's fs/path only — NO shell-out to grep/rg/find.
 *   - Path separators normalized to POSIX ("/") for stable output on
 *     Windows.
 *   - Reads files as UTF-8 explicitly.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..'); // apps/backend
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..', '..');
const SCAN_DIRS = ['routes', 'services', 'middleware', 'shared'];

// Patterns where the FIRST capture group is the error code.
const SINGLE_LINE_PATTERNS = [
    /code:\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /\.code\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
];
// Multi-line factory pattern (may span lines between `(` and code arg).
const MAKE_ERROR_PATTERN = /makeError\s*\(\s*['"]([A-Z][A-Z0-9_]+)['"](?:\s*,\s*[^,)]+)?(?:\s*,\s*(\d{3}))?/g;

// Codes that LOOK like UPPER_SNAKE but are domain enums (status, province,
// herb-type, etc.) and not error codes. Skipped during dedup.
const NON_ERROR_CODES = new Set([
    // Herb / plant types
    'CANNABIS', 'HEMP', 'KRATOM', 'TURMERIC', 'ANDROGRAPHIS',
    'ALOE_VERA', 'INDIAN_GOOSEBERRY', 'PHLAI',
    // Cultivation methods
    'AEROPONIC', 'HYDROPONIC', 'SOILLESS', 'CONVENTIONAL',
    'ORGANIC', 'GREENHOUSE', 'INDOOR', 'OUTDOOR', 'MIXED',
    // Provinces (Thai ISO codes)
    'BKK', 'CNX', 'NST', 'NKI', 'KKN', 'PKT', 'SKA', 'UDN', 'CBI', 'RYG',
    // Application lifecycle states (not errors)
    'NEW', 'AMENDMENT', 'RENEWAL', 'EXPANSION', 'DRAFT', 'SUBMITTED',
    'REGISTERED', 'APPROVED', 'ASSIGNED_FOR_REVIEW', 'AUDIT_CONFIRMED',
    'AUDIT_FEE_PAID', 'AUDIT_PASSED', 'CAR_PENDING', 'CANCEL_EXPIRED',
    'CERTIFIED', 'DOC_APPROVED', 'DOC_FEE_PAID', 'PENDING_AUDIT_FEE',
    'PENDING_DOC_FEE', 'REVISION_REQUESTED', 'PROCESSING',
    // Business types
    'INDIVIDUAL', 'JURISTIC', 'COMMUNITY_ENTERPRISE',
    // Categories
    'RESEARCH', 'CULTIVATION',
    'STORAGE', 'GAP', 'CONTROLLED', 'NURSERY', 'EXPORT',
    // Report types (Thai forms)
    'PT27', 'PT28', 'PT29', 'PT30', 'PT31', 'PT32',
    // Invoice line-item codes (Wave 2 checkout breakdown) — `code:` here is
    // the InvoiceLineItem.code column, not an error payload.
    // W14 added STATE_FEE: the single-issuer settlement document shows ราคาเต็ม
    // and ค่าแพลตฟอร์ม as two lines of ONE company invoice.
    'DTAM_FEE', 'PLATFORM_FEE', 'PLATFORM_VAT', 'STATE_FEE',
]);

function walk(dir, acc) {
    if (!fs.existsSync(dir)) {
        return;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' ||
                entry.name === '__tests__' ||
                entry.name === '.next' ||
                entry.name.startsWith('.')) {
                continue;
            }
            walk(fullPath, acc);
        } else if (entry.isFile() &&
                   (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
            acc.push(fullPath);
        }
    }
}

function toPosix(absolute) {
    return path.relative(BACKEND_ROOT, absolute).split(path.sep).join('/');
}

function extract() {
    const files = [];
    for (const sub of SCAN_DIRS) {
        walk(path.join(BACKEND_ROOT, sub), files);
    }

    const codes = new Map();

    function record(code, file, lineNum, statusGuess) {
        if (NON_ERROR_CODES.has(code)) {
            return;
        }
        if (!codes.has(code)) {
            codes.set(code, {
                code,
                source: `${toPosix(file)}:${lineNum}`,
                httpStatus: statusGuess || 400,
                occurrences: 1,
            });
        } else {
            codes.get(code).occurrences += 1;
        }
    }

    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        // Multi-line factory pattern across whole file.
        MAKE_ERROR_PATTERN.lastIndex = 0;
        let m;
        while ((m = MAKE_ERROR_PATTERN.exec(content)) !== null) {
            const code = m[1];
            const status = m[2] ? parseInt(m[2], 10) : 400;
            const upTo = content.slice(0, m.index);
            const lineNum = upTo.split('\n').length;
            record(code, file, lineNum, status);
        }
        // Single-line patterns.
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (const pat of SINGLE_LINE_PATTERNS) {
                pat.lastIndex = 0;
                let mm;
                while ((mm = pat.exec(line)) !== null) {
                    const code = mm[1];
                    // Status guess: look around lines for res.status() or status:
                    let status = 400;
                    for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) {
                        const sm = lines[j].match(/res\.status\(\s*(\d{3})\s*\)/);
                        if (sm) { status = parseInt(sm[1], 10); break; }
                        const sm2 = lines[j].match(/status:\s*(\d{3})/);
                        if (sm2) { status = parseInt(sm2[1], 10); break; }
                    }
                    record(code, file, i + 1, status);
                }
            }
        }
    }

    return codes;
}

function loadCatalog() {
    const catalogPath = path.join(BACKEND_ROOT, 'shared', 'error-codes.js');
    if (!fs.existsSync(catalogPath)) {
        return null;
    }
    // Require fresh — drop any cached version.
    delete require.cache[catalogPath];
    return require(catalogPath).ERROR_CODES;
}

function emitMarkdown(catalog) {
    const docPath = path.join(REPO_ROOT, 'docs', 'api', 'error-codes.md');
    fs.mkdirSync(path.dirname(docPath), { recursive: true });

    const buckets = new Map();
    for (const entry of Object.values(catalog)) {
        const bucket = entry.httpStatus;
        if (!buckets.has(bucket)) {
            buckets.set(bucket, []);
        }
        buckets.get(bucket).push(entry);
    }

    const sortedStatuses = [...buckets.keys()].sort((a, b) => a - b);
    const STATUS_LABEL = {
        400: '400 Bad Request',
        401: '401 Unauthorized',
        402: '402 Payment Required',
        403: '403 Forbidden',
        404: '404 Not Found',
        409: '409 Conflict',
        410: '410 Gone',
        422: '422 Unprocessable Entity',
        429: '429 Too Many Requests',
        500: '500 Internal Server Error',
        503: '503 Service Unavailable',
    };

    const lines = [];
    lines.push('# GACP API — Error Code Catalog');
    lines.push('');
    lines.push('> Auto-generated by `apps/backend/scripts/extract-error-codes.js`.');
    lines.push('> Do not edit by hand — update `apps/backend/shared/error-codes.js`');
    lines.push('> and re-run the extractor with `--markdown`.');
    lines.push('');
    lines.push(`Total entries: **${Object.keys(catalog).length}**`);
    lines.push('');
    lines.push('Catalog rows pair each code with a 4xx/5xx HTTP status, English +');
    lines.push('Thai message, source file/line where the code is canonically');
    lines.push('thrown, and a one-line remediation hint for integrators.');
    lines.push('');
    lines.push('Bilingual rationale: GACP is a Thai government-facing certification');
    lines.push('platform (กรมการแพทย์แผนไทย / DTAM). Error messages surface to Thai');
    lines.push('applicants in the wizard UI and to international integrators via');
    lines.push('the JSON envelope, so every catalog row carries both languages.');
    lines.push('');
    lines.push('## Table of contents');
    lines.push('');
    for (const status of sortedStatuses) {
        const label = STATUS_LABEL[status] || `${status}`;
        lines.push(`- [${label}](#${String(status)})`);
    }
    lines.push('');

    for (const status of sortedStatuses) {
        const label = STATUS_LABEL[status] || `${status}`;
        lines.push(`<a id="${String(status)}"></a>`);
        lines.push(`## ${label}`);
        lines.push('');
        const entries = buckets.get(status).slice().sort((a, b) => a.code.localeCompare(b.code));
        for (const entry of entries) {
            lines.push(`### \`${entry.code}\``);
            lines.push('');
            lines.push(`- **HTTP**: \`${entry.httpStatus}\``);
            lines.push(`- **EN**: ${entry.messageEn}`);
            lines.push(`- **TH**: ${entry.messageTh}`);
            lines.push(`- **Source**: \`${entry.source}\``);
            lines.push(`- **Remediation**: ${entry.remediation}`);
            lines.push('');
        }
    }

    fs.writeFileSync(docPath, lines.join('\n'), 'utf8');
    return docPath;
}

function main() {
    const args = process.argv.slice(2);
    const mode = args[0] || '--list';

    const discovered = extract();
    const catalog = loadCatalog();

    if (mode === '--list' || mode === '') {
        const sorted = [...discovered.keys()].sort();
         
        console.log(`Discovered ${sorted.length} unique error codes:`);
        for (const code of sorted) {
            const row = discovered.get(code);
            const known = catalog && catalog[code] ? 'OK ' : 'NEW';
             
            console.log(`[${known}] ${code} | ${row.httpStatus} | ${row.source}`);
        }
        return 0;
    }

    if (mode === '--json') {
        const payload = {
            discovered: Object.fromEntries(discovered),
            catalogSize: catalog ? Object.keys(catalog).length : 0,
        };
         
        console.log(JSON.stringify(payload, null, 2));
        return 0;
    }

    if (mode === '--validate') {
        if (!catalog) {
             
            console.error('ERROR: shared/error-codes.js not found');
            return 1;
        }
        const missing = [];
        for (const code of discovered.keys()) {
            if (!catalog[code]) {
                missing.push(code);
            }
        }
        if (missing.length > 0) {
             
            console.error(`VALIDATION FAILED: ${missing.length} discovered codes missing from catalog`);
             
            console.error(missing.sort().join('\n'));
            return 1;
        }
         
        console.log(`VALIDATION OK - catalog has ${Object.keys(catalog).length} entries; ${discovered.size} codes reconciled.`);
        return 0;
    }

    if (mode === '--markdown') {
        if (!catalog) {
             
            console.error('ERROR: cannot render markdown - catalog missing');
            return 1;
        }
        const outPath = emitMarkdown(catalog);
         
        console.log(`Wrote ${outPath}`);
        return 0;
    }

    if (mode === '--report') {
        const known = catalog ? Object.keys(catalog).length : 0;
        const newOnes = [];
        const orphans = [];
        if (catalog) {
            for (const code of discovered.keys()) {
                if (!catalog[code]) { newOnes.push(code); }
            }
            for (const code of Object.keys(catalog)) {
                if (!discovered.has(code)) { orphans.push(code); }
            }
        }
         
        console.log('Error-code drift report');
         
        console.log('========================');
         
        console.log(`Catalog size: ${known}`);
         
        console.log(`Codes discovered in code: ${discovered.size}`);
         
        console.log(`Discovered but not catalogued (NEW): ${newOnes.length}`);
        if (newOnes.length > 0) {
             
            console.log('  ' + newOnes.sort().join(', '));
        }
         
        console.log(`Catalogued but not discovered (ORPHAN): ${orphans.length}`);
        if (orphans.length > 0) {
             
            console.log('  ' + orphans.sort().join(', '));
        }
        return 0;
    }

     
    console.error(`Unknown mode: ${mode}`);
     
    console.error('Usage: extract-error-codes.js [--list|--json|--validate|--markdown|--report]');
    return 2;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { extract, loadCatalog, emitMarkdown };
