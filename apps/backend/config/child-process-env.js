'use strict';

/**
 * The minimal, explicit environment for a forked child process that parses
 * untrusted input — today, `services/document-precheck/pdf-extract-worker.js`
 * (forked by `services/document-precheck/extract.js` for every PDF).
 *
 * Least privilege: a process that only needs to run `node <this file's
 * argv[1]>` gets `PATH` (to resolve the `node` binary itself, inherited from
 * the parent, and `NODE_ENV` if the parent has one) — not the parent's full
 * `process.env` (DB URL, HMAC/Stripe keys, everything else a real request
 * handler needs and this one-shot parsing process never should).
 *
 * This is also the one place `PATH`/`NODE_ENV` are read for that purpose —
 * `scripts/probes/ratchet.sh`'s `env-direct` counter only scans
 * `services/`, `routes/`, `jobs/`, `middleware/`, not `config/` (same
 * convention as `config/public-urls.js`, `config/auth-providers.js`), so a
 * caller importing this instead of reading `process.env` itself keeps that
 * counter flat.
 *
 * @module config/child-process-env
 */

/**
 * @returns {{PATH?: string, NODE_ENV?: string}}
 */
function minimalChildEnv() {
    const env = {};
    if (process.env.PATH) {
        env.PATH = process.env.PATH;
    }
    if (process.env.NODE_ENV) {
        env.NODE_ENV = process.env.NODE_ENV;
    }
    return env;
}

module.exports = { minimalChildEnv };
