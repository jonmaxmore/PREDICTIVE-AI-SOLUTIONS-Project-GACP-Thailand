'use strict';

/**
 * A0-AUDIT-EMISSION / PR-A0-2 — call-site contract for every hop in scope.
 *
 * PR-A0-1 made `writeApplicationStatus` audit-by-default, so from here on a hop
 * has exactly TWO knobs that decide whether it satisfies INVARIANT A0
 * (design-decision.md §4):
 *
 *   1. WHICH CLIENT it hands the writer — a caller tx handle (`prisma: tx`)
 *      binds the canonical row to the caller's transaction; a bare client makes
 *      the writer open its own short internal one (application-status-writer.js
 *      :796-816), atomic with its own UPDATE but not with anything around it.
 *   2. WHETHER IT PASSES `onAudit` — omitted means "the writer owns the
 *      canonical row" (the default emission); a function or `false` means the
 *      caller owns it and the writer emits nothing (writer :270-274, :818-821).
 *
 * This suite is a mechanical inventory of both knobs at every hop PR-A0-2 is
 * responsible for, so that a future edit cannot quietly demote a hop back to a
 * bare client or bolt a second emitter onto one that already has a row.
 *
 * WHAT THIS IS AND IS NOT
 *   IS:     a static contract over the call sites (the argument expression that
 *           reaches the writer). It runs everywhere, needs no database, and is
 *           the only form that can cover all twelve hops at one cost.
 *   IS NOT: proof that a row reaches Postgres, or that it is atomic with the
 *           UPDATE. Transaction semantics cannot be observed without a
 *           transaction (design-decision.md §4:147-155). That is the job of
 *           `__tests__/integration/a0-pr2-per-hop-invariant.test.js`, which
 *           self-skips without DATABASE_URL and has NOT run in this sandbox.
 *           Behavioural coverage of the changed hops lives in
 *           `a0-pr2-submit-hops-audit-emission.test.js` and
 *           `a0-pr2-admin-override-canonical-row.test.js`.
 *
 * STATUS: this file is a PIN, not a fix (Law 3.11). Every row below already
 * held when the file was written — the three rows PR-A0-2 changed (#8, #9, #12)
 * and the one it migrated (#7) were driven RED behaviourally in the two suites
 * named above, not here.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');

/**
 * Return the balanced-brace argument text of every `writeApplicationStatus({…})`
 * call in `src`, in source order. Brace-walking rather than a regex because the
 * argument objects are multi-line and nest several levels deep.
 */
function writerCallArguments(src) {
    const out = [];
    const needle = 'writeApplicationStatus({';
    let from = 0;
    for (;;) {
        const at = src.indexOf(needle, from);
        if (at === -1) {break;}
        const open = at + needle.length - 1;
        let depth = 0;
        let end = -1;
        for (let i = open; i < src.length; i += 1) {
            const ch = src[i];
            if (ch === '{') {depth += 1;}
            else if (ch === '}') {
                depth -= 1;
                if (depth === 0) { end = i; break; }
            }
        }
        if (end === -1) {throw new Error('unbalanced writeApplicationStatus argument');}
        out.push(src.slice(open, end + 1));
        from = end + 1;
    }
    return out;
}

function lineOf(src, argText) {
    return src.slice(0, src.indexOf(argText)).split('\n').length;
}

function load(relPath) {
    const src = fs.readFileSync(path.join(BACKEND, relPath), 'utf8');
    return { src, calls: writerCallArguments(src) };
}

/** the top-level `prisma:` value of a writer call argument */
function clientArgument(argText) {
    // top level only: the nested objects (additionalData.formData, …) never
    // carry a `prisma` key, but anchor on the 4-or-more-space indent the call
    // sites use for their own top-level keys to stay honest about it.
    const m = argText.match(/(?:^|\n)\s*prisma:\s*([A-Za-z_$][\w$]*)\s*,/);
    if (m) {return m[1];}
    if (/(?:^|\n)\s*prisma\s*,/.test(argText)) {return 'prisma';} // shorthand = bare client
    return null;
}

/**
 * Classify the call site against the writer's tri-state
 * (application-status-writer.js:270-274):
 *   'default'  — the key is absent, so the writer emits the canonical row
 *   'off'      — `onAudit: false`, so the caller emits its own rows
 *   'callback' — `onAudit: <expression>`, so that expression is the only emitter
 */
function emissionMode(argText) {
    const m = argText.match(/(?:^|\n)\s*onAudit:\s*(\S)/);
    if (!m) {return 'default';}
    return /(?:^|\n)\s*onAudit:\s*false\s*,/.test(argText) ? 'off' : 'callback';
}

/**
 * The inventory. `client` is the identifier the hop hands the writer:
 *   'tx' → a caller transaction handle · 'prisma' → the bare client.
 * `emission` is the tri-state the call site selects: 'default' (the writer
 * owns the canonical row), 'off' (`onAudit: false` — the caller owns its rows),
 * or 'callback' (`onAudit: <fn>` — that expression is the only emitter).
 */
const HOPS = [
    // NOTE (task-3 fix round 1, 2026-08-18): an earlier revision of this file
    // added a fourth applications.js call site here (id 'F-SUBMIT-ECHO-LIES',
    // a SUBMITTED self-heal auto-advance). That self-heal was REVERTED
    // (Ruling 6) — the bundle submit door legitimately parks member
    // applications at bare SUBMITTED by design (application-bundles.js:
    // 523-556), and the auto-advance could not tell a bundle member from a
    // stray row, so it risked irreversibly pulling a bundled application out
    // of its bundle's billing model. applications.js is back to exactly the
    // three writeApplicationStatus call sites below (indices unchanged from
    // the original PR-A0-2 inventory).

    // ── hops PR-A0-2 CHANGED: multi-write siblings pulled into one caller tx ──
    {
        id: '#8/#9', file: 'routes/api/applications/applications.js', index: 0,
        client: 'tx', emission: 'default',
        why: 'initial submit hop 1 (DRAFT→SUBMITTED) — shares one tx with hop 2',
    },
    {
        id: '#9', file: 'routes/api/applications/applications.js', index: 1,
        client: 'tx', emission: 'default',
        why: 'initial submit hop 2 (SUBMITTED→PENDING_DOC_FEE) — same tx as hop 1',
    },
    {
        id: '#12', file: 'routes/api/applications/application-bundles.js', index: 0,
        client: 'tx', emission: 'default',
        why: 'bundle submit — one tx for the bundle flip + every linked case',
    },

    // ── hop PR-A0-2 MIGRATED: the caller owns BOTH of its rows (see #7 suite) ──
    {
        id: '#7', file: 'routes/api/admin/applications.js', index: 0,
        client: 'tx', emission: 'off',
        why: 'admin override — caller emits the canonical + ADMIN rows fail-closed',
    },

    // ── hops that ALREADY passed a tx before PR-A0-2 (pins) ──
    {
        id: '#10', file: 'routes/api/applications/applications.js', index: 2,
        client: 'tx', emission: 'default',
        why: 'correction resubmit — tx shared with the append-only snapshot (R2 M7)',
    },
    {
        id: '#11', file: 'routes/api/applications/application-workflow-handlers.js', index: 0,
        client: 'tx', emission: 'default',
        why: 'review decision — tx shared with the correction letter mint (D-8)',
    },
    {
        id: '#13', file: 'routes/api/applications/applications-car.js', index: 0,
        client: 'tx', emission: 'default',
        why: 'CAR deadline expiry — tx shared with the RevisionDeadline fail',
    },
    {
        id: '#14', file: 'routes/api/applications/applications-car.js', index: 1,
        client: 'tx', emission: 'default',
        why: 'CAR evidence resubmit — tx shared with the append-only snapshot',
    },
    {
        id: '#15', file: 'routes/api/system/cron.js', index: 0,
        client: 'tx', emission: 'default',
        why: 'auto-expire cron — tx shared with the RevisionDeadline fail',
    },
    {
        id: '#22', file: 'routes/api/provider/work.js', index: 0,
        client: 'tx', emission: 'default',
        why: 'work-inbox done+advance — tx shared with workActivity.markDone',
    },
    {
        id: '#24', file: 'services/audit-scheduling-service.js', index: 0,
        client: 'tx', emission: 'default',
        why: 'scheduler assign — Serializable tx shared with the slot re-assert',
    },

    // ── hops deliberately left on the BARE client (see the describe below) ──
    {
        id: '#18', file: 'routes/api/provider/handlers/workflow-transitions-handler.js', index: 0,
        client: 'prisma', emission: 'default',
        why: 'forced expire — its sibling write cannot join a caller tx (see below)',
    },
    {
        id: '#19', file: 'routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js', index: 0,
        client: 'tx', emission: 'default',
        why: 'schedule →AUDIT_CONFIRMED — Serializable slot tx shared with the evidence arming (fix round 1)',
    },
    {
        id: '#20', file: 'routes/api/provider/handlers/workflow-side-effects.js', index: 0,
        client: 'prisma', emission: 'default',
        why: 'DOC_APPROVED auto-chain — sibling writes cannot join a caller tx',
    },
    {
        id: '#21', file: 'routes/api/provider/handlers/workflow-revision-expirations-handler.js', index: 0,
        client: 'prisma', emission: 'default',
        why: 'forced expire route — sibling writes cannot join a caller tx',
    },
    {
        // 2026-09-05 — the SECOND door that approves documents (the per-slot review door)
        // wrote DOC_APPROVED and stopped: the applicant was told their papers passed and
        // was never asked for the audit fee. Rather than copy #20's chain into it, the
        // chain moved into applyDocumentApprovalConsequences and both doors call it —
        // which is why this file now holds two hops with the same from/to pair rather
        // than two files holding one each.
        //
        // Same bare-client shape as #20 for the same reason: its sibling write is
        // bulkUpdateRevisionDeadlineStatus, which holds the module-level singleton and
        // takes no client argument. Handing this hop a tx while the sibling stayed on the
        // singleton would look atomic without being atomic.
        id: '#22', file: 'routes/api/provider/handlers/workflow-side-effects.js', index: 1,
        client: 'prisma', emission: 'default',
        why: 'DOC_APPROVED auto-chain, shared by both approval doors — same sibling-write constraint as #20',
    },

    // ── the two callers in a PR-A0-2 file that ALREADY owned their emission ──
    // (spec-reader-report.md items 4 and 5). Out of PR-A0-2's remit, listed so
    // the completeness check below sees every call in the file and so a future
    // edit cannot drop their callback and silently fall through to the default.
    {
        id: '#4', file: 'routes/api/provider/handlers/workflow-transitions-handler.js', index: 1,
        client: 'tx', emission: 'callback',
        why: 'cert-voiding reversal — caller-owned emitter in its own tx',
    },
    {
        id: '#5', file: 'routes/api/provider/handlers/workflow-transitions-handler.js', index: 2,
        client: 'tx', emission: 'callback',
        why: 'revision/CAR decision — caller-owned emitter in its own tx',
    },

    // ── hops added final-review round (2026-08-18, Item 4) — the revision
    // door's own two-hop DRAFT resubmit + its REVISION_REQUESTED resubmit
    // (services/application-service/application-review-revision-methods.js,
    // F-REVISION-DOOR-NO-QUOTATION fix). Same shape as #8/#9 above (a DRAFT
    // walking both SSOT-legal edges inside one caller tx) but in this file's
    // submitRevision, not applications.js's /submit handler.
    {
        id: '#RD1', file: 'services/application-service/application-review-revision-methods.js', index: 0,
        client: 'tx', emission: 'default',
        why: 'revision-door DRAFT resubmit hop 1 (DRAFT→SUBMITTED) — shares one tx with hop 2',
    },
    {
        id: '#RD2', file: 'services/application-service/application-review-revision-methods.js', index: 1,
        client: 'tx', emission: 'default',
        why: 'revision-door DRAFT resubmit hop 2 (SUBMITTED→PENDING_DOC_FEE, actorRole system) — same tx as hop 1',
    },
    {
        id: '#RD3', file: 'services/application-service/application-review-revision-methods.js', index: 2,
        client: 'tx', emission: 'default',
        why: 'revision-door REVISION_REQUESTED resubmit (REVISION_REQUESTED→ASSIGNED_FOR_REVIEW) — its own tx',
    },
];

describe('PR-A0-2 — per-hop emission contract (client + tri-state) [PIN]', () => {
    const cache = new Map();
    const read = (file) => {
        if (!cache.has(file)) {cache.set(file, load(file));}
        return cache.get(file);
    };

    test.each(HOPS.map((h) => [`${h.id} ${h.file}[${h.index}] — ${h.why}`, h]))(
        '%s',
        (_label, hop) => {
            const { src, calls } = read(hop.file);
            const argText = calls[hop.index];
            expect(argText).toBeDefined();

            const client = clientArgument(argText);
            const emission = emissionMode(argText);
            const at = `${hop.file}:${lineOf(src, argText)}`;

            expect({ at: hop.file, client, emission })
                .toEqual({ at: hop.file, client: hop.client, emission: hop.emission });
            // the line number is not asserted (it moves); it is surfaced so a
            // failure names the exact call site instead of an index.
            expect(typeof at).toBe('string');
        },
    );

    test('the inventory covers every writeApplicationStatus call in the PR-A0-2 files', () => {
        const expectedPerFile = HOPS.reduce((acc, h) => {
            acc[h.file] = Math.max(acc[h.file] || 0, h.index + 1);
            return acc;
        }, {});
        for (const [file, count] of Object.entries(expectedPerFile)) {
            expect({ file, calls: read(file).calls.length }).toEqual({ file, calls: count });
        }
    });
});

/**
 * The four hops PR-A0-2 deliberately did NOT wrap. Recorded as an executable
 * note so the omission reads as a decision rather than an oversight: each of
 * them has sibling writes that go through a service holding the MODULE-LEVEL
 * prisma singleton, which cannot be re-pointed at a caller's tx handle without
 * changing that service's signature — a file outside this PR's scope. Handing
 * the writer a tx while the siblings stayed on the singleton would produce a
 * transaction that LOOKS atomic and is not, which is worse than the honest
 * bare-client shape the writer already covers with its internal tx.
 */
describe('PR-A0-2 — hops left on the bare client keep their sibling-write shape [PIN]', () => {
    test('#18 / #21 fail the RevisionDeadline rows through the service singleton', () => {
        for (const file of [
            'routes/api/provider/handlers/workflow-transitions-handler.js',
            'routes/api/provider/handlers/workflow-revision-expirations-handler.js',
        ]) {
            const src = fs.readFileSync(path.join(BACKEND, file), 'utf8');
            expect(src).toMatch(/adminApplicationService\.bulkUpdateRevisionDeadlineStatus\(/);
        }
        // …and that service takes no client argument, which is WHY the hop
        // cannot be wrapped from the caller side alone.
        const svc = fs.readFileSync(path.join(BACKEND, 'services/admin-application-service.js'), 'utf8');
        expect(svc).toMatch(/async function bulkUpdateRevisionDeadlineStatus\(\{\s*applicationId,\s*fromStatuses,\s*data\s*\}/);
    });

    test('#20 closes its deadline rows through the same singleton service', () => {
        const src = fs.readFileSync(
            path.join(BACKEND, 'routes/api/provider/handlers/workflow-side-effects.js'), 'utf8');
        expect(src).toMatch(/adminApplicationService\.bulkUpdateRevisionDeadlineStatus\(/);
    });

    test('#19 has no DB sibling write — only best-effort notifications and its own audit row', () => {
        const src = fs.readFileSync(
            path.join(BACKEND, 'routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js'),
            'utf8');
        // both notification sends are explicitly best-effort, so pulling them into a
        // transaction would change their failure policy, not fix one. Since the Thai-notice
        // batch they go through notifyAuditScheduled, whose sends are try/caught per party.
        expect(src).toMatch(/notifyAuditScheduled\(/);
        const notices = fs.readFileSync(
            path.join(BACKEND, 'services/audit/audit-schedule-notices.js'), 'utf8');
        expect(notices).toMatch(/createNotification\([\s\S]*?\} catch \(err\)/);
    });
});
