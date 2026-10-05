#!/usr/bin/env node
/**
 * W4-D — OpenAPI spec extraction script.
 *
 * Reads the live swagger-jsdoc output (assembled from per-route `@swagger`
 * JSDoc blocks plus the static `config/swagger.js` definition), validates
 * the shape, and writes the JSON to `docs/api/openapi.json` at the repo
 * root. Integrators can `curl` that file from GitHub without booting the
 * backend; ops can pin a spec version per deploy by tracking the JSON in
 * git.
 *
 * Usage:
 *   node apps/backend/scripts/generate-openapi-spec.js
 *     → writes docs/api/openapi.json + prints `paths: N`.
 *   node apps/backend/scripts/generate-openapi-spec.js --validate
 *     → exits non-zero (1) if the spec is structurally invalid.
 *     → exits 0 otherwise; does NOT write the file.
 *
 * Cross-platform: pure Node fs (no shell-out to grep / find / etc.).
 * Per I-013, this script is NOT wired into `.husky/pre-commit`; it's a
 * manual ops command. The companion unit test
 * (`__tests__/unit/openapi-spec-generation.test.js`) pins the contract.
 *
 * Exit codes:
 *   0  → success (spec valid; file written when not --validate)
 *   1  → spec failed structural validation
 *   2  → IO error writing the file
 */

'use strict';

const fs = require('fs');
const path = require('path');

const swaggerSpec = require('../config/swagger');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'api', 'openapi.json');

/**
 * Structural validation of the assembled spec. Splits problems into two
 * tiers:
 *   errors[]  — must-fix issues (missing top-level fields) that fail the
 *               script with exit 1.
 *   warnings[] — operations missing a `responses` block. These predate
 *               W4 in some pre-existing annotations and the W4 RFC scope
 *               is to flag (not crash) them so W4-A / future iters can
 *               close the gap incrementally.
 *
 * @param {object} spec — swagger-jsdoc output
 * @returns {{errors: string[], warnings: string[]}}
 */
function validateSpec(spec) {
    const errors = [];
    const warnings = [];

    if (!spec || typeof spec !== 'object') {
        errors.push('Spec is null or not an object');
        return { errors, warnings };
    }

    if (spec.openapi !== '3.0.0') {
        errors.push(`Expected openapi === "3.0.0", got "${spec.openapi}"`);
    }

    if (!spec.info || typeof spec.info !== 'object') {
        errors.push('Missing or invalid spec.info object');
    } else {
        if (!spec.info.title) {errors.push('Missing spec.info.title');}
        if (!spec.info.version) {errors.push('Missing spec.info.version');}
    }

    if (!spec.paths || typeof spec.paths !== 'object') {
        errors.push('Missing or invalid spec.paths object');
    } else if (Object.keys(spec.paths).length === 0) {
        errors.push('spec.paths is empty (no annotated routes found)');
    }

    if (!spec.components || typeof spec.components !== 'object') {
        errors.push('Missing spec.components object');
    }

    if (!Array.isArray(spec.tags)) {
        errors.push('spec.tags should be an array');
    }

    // Routes without declared responses are uninterpretable to integrators
    // but several pre-existing annotations omit them. Report as WARNINGS
    // so the file still writes; W4-A future-extends close the gap.
    if (spec.paths && typeof spec.paths === 'object') {
        const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
        for (const [routePath, pathItem] of Object.entries(spec.paths)) {
            if (!pathItem || typeof pathItem !== 'object') {continue;}
            for (const [method, operation] of Object.entries(pathItem)) {
                if (!HTTP_METHODS.has(method.toLowerCase())) {continue;}
                if (!operation || typeof operation !== 'object') {continue;}
                if (!operation.responses || typeof operation.responses !== 'object') {
                    warnings.push(`Path ${routePath} ${method.toUpperCase()} has no responses block`);
                }
            }
        }
    }

    return { errors, warnings };
}

/**
 * Count distinct (path, method) pairs in the spec.
 */
function countPathMethodPairs(spec) {
    const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
    let count = 0;
    if (!spec || !spec.paths) {return 0;}
    for (const pathItem of Object.values(spec.paths)) {
        if (!pathItem || typeof pathItem !== 'object') {continue;}
        for (const method of Object.keys(pathItem)) {
            if (HTTP_METHODS.has(method.toLowerCase())) {count += 1;}
        }
    }
    return count;
}

function main() {
    const args = process.argv.slice(2);
    const validateOnly = args.includes('--validate');

    const { errors, warnings } = validateSpec(swaggerSpec);
    if (errors.length > 0) {
        console.error('[generate-openapi-spec] FAIL — OpenAPI spec failed validation:');
        for (const err of errors) {
            console.error(`  - ${err}`);
        }
        process.exit(1);
    }

    if (warnings.length > 0) {
        console.warn(`[generate-openapi-spec] WARN — ${warnings.length} operation(s) missing responses blocks (W4-A future-extends close this):`);
        for (const warn of warnings.slice(0, 5)) {
            console.warn(`  - ${warn}`);
        }
        if (warnings.length > 5) {
            console.warn(`  ... and ${warnings.length - 5} more`);
        }
    }

    const pathCount = Object.keys(swaggerSpec.paths || {}).length;
    const pairCount = countPathMethodPairs(swaggerSpec);

    if (validateOnly) {
        console.log(`[generate-openapi-spec] OK — spec valid (paths: ${pathCount}, path-method pairs: ${pairCount})`);
        process.exit(0);
    }

    try {
        const outputDir = path.dirname(OUTPUT_PATH);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const json = JSON.stringify(swaggerSpec, null, 2);
        fs.writeFileSync(OUTPUT_PATH, json, 'utf8');
        const sizeKb = (Buffer.byteLength(json, 'utf8') / 1024).toFixed(1);
        console.log(`[generate-openapi-spec] OK — wrote ${OUTPUT_PATH} (${sizeKb} KB, paths: ${pathCount}, path-method pairs: ${pairCount})`);
        process.exit(0);
    } catch (err) {
        console.error(`[generate-openapi-spec] FAIL — IO error: ${err.message}`);
        process.exit(2);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    validateSpec,
    countPathMethodPairs,
    OUTPUT_PATH,
};
