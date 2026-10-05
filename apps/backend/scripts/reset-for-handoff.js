#!/usr/bin/env node
/**
 * Reset Database for Handoff — DEVELOPMENT / TEST DATABASES ONLY.
 *
 * Purges ALL user/test data (45 tables, User included) while preserving
 * system configuration (WizardStepConfig, SystemConfig, PlantSpecies, ...).
 *
 * THIS IS NOT A PRODUCTION TOOL. The previous header of this file documented a
 * `docker cp` + `docker exec` recipe against the production container, and the
 * script had neither an environment check nor a confirmation step: requiring it
 * was enough to wipe every user. Both gaps are now closed by two INDEPENDENT
 * gates. The confirmation token does not, and must not, unlock the environment
 * guard.
 *
 * GATE 1 — environment (cannot be bypassed by any flag or env var):
 *   NODE_ENV must be one of RESET_ALLOWED_ENVIRONMENTS (development, test).
 *   production and staging are refused. An unset, blank or unrecognised
 *   NODE_ENV is ALSO refused: this script is run by hand, and a missing value
 *   is the most dangerous state, so the allowlist is fail-closed rather than a
 *   denylist of two names.
 *
 * GATE 2 — confirmation (one of three, checked only after gate 1 passes).
 *   The plan (target database name + table count) is printed first, so the
 *   operator confirms against what is actually about to be deleted:
 *     a) --yes-i-understand              non-interactive, e.g. CI-free scripts
 *     b) CONFIRM_RESET_FOR_HANDOFF=<db>  echo the exact target database name;
 *                                        works under `docker exec` with no TTY
 *     c) interactive prompt              only when stdin is a TTY; the operator
 *                                        types the exact target database name
 *
 * Usage (local development database):
 *   NODE_ENV=development node apps/backend/scripts/reset-for-handoff.js
 *     -> prints the plan, then prompts for the database name
 *
 *   NODE_ENV=development CONFIRM_RESET_FOR_HANDOFF=gacp_local \
 *     node apps/backend/scripts/reset-for-handoff.js
 *     -> no TTY needed
 *
 * Exit codes: 0 ok | 1 fatal | 2 environment refused | 3 not confirmed.
 *
 * For a UAT/staging wipe use scripts/clear-for-uat.js instead — it is
 * schema-driven (DMMF) rather than a hand-listed DELETE_ORDER that rots.
 */

'use strict';

const EXIT_CODES = Object.freeze({
    OK: 0,
    FATAL: 1,
    ENVIRONMENT_BLOCKED: 2,
    NOT_CONFIRMED: 3,
});

// Fail-closed allowlist. Adding an entry here is a decision to let this script
// wipe that environment, so it is deliberately not derived from anything.
const RESET_ALLOWED_ENVIRONMENTS = Object.freeze(['development', 'test']);
const RESET_CONFIRM_FLAG = '--yes-i-understand';
const RESET_CONFIRM_ENV = 'CONFIRM_RESET_FOR_HANDOFF';

class ResetRefused extends Error {
    constructor(message, exitCode) {
        super(message);
        this.name = 'ResetRefused';
        this.exitCode = exitCode;
    }
}

// Tables to PRESERVE (system config needed for app to function)
const PRESERVE_TABLES = [
    'WizardStepConfig',
    'SystemConfig',
    'PlantSpecies',
    'DocumentRequirement',
    'CertificationStandard',
    'StandardRequirement',
    'SupplementaryCriterion',
    'DocumentTemplate',
];

// FK-safe deletion order (children first, parents last)
const DELETE_ORDER = [
    // Trace & QR (leaf nodes)
    'TraceQrScan',
    'TraceQrSecurity',
    'ConsumerFeedback',
    // Cultivation details (leaf nodes)
    'DryingTemperature',
    'DryingHumidity',
    'DryingDarkRoom',
    'CuringProcess',
    'WaterSource',
    'GrowingMedium',
    'SeedSource',
    'FertilizerRecord',
    'ControlledEnvironment',
    'PackagingDetail',
    'DryingProcess',
    'CareLog',
    'CultivationLog',
    // Harvest
    'HarvestBatch',
    'Lot',
    // Planting
    'PlantingCyclePlot',
    'PlantingCycle',
    // Farm details
    'Plot',
    'SiteAnalysis',
    'TrainingRecord',
    // Documents & SOPs
    'ReportSubmission',
    'SOPDocument',
    'ScopeOfWork',
    // Audit
    'AuditChecklist',
    'AuditLog',
    'PostAuditTask',
    'MeetingRoom',
    // Applications
    'ApplicationComment',
    'RevisionDeadline',
    'ApplicationDraft',
    'ApplicationBundle',
    // Payments
    'PaymentTransaction',
    'Quote',
    'Invoice',
    // Certificates
    'Certificate',
    // Notifications & Consent
    'Notification',
    'UserConsent',
    // Farm (parent of plots/cycles)
    'Farm',
    // Application (references user)
    'Application',
    // User (root entity)
    'User',
];

/**
 * postgresql://user:pass@host:port/DBNAME?schema=public -> DBNAME.
 * Returns '' when the URL is absent or unparseable, which disables the two
 * database-name confirmation paths and leaves only the explicit flag.
 */
function parseDatabaseName(url) {
    try {
        const afterSlash = String(url || '').split('/').pop() || '';
        return decodeURIComponent(afterSlash.split('?')[0]);
    } catch {
        return '';
    }
}

/**
 * GATE 1. Pure, so the refusal is testable without a database.
 */
function checkEnvironmentGuard(nodeEnv) {
    const value = typeof nodeEnv === 'string' ? nodeEnv.trim().toLowerCase() : '';
    if (RESET_ALLOWED_ENVIRONMENTS.includes(value)) {
        return { allowed: true, nodeEnv: value };
    }
    const named = value === '' ? 'unset' : value;
    return {
        allowed: false,
        nodeEnv: named,
        reason: `Refusing to run: NODE_ENV is "${named}". This script deletes ${DELETE_ORDER.length} tables `
            + `including User and only runs when NODE_ENV is one of: ${RESET_ALLOWED_ENVIRONMENTS.join(', ')}. `
            + 'An unset or unrecognised NODE_ENV is refused on purpose (fail-closed). '
            + 'No flag or environment variable can lift this guard. '
            + 'For a UAT/staging wipe use scripts/clear-for-uat.js.',
    };
}

/**
 * GATE 2. Never consulted until gate 1 has passed.
 */
async function resolveConfirmation({ argv, env, dbName, isTty, prompt }) {
    if (argv.includes(RESET_CONFIRM_FLAG)) {
        return { confirmed: true, via: 'flag' };
    }

    const echoed = String(env[RESET_CONFIRM_ENV] ?? '').trim();
    if (echoed) {
        if (dbName && echoed === dbName) {
            return { confirmed: true, via: 'env' };
        }
        return {
            confirmed: false,
            reason: `Refusing to run: ${RESET_CONFIRM_ENV}="${echoed}" does not match the target database `
                + `"${dbName || '(unknown)'}".`,
        };
    }

    if (!isTty) {
        return {
            confirmed: false,
            reason: 'Refusing to run: no confirmation given and stdin is not a TTY (docker exec / piped run). '
                + `Pass ${RESET_CONFIRM_FLAG}, or set ${RESET_CONFIRM_ENV}=${dbName || '<database name>'}.`,
        };
    }

    const answer = String(await prompt(`Type the database name to delete (${dbName || 'unknown'}): `)).trim();
    if (dbName && answer === dbName) {
        return { confirmed: true, via: 'prompt' };
    }
    return {
        confirmed: false,
        reason: `Refusing to run: the typed name "${answer}" does not match the target database `
            + `"${dbName || '(unknown)'}".`,
    };
}

function promptOperator(question) {
    const readline = require('node:readline');
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Lazy so that requiring this module never touches a database — the previous
 * version resolved (and then used) the client at import time.
 */
function getPrisma() {
    try {
        return require('../services/prisma-database').prisma;
    } catch {
        const { PrismaClient } = require('@prisma/client');
        return new PrismaClient();
    }
}

/**
 * Both gates live inside this function, so there is no code path that reaches
 * the delete loop without passing them.
 */
async function resetForHandoff(options = {}) {
    const {
        prisma,
        env = process.env,
        argv = process.argv.slice(2),
        isTty = Boolean(process.stdin && process.stdin.isTTY),
        prompt = promptOperator,
        log = (message) => console.log(message),
    } = options;

    const guard = checkEnvironmentGuard(env.NODE_ENV);
    if (!guard.allowed) {
        throw new ResetRefused(guard.reason, EXIT_CODES.ENVIRONMENT_BLOCKED);
    }

    const dbName = parseDatabaseName(env.DATABASE_URL);
    const separator = '='.repeat(50);

    log('');
    log('GACP Database Reset for Handoff');
    log(separator);
    log(`Date: ${new Date().toISOString()}`);
    log(`NODE_ENV: ${guard.nodeEnv}`);
    log(`Target database: ${dbName || '(unparseable DATABASE_URL)'}`);
    log(`Tables to purge: ${DELETE_ORDER.length}`);
    log(`Tables to preserve: ${PRESERVE_TABLES.join(',')}`);
    log(separator);

    const confirmation = await resolveConfirmation({ argv, env, dbName, isTty, prompt });
    if (!confirmation.confirmed) {
        throw new ResetRefused(confirmation.reason, EXIT_CODES.NOT_CONFIRMED);
    }
    log(`Confirmed via: ${confirmation.via}`);

    const client = prisma || getPrisma();
    let totalDeleted = 0;

    for (const model of DELETE_ORDER) {
        try {
            const modelName = model.charAt(0).toLowerCase() + model.slice(1);
            if (client[modelName]) {
                const result = await client[modelName].deleteMany({});
                if (result.count > 0) {
                    log(`${model}: ${result.count} records deleted`);
                    totalDeleted += result.count;
                } else {
                    log(`${model}: 0 records (already empty)`);
                }
            } else {
                log(`${model}: model not found in Prisma client`);
            }
        } catch (err) {
            log(`${model}: ${err.message.split('\n')[0]}`);
        }
    }

    log('');
    log(separator);
    log(`Reset complete - ${totalDeleted} total records deleted`);

    // Verify preserved tables
    log('');
    log('Preserved data:');
    for (const model of PRESERVE_TABLES) {
        try {
            const modelName = model.charAt(0).toLowerCase() + model.slice(1);
            if (client[modelName]) {
                const count = await client[modelName].count();
                log(`${model}: ${count} records preserved`);
            }
        } catch { /* skip */ }
    }

    log('');
    log('Database is clean and ready for handoff.');
    log('Run seed-system-config.js and seed-test-accounts.js to set up fresh data.');

    return { totalDeleted, confirmedVia: confirmation.via, dbName, nodeEnv: guard.nodeEnv };
}

/**
 * Returns the exit code instead of calling process.exit, so the refusal codes
 * are assertable in tests.
 */
async function main(options = {}) {
    const client = options.prisma || getPrisma();
    const error = options.error || ((message) => console.error(message));
    try {
        await resetForHandoff({ ...options, prisma: client });
        return EXIT_CODES.OK;
    } catch (err) {
        error(err.message);
        return typeof err.exitCode === 'number' ? err.exitCode : EXIT_CODES.FATAL;
    } finally {
        try {
            await client.$disconnect();
        } catch { /* the client may never have connected */ }
    }
}

if (require.main === module) {
    main().then((code) => { process.exit(code); });
}

module.exports = {
    DELETE_ORDER,
    PRESERVE_TABLES,
    RESET_ALLOWED_ENVIRONMENTS,
    RESET_CONFIRM_FLAG,
    RESET_CONFIRM_ENV,
    EXIT_CODES,
    ResetRefused,
    parseDatabaseName,
    checkEnvironmentGuard,
    resolveConfirmation,
    resetForHandoff,
    main,
};
