#!/usr/bin/env node
/**
 * check-secrets.js — Iter 27 pre-deploy gate
 *
 * Runs the catalog-driven production-readiness validation defined in
 * `config/secrets.js` and exits non-zero if any required secret is missing,
 * holds the `PENDING_FINANCE_CONFIRMATION` sentinel, or is shorter than its
 * minimum length.
 *
 * Usage:
 *   node apps/backend/scripts/check-secrets.js              # validate current NODE_ENV
 *   node apps/backend/scripts/check-secrets.js --env=production
 *   node apps/backend/scripts/check-secrets.js --json       # machine-readable output
 *
 * CI / deploy pipeline contract:
 *   - exit 0  → all production-required secrets are present + meet minLength
 *   - exit 1  → at least one secret is MISSING_OR_PENDING or TOO_SHORT
 *   - exit 2  → unexpected internal error (script bug, not a config issue)
 *
 * The script intentionally reads from `process.env` directly (not from a
 * dev/test fallback) so that pre-deploy runs catch the case "dev fallback
 * masked a missing secret".
 */

'use strict';

const {
    validateSecretsForEnvironment,
    SECRETS_CATALOG,
    getActiveBackend,
} = require('../config/secrets');

function parseArgs(argv) {
    const args = { env: process.env.NODE_ENV || 'production', json: false };
    for (const raw of argv.slice(2)) {
        if (raw === '--json') {args.json = true;}
        else if (raw.startsWith('--env=')) {args.env = raw.slice('--env='.length);}
        else if (raw === '--help' || raw === '-h') {args.help = true;}
    }
    return args;
}

function printHelp() {
    process.stdout.write(
        'Usage: node apps/backend/scripts/check-secrets.js [--env=<NODE_ENV>] [--json]\n'
        + '\n'
        + 'Exits 0 when all production-required secrets are present and valid.\n'
        + 'Exits 1 when one or more secrets are MISSING_OR_PENDING or TOO_SHORT.\n',
    );
}

function formatHuman(errors, env) {
    const lines = [];
    lines.push('');
    lines.push('================================================================');
    lines.push(`  Secret-Catalog Readiness Check — NODE_ENV=${env}`);
    lines.push(`  Backend: ${getActiveBackend()}`);
    lines.push(`  Catalog size: ${Object.keys(SECRETS_CATALOG).length} entries`);
    lines.push('================================================================');
    if (errors.length === 0) {
        lines.push('OK — all required secrets present and valid for this environment.');
        lines.push('');
        return lines.join('\n');
    }

    lines.push(`FAIL — ${errors.length} secret(s) need attention before deploy:`);
    lines.push('');
    for (const err of errors) {
        const required = err.spec.required === 'always' ? 'ALWAYS' : 'PRODUCTION';
        lines.push(`  [${err.reason}] ${err.name}  (required: ${required})`);
        lines.push(`     ${err.spec.description}`);
        if (err.spec.usedIn && err.spec.usedIn.length > 0) {
            lines.push(`     used in: ${err.spec.usedIn.join(', ')}`);
        }
        if (err.reason === 'TOO_SHORT') {
            lines.push(`     length: ${err.actualLength} (need >= ${err.spec.minLength})`);
        }
        lines.push('');
    }
    lines.push('Fix: set the env var in the production secret manager (or .env for local).');
    lines.push('     Sentinel "PENDING_FINANCE_CONFIRMATION" counts as MISSING.');
    lines.push('');
    return lines.join('\n');
}

function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    let errors;
    try {
        errors = validateSecretsForEnvironment(args.env);
    } catch (err) {
        process.stderr.write(`[check-secrets] internal error: ${err.message}\n`);
        process.exit(2);
    }

    if (args.json) {
        process.stdout.write(JSON.stringify({
            ok: errors.length === 0,
            env: args.env,
            backend: getActiveBackend(),
            catalogSize: Object.keys(SECRETS_CATALOG).length,
            errors,
        }, null, 2) + '\n');
    } else {
        process.stdout.write(formatHuman(errors, args.env));
    }

    process.exit(errors.length === 0 ? 0 : 1);
}

if (require.main === module) {
    main();
}

module.exports = { parseArgs, formatHuman };
