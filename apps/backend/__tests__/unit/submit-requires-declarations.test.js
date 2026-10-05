/**
 * ส่วนที่ ๔ — a filing may not be submitted without its คำรับรอง, and the platform
 * may not take the browser's word for when they were accepted.
 *
 * ── WHY THIS IS NOT A FORM-VALIDATION DETAIL ──────────────────────────────────
 * กทล.๑ ส่วนที่ ๔ is where the applicant certifies that what they filed is true,
 * consents to inspection, and accepts that a false statement revokes the
 * certificate. It is the part with legal consequence: an inspector standing on a
 * farm, and later a revocation, both rest on it. A filing that reached the
 * department without it is a filing nobody certified.
 *
 * ── AND WHY THE TIMESTAMP IS THE SERVER'S ────────────────────────────────────
 * `declarationsAcceptedAt` is evidence of WHEN a person accepted. If the browser
 * supplied it, an applicant could file today and stamp it last year, or a stale
 * draft could carry a time nobody was at the keyboard. The client says only
 * "accepted"; the server says when. Same rule as the certificate evidence gate,
 * and the same rule that makes the platform refuse to record a bank transfer it
 * cannot witness.
 *
 * A resubmit after a correction is the SAME filing — the acceptance already
 * given stands, and re-asking would train people to click through it.
 */

'use strict';

const {
    resolveDeclarationsAcceptance,
    DECLARATIONS_REQUIRED,
} = require('../../services/application-declarations-gate');

const AT = '2026-09-05T10:00:00.000Z';

describe('a first submit must carry the declarations', () => {
    test('a payload that accepts them is stamped with the SERVER\'s time', () => {
        const out = resolveDeclarationsAcceptance({
            formData: {},
            payload: { declarationsAccepted: true },
            now: new Date(AT),
        });
        expect(out.acceptedAt).toBe(AT);
    });

    test('a payload that does not is refused, and the refusal is catalogued', () => {
        expect(() => resolveDeclarationsAcceptance({ formData: {}, payload: {} }))
            .toThrow(expect.objectContaining({ code: DECLARATIONS_REQUIRED }));
    });

    test.each([
        ['false', false],
        ['a string', 'true'],
        ['a number', 1],
        ['missing', undefined],
        ['null', null],
    ])('only a real boolean true counts — %s does not', (_label, value) => {
        expect(() => resolveDeclarationsAcceptance({
            formData: {}, payload: { declarationsAccepted: value },
        })).toThrow(expect.objectContaining({ code: DECLARATIONS_REQUIRED }));
    });

    test('a client-supplied timestamp is IGNORED — the platform stamps its own', () => {
        const out = resolveDeclarationsAcceptance({
            formData: {},
            payload: { declarationsAccepted: true, declarationsAcceptedAt: '2020-01-01T00:00:00.000Z' },
            now: new Date(AT),
        });
        expect(out.acceptedAt).toBe(AT);
        expect(out.acceptedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });

    test('a draft that already carries a client-written stamp does not satisfy the gate', () => {
        // formData is applicant-writable through /prepare, so a stamp sitting in
        // it proves nothing unless the server put it there. On a first submit the
        // acceptance must come from THIS request.
        expect(() => resolveDeclarationsAcceptance({
            formData: { declarationsAcceptedAt: '2020-01-01T00:00:00.000Z' },
            payload: {},
            isFirstSubmit: true,
        })).toThrow(expect.objectContaining({ code: DECLARATIONS_REQUIRED }));
    });
});

describe('a resubmit is the same filing', () => {
    test('an acceptance already recorded by the server stands', () => {
        const out = resolveDeclarationsAcceptance({
            formData: { declarationsAcceptedAt: AT },
            payload: {},
            isFirstSubmit: false,
        });
        expect(out.acceptedAt).toBe(AT);
        expect(out.alreadyAccepted).toBe(true);
    });

    test('a resubmit of a filing that somehow has none is still refused', () => {
        expect(() => resolveDeclarationsAcceptance({
            formData: {}, payload: {}, isFirstSubmit: false,
        })).toThrow(expect.objectContaining({ code: DECLARATIONS_REQUIRED }));
    });

    test('re-accepting on a resubmit does not move the original time', () => {
        const out = resolveDeclarationsAcceptance({
            formData: { declarationsAcceptedAt: AT },
            payload: { declarationsAccepted: true },
            isFirstSubmit: false,
            now: new Date('2026-12-31T00:00:00.000Z'),
        });
        // The first acceptance is the one with legal weight; a later click is not
        // a new certification of the same filing.
        expect(out.acceptedAt).toBe(AT);
    });
});

describe('the refusal reaches the person who has to act on it', () => {
    test('it carries Thai copy naming what to do', () => {
        let err;
        try { resolveDeclarationsAcceptance({ formData: {}, payload: {} }); } catch (e) { err = e; }
        expect(err.messageTh).toContain('คำรับรอง');
        expect(err.httpStatus).toBe(422);
    });

    test('it is in shared/error-codes.js — a code no catalogue knows cannot be explained', () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        expect(ERROR_CODES[DECLARATIONS_REQUIRED]).toBeDefined();
        expect(ERROR_CODES[DECLARATIONS_REQUIRED].httpStatus).toBe(422);
        expect(typeof ERROR_CODES[DECLARATIONS_REQUIRED].messageTh).toBe('string');
    });
});

describe('the submit door actually runs the gate', () => {
    // The gate being correct and the door not calling it is the shape this repo
    // has shipped twice (recordRemittanceToDtam, the PDPA sweep). Structural, so
    // it cannot be satisfied by a mock.
    const fs = require('fs');
    const path = require('path');
    const door = fs.readFileSync(
        path.join(__dirname, '..', '..', 'routes/api/applications/applications.js'), 'utf8',
    );

    test('applications.js requires the gate', () => {
        expect(door).toContain('application-declarations-gate');
        expect(door).toContain('resolveDeclarationsAcceptance');
    });

    test('and writes the server stamp into formData, not the payload\'s', () => {
        expect(door).toContain('declarationsAcceptedAt');
    });

    test('declarationsAcceptedAt is server-owned, so /prepare cannot write it', () => {
        const owned = fs.readFileSync(
            path.join(__dirname, '..', '..', 'shared/form-data-ownership.js'), 'utf8',
        );
        expect(owned).toContain('declarationsAcceptedAt');
    });
});
