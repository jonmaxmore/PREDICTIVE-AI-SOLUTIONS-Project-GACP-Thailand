'use strict';

/**
 * G-04 "Schema single source" must have teeth.
 *
 * The first version of the gate asked git for `**schema.prisma`. That was true
 * of this repo for six days. On 2026-03-12 the monolith was split into a
 * prismaSchemaFolder (c145f65d) and the leftover `schema.prisma` was deleted
 * (3120e673, whose message reads: "Prisma found both prisma/schema.prisma AND
 * prisma/schema/ directory. Removed the old monolith."). From that commit on,
 * no file in the tree ended in `schema.prisma`, the gate's match list was
 * always empty, and G-04 printed a pass line for roughly five months without
 * inspecting anything. Worse, its allowlist named `apps/backend/prisma/schema.prisma`
 * explicitly, so the exact file that caused the 2026-03-12 incident would have
 * been waved through if it came back.
 *
 * The rule the incident actually established: Prisma loads every `.prisma`
 * file in the schema folder, so a second schema anywhere else in the repo is
 * either dead weight or silently authoritative, and you cannot tell which by
 * reading it. One location, no exceptions.
 *
 * This pins both directions (two-sided control):
 *   - the shapes that must be caught, including the one the old glob could
 *     never see (a stray file whose name does not end in "schema.prisma");
 *   - the shapes that must stay legal, including a schema file that does not
 *     exist yet, so the gate does not block the next domain split;
 *   - and the empty-input case, because "found nothing" is what the broken
 *     version did and it must never again read as a pass.
 *
 * It asserts against the SHIPPED module, not a copy.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '../../../..');
const GATE = path.join(REPO_ROOT, 'scripts/ci/check-enforcement-guardrails.js');
const {
    CANONICAL_SCHEMA_DIR,
    listTrackedPrismaFiles,
    findStraySchemaFiles,
    evaluateSchemaSources,
} = require('../../../../scripts/ci/lib/prisma-schema-sources');

describe('G-04 gate — Prisma schema single source', () => {
    it('points at the directory that actually holds the schema', () => {
        expect(CANONICAL_SCHEMA_DIR).toBe('apps/backend/prisma/schema/');
        expect(fs.existsSync(path.join(REPO_ROOT, CANONICAL_SCHEMA_DIR))).toBe(true);
    });

    describe('catches (a second schema source, wherever it hides)', () => {
        const CAUGHT = [
            ['apps/backend/prisma/schema.prisma', 'the monolith that coexisted with the folder in the 2026-03-12 incident'],
            ['apps/web-app/prisma/schema.prisma', 'a front-end copy — the old allowlist let this one through by name'],
            ['packages/db/prisma/schema.prisma', 'a package-level second source'],
            ['apps/web-app/prisma/models/stray.prisma', 'a stray the old glob could never match: the name does not end in schema.prisma'],
            ['apps/backend/prisma/schema-v2/billing.prisma', 'a near-miss directory name'],
            ['prisma/schema.prisma', 'a repo-root schema'],
        ];
        it.each(CAUGHT)('%s — %s', (file) => {
            expect(findStraySchemaFiles([file])).toEqual([file]);
        });
    });

    describe('allows (so the gate stays signal, not noise)', () => {
        const ALLOWED = [
            ['apps/backend/prisma/schema/billing.prisma', 'a domain file that ships today'],
            ['apps/backend/prisma/schema/_base.prisma', 'the generator + datasource file'],
            ['apps/backend/prisma/schema/payment-reconciliation.prisma', 'a domain file that does not exist yet — the next split must not be blocked'],
            ['apps/backend/prisma/schema/billing/invoice.prisma', 'a nested split inside the canonical folder'],
        ];
        it.each(ALLOWED)('%s — %s', (file) => {
            expect(findStraySchemaFiles([file])).toEqual([]);
        });
    });

    describe('says what it actually did', () => {
        it('claims "all canonical" only when that is true', () => {
            const clean = evaluateSchemaSources([
                'apps/backend/prisma/schema/_base.prisma',
                'apps/backend/prisma/schema/billing.prisma',
            ]);
            expect(clean.summary).toBe(`2 .prisma files, all under ${CANONICAL_SCHEMA_DIR}`);
        });

        it('counts the strays instead of claiming they are canonical', () => {
            const dirty = evaluateSchemaSources([
                'apps/backend/prisma/schema/_base.prisma',
                'apps/backend/prisma/schema.prisma',
            ]);
            expect(dirty.summary).toBe(`2 .prisma files checked, 1 outside ${CANONICAL_SCHEMA_DIR}`);
            expect(dirty.summary).not.toMatch(/all under/);
        });

        it('does not pretend to have checked anything when it found nothing', () => {
            expect(evaluateSchemaSources([]).summary).toBe('0 .prisma files found');
        });
    });

    describe('never passes vacuously', () => {
        it('treats an empty file list as a failure, not a pass', () => {
            const result = evaluateSchemaSources([]);
            expect(result.checked).toBe(0);
            expect(result.ok).toBe(false);
            expect(result.reason).toMatch(/no .prisma file/i);
        });

        it('reports how many files it inspected when it passes', () => {
            const result = evaluateSchemaSources([
                'apps/backend/prisma/schema/_base.prisma',
                'apps/backend/prisma/schema/billing.prisma',
            ]);
            expect(result).toMatchObject({ checked: 2, ok: true, strays: [] });
        });

        it('fails when a stray is present, and names it', () => {
            const result = evaluateSchemaSources([
                'apps/backend/prisma/schema/_base.prisma',
                'apps/backend/prisma/schema.prisma',
            ]);
            expect(result.ok).toBe(false);
            expect(result.strays).toEqual(['apps/backend/prisma/schema.prisma']);
            expect(result.checked).toBe(2);
        });
    });

    describe('against the real repository', () => {
        it('finds the split schema — a non-empty list, all of it canonical', () => {
            const files = listTrackedPrismaFiles(REPO_ROOT);
            expect(files.length).toBeGreaterThan(0);
            expect(files.every((f) => f.startsWith(CANONICAL_SCHEMA_DIR))).toBe(true);
        });

        it('the tree currently has no second schema source', () => {
            expect(findStraySchemaFiles(listTrackedPrismaFiles(REPO_ROOT))).toEqual([]);
        });
    });

    it('the shipped guardrail script uses this module rather than its own copy', () => {
        const src = fs.readFileSync(GATE, 'utf8');
        expect(src).toMatch(/require\('\.\/lib\/prisma-schema-sources'\)/);
        // The dead glob may be quoted in a comment — that is the history of the
        // bug and worth keeping. It may not be handed to git again.
        expect(src).not.toMatch(/ls-files[^\n]*\*\*schema\.prisma/);
    });

    it('git is the source of the file list, so untracked scratch files cannot fake a pass', () => {
        const fromGit = execFileSync('git', ['ls-files', '--', '*.prisma'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        })
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        expect(listTrackedPrismaFiles(REPO_ROOT)).toEqual(fromGit);
    });
});
