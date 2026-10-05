/**
 * What commit is this Next.js server running?
 *
 * apps/web-app/Dockerfile bakes GIT_SHA and BUILT_AT into the RUNNER stage, so
 * they exist in the server process's environment and nowhere else.
 *
 * Deliberately NOT NEXT_PUBLIC_*: those are inlined into the client bundle at
 * build time, which would both ship the value to every visitor and freeze it
 * into static output. Neither is wanted — the browser has no use for it, and
 * `GET /api/version` reads it per request.
 *
 * Absent reads as null, never as a placeholder. scripts/probes/deploy-drift.sh
 * compares this against a git ref: "unknown" would compare unequal to every real
 * SHA and be reported as drift, sending someone to look for a deploy that
 * already happened. null says something different and true — this image cannot
 * answer the question, so rebuild it with the build arg.
 */
export interface BuildInfo {
    revision: string | null;
    builtAt: string | null;
}

function readEnv(name: string): string | null {
    const raw = process.env[name];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
}

export function buildInfo(): BuildInfo {
    return {
        revision: readEnv('GIT_SHA'),
        builtAt: readEnv('BUILT_AT'),
    };
}
