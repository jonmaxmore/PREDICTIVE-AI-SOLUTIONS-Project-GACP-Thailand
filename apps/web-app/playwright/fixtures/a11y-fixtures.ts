/**
 * ============================================================================
 * W3-B Accessibility-Scan Fixtures — Iter W3 (Loop W)
 * ============================================================================
 * Helper module for the W3-B accessibility scan Playwright spec
 * (`accessibility-scan.spec.ts`). Wraps the `@axe-core/playwright`
 * `AxeBuilder` with the WCAG 2.1 AA tag filter the project standardises on
 * and a per-stage JSON-artifact writer so the cutover team can grep
 * `apps/web-app/playwright/.axe-results/{stage}.json` after a local run.
 *
 * Per I-004 (file-boundary discipline) W3-B does NOT extend the existing
 * `fixtures.ts` / `farmer-fixtures.ts` / `dtam-fixtures.ts` files; this
 * helper is NEW and isolated to the W3-B territory.
 *
 * Per I-018 the helper does NOT issue any `page.request.*` calls — the
 * AxeBuilder run is browser-context (executes axe via `page.evaluate`
 * internally), so route mocks fire correctly when the spec layers them.
 *
 * Per I-008 the helper exposes BOTH `runAxeScan` (the canonical scan + JSON
 * write) AND `filterCriticalSerious` (so callers can assert on the
 * high-severity subset without re-walking the violations array).
 *
 * WCAG 2.1 AA tag set:
 *   - `wcag2a`    — WCAG 2.0 Level A
 *   - `wcag2aa`   — WCAG 2.0 Level AA
 *   - `wcag21a`   — WCAG 2.1 Level A delta
 *   - `wcag21aa`  — WCAG 2.1 Level AA delta
 * The four tags collectively cover the WCAG 2.1 AA conformance target
 * documented in `docs/handoffs/iter-W3/00-rfc.md` §Success criteria.
 */

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// axe-core publishes its `AxeResults` type via `axe-core`, which ships
// transitively with @axe-core/playwright. Import the result type rather
// than re-deriving it so the helper stays in lock-step with the upstream
// schema (impact strings, ruleId fields).
import type { AxeResults, ImpactValue, Result as AxeRuleResult } from 'axe-core';

/**
 * Canonical WCAG 2.1 AA tag set. Centralised so the spec and any future
 * helpers stay in agreement on what "AA" means — relaxing this set in
 * isolation is the kind of silent scope erosion I-017 guards against.
 */
export const WCAG_21_AA_TAGS = [
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
] as const;

/**
 * `.axe-results/` lives under `apps/web-app/playwright/.axe-results/`.
 * Resolved off this fixture file's directory so the spec can run from
 * either repo root or `apps/web-app/` without breaking the artifact path.
 */
export function getAxeResultsDir(): string {
    return path.resolve(__dirname, '..', '.axe-results');
}

/**
 * Sanitise an arbitrary stage label into a filename-safe slug. Keeps the
 * artifact files greppable (`grep -l 'serious' .axe-results/*.json`).
 */
function toArtifactSlug(stageName: string): string {
    return stageName
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 80) || 'unknown-stage';
}

/**
 * Run the canonical WCAG 2.1 AA AxeBuilder scan against the current page
 * state and write the full results to
 * `playwright/.axe-results/{stage}.json` so the cutover team can grep them.
 *
 * The helper does NOT navigate, log in, or wait for any locator — the
 * caller is responsible for arriving at the target surface with the
 * desired DOM state before invoking the scan.
 */
export async function runAxeScan(
    page: Page,
    stageName: string,
): Promise<AxeResults> {
    const builder = new AxeBuilder({ page }).withTags(
        WCAG_21_AA_TAGS as unknown as string[],
    );
    const results = await builder.analyze();

    const outDir = getAxeResultsDir();
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    const slug = toArtifactSlug(stageName);
    fs.writeFileSync(
        path.join(outDir, `${slug}.json`),
        JSON.stringify(
            {
                stage: stageName,
                scannedAt: new Date().toISOString(),
                url: results.url,
                testEngine: results.testEngine,
                testRunner: results.testRunner,
                toolOptions: results.toolOptions,
                violationCount: results.violations.length,
                criticalSeriousCount: filterCriticalSerious(results.violations)
                    .length,
                violations: results.violations,
                incomplete: results.incomplete,
                passes: results.passes.map((p) => ({
                    id: p.id,
                    impact: p.impact,
                    description: p.description,
                    nodes: p.nodes.length,
                })),
            },
            null,
            2,
        ),
        'utf8',
    );

    return results;
}

/**
 * Filter an axe-core violations array down to the High-severity subset
 * (impact === 'critical' || impact === 'serious'). These are the two
 * impact tiers the W3-B handoff treats as ratchet-gate failures per
 * I-017's per-item enumeration rule.
 */
export function filterCriticalSerious(
    violations: AxeRuleResult[],
): AxeRuleResult[] {
    const highSeverity: readonly ImpactValue[] = ['critical', 'serious'];
    return violations.filter((v) => {
        if (!v.impact) return false;
        return (highSeverity as readonly string[]).includes(v.impact);
    });
}

/**
 * Returns true when E2E_LIVE_BACKEND=1 is set — mirrors the helper in
 * `farmer-fixtures.ts` so W3-B's dual-mode toggle is consistent with the
 * W1 specs. The cutover team flips this single env var at T-3 to switch
 * from CI mock-mode to a live backend hosted via docker-compose.
 */
export function expectLiveBackend(): boolean {
    return process.env.E2E_LIVE_BACKEND === '1';
}

/**
 * Convenience: assert a short violation-summary line per page. The spec
 * uses this to keep the assertion failure messages human-greppable
 * (a long axe JSON blob in the Playwright output is noise).
 */
export function summariseViolations(violations: AxeRuleResult[]): string {
    if (violations.length === 0) return 'no violations';
    return violations
        .map(
            (v) =>
                `${v.id} [impact=${v.impact ?? 'unknown'}, nodes=${v.nodes.length}]`,
        )
        .join('; ');
}
