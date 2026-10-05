'use strict';

/**
 * What commit is this process running?
 *
 * apps/backend/Dockerfile bakes GIT_SHA and BUILT_AT into the image at build
 * time. Nothing else sets them, so outside a built image both are absent — and
 * absent has to read as null, not as a placeholder string.
 *
 * The reason is the consumer: scripts/probes/deploy-drift.sh compares this value
 * against a git ref. A placeholder like "unknown" compares unequal to every real
 * SHA, so it would report as drift and send somebody looking for a deploy that
 * already happened. null says "this image cannot answer the question", which is
 * a different problem with a different fix (rebuild it with the build arg).
 */
function readEnv(name) {
    const raw = process.env[name];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
}

function buildInfo() {
    return {
        revision: readEnv('GIT_SHA'),
        builtAt: readEnv('BUILT_AT'),
    };
}

module.exports = { buildInfo };
