/**
 * P0-2 guard (2026-06-10, owner-directed): the auditor audit-decision handler
 * must NOT gate a human PASS behind an automated GACP score. Canon (F1) is
 * human PASS/FAIL only — no machine score may override the on-site auditor's
 * certification decision (#298 removed the fabricated cert score; SCORE-01 /
 * 8-category abandoned). This locks the removal so the AUD-13 400-override
 * cannot silently return.
 */
const fs = require('fs');
const path = require('path');

const HANDLER_PATH = path.resolve(
    __dirname,
    '../../routes/api/provider/handlers/auditor-audit-decision-handler.js',
);

describe('auditor audit-decision handler — no automated scoring gate (P0-2)', () => {
    const src = fs.readFileSync(HANDLER_PATH, 'utf8');

    it('does not require the gacp-scoring-service in the decision path', () => {
        expect(src).not.toMatch(/gacp-scoring-service/);
        expect(src).not.toMatch(/calculateApplicationScore/);
    });

    it('does not block PASS with a sub-70% score (no "คะแนน GACP ไม่ถึงเกณฑ์" 400)', () => {
        expect(src).not.toContain('คะแนน GACP ไม่ถึงเกณฑ์');
        expect(src).not.toMatch(/scorecard:\s*\{/);
    });

    it('documents the canon decision so it is not reintroduced by accident', () => {
        expect(src).toMatch(/human PASS\/FAIL only/i);
    });
});
