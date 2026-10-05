'use strict';

/**
 * Five doors run the document gate, and every one of them has to answer BOTH of its
 * refusals in the applicant's own language.
 *
 * Each door used to inline the same seven-line 422 with `error: 'APPLICATION_INCOMPLETE'`
 * hardcoded and `instanceof DocumentRequirementError` as the test. When the gate learned a
 * second refusal — a filing no filed law can judge — none of the five caught it: on the
 * main submit door the throw fell through to `respondError(..., { message: 'Failed to
 * submit application' })`, so a farmer who picked ขมิ้นชัน was told, in English, that
 * something failed. The reason and the next action were both dropped.
 *
 * The fix is one shared answer, owned where the errors are defined. This suite is
 * structural on purpose: it reads the door files as text, so a SIXTH door added later
 * cannot quietly reintroduce the inline copy.
 */

const fs = require('fs');
const path = require('path');

const DOORS = [
    'routes/api/applications/applications.js',
    'routes/api/applications/application-bundles.js',
    'routes/api/applications/application-workflow-handlers.js',
    'routes/api/applications/applications-car.js',
    'routes/api/applications/revision-deadline.js',
];

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('every submit door answers every gate refusal, the same way', () => {
    DOORS.forEach((door) => {
        it(`${door} recognises a refusal by its kind, not by one class`, () => {
            const source = read(door);
            expect(source).toContain('isSubmitGateRefusal');
            // The inline copy is what dropped the second refusal. It may not come back.
            expect(source).not.toContain('instanceof DocumentRequirementError');
        });

        it(`${door} answers with the shared responder, not its own 422`, () => {
            expect(read(door)).toContain('respondSubmitGateRefusal');
        });
    });

    it('the responder speaks the error’s own code and carries its reason', () => {
        const {
            respondSubmitGateRefusal,
            DocumentRequirementError,
            ApplicationNotJudgeableError,
        } = require('../../services/application-document-requirements');

        const captured = [];
        const res = {
            status(code) { captured.push(['status', code]); return this; },
            json(body) { captured.push(['json', body]); return this; },
        };

        respondSubmitGateRefusal(res, new DocumentRequirementError([{ slotId: 'land_rights', labelTH: 'เอกสารสิทธิ์' }]));
        expect(captured).toEqual([
            ['status', 422],
            ['json', expect.objectContaining({
                success: false,
                error: 'APPLICATION_INCOMPLETE',
                code: 'APPLICATION_INCOMPLETE',
                missingSlots: [{ slotId: 'land_rights', labelTH: 'เอกสารสิทธิ์' }],
            })],
        ]);

        captured.length = 0;
        const issues = [{ code: 'PLANT_LAW_NOT_FILED', messageTH: 'ยังไม่มีประกาศข้อกำหนด', detail: {} }];
        respondSubmitGateRefusal(res, new ApplicationNotJudgeableError(issues));
        const [, [, body]] = captured;
        expect(body).toMatchObject({
            success: false,
            error: 'APPLICATION_NOT_JUDGEABLE',
            code: 'APPLICATION_NOT_JUDGEABLE',
            message: 'ยังไม่มีประกาศข้อกำหนด',
            blockingIssues: issues,
        });
        // Not a missing-document refusal, so it must not pretend to name papers.
        expect(body.missingSlots).toEqual([]);
    });

    /**
     * Review layer 2, finding C1/C2/C7. The refusal reached the door in Thai and died
     * there: the browser's envelope (apps/web-app/src/lib/api/api-client.ts:75) treats
     * `message` as a RESERVED key and strips it from a non-2xx body, keeping only
     * `success`/`data`/`error`/`code` plus whatever else it harvests into `.meta`. So the
     * Thai sentence this gate authors was dropped on the way to the screen and the farmer
     * read the bare enum APPLICATION_NOT_JUDGEABLE.
     *
     * `messageTh` is not a reserved key, so it survives into `.meta.messageTh` — the field
     * the preview door already reads for the older refusal. Sending it HERE fixes every
     * door at once, which is the whole reason this responder exists.
     */
    it('carries the Thai refusal in a field the browser envelope does not strip', () => {
        const {
            respondSubmitGateRefusal,
            DocumentRequirementError,
            ApplicationNotJudgeableError,
        } = require('../../services/application-document-requirements');

        const bodies = [];
        const res = { status() { return this; }, json(body) { bodies.push(body); return this; } };

        respondSubmitGateRefusal(res, new ApplicationNotJudgeableError(
            [{ code: 'PLANT_LAW_NOT_FILED', messageTH: 'ยังไม่มีประกาศข้อกำหนดสำหรับพืชที่คุณเลือก', detail: {} }],
        ));
        respondSubmitGateRefusal(res, new DocumentRequirementError([{ slotId: 'land_rights' }]));

        bodies.forEach((body) => {
            // Same sentence, in the field that survives the trip.
            expect(body.messageTh).toBe(body.message);
            expect(body.messageTh).toMatch(/[ก-๙]/);
        });
    });

    it('the browser envelope would keep messageTh and drop message', () => {
        // Pinned against the real reserved-key list rather than a copy of it: if the
        // browser ever reserves `messageTh` too, this fails instead of the farmer's screen.
        const clientSource = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'web-app', 'src', 'lib', 'api', 'api-client.ts'),
            'utf8',
        );
        const reserved = clientSource.match(/ENVELOPE_RESERVED_KEYS = new Set\(\[([^\]]*)\]\)/);
        expect(reserved).not.toBeNull();
        expect(reserved[1]).toContain("'message'");
        expect(reserved[1]).not.toContain("'messageTh'");
    });

    it('isSubmitGateRefusal recognises both refusals and nothing else', () => {
        const {
            isSubmitGateRefusal,
            DocumentRequirementError,
            ApplicationNotJudgeableError,
        } = require('../../services/application-document-requirements');
        expect(isSubmitGateRefusal(new DocumentRequirementError([]))).toBe(true);
        expect(isSubmitGateRefusal(new ApplicationNotJudgeableError([]))).toBe(true);
        expect(isSubmitGateRefusal(new Error('boom'))).toBe(false);
        expect(isSubmitGateRefusal(null)).toBe(false);
    });
});
