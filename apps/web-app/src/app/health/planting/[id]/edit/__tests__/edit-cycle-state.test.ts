/**
 * The rules of the edit screen, tested without rendering.
 *
 * This screen did not exist. `plantingService.updateCycle()` sat in the client with
 * no caller anywhere in apps/web-app, so R11/R12 — "editable until the cut, frozen
 * after" — had never been exercised from a browser at all.
 *
 * Since T1 the server refuses edits to the four fields the public scan publishes,
 * with 409 CYCLE_FROZEN. The screen has to say that BEFORE the farmer types, not
 * after they press save: being told your work is rejected is worse than being told
 * it cannot be started.
 */
import {
    freezeReason, pageState, buildPatch, saveState, frozenRefusalMessage,
    FROZEN_AFTER_CUT,
    type Cycle,
} from '../edit-cycle-state';

const open = (over: Partial<Cycle> = {}): Cycle => ({
    id: 'c1', status: 'GROWING', batchCount: 0,
    cycleName: 'รอบ 1', varietyName: 'หางกระรอก', seedSource: 'เมล็ดรับรอง',
    soilType: 'ร่วนปนทราย', irrigationType: 'น้ำหยด', notes: 'บันทึก', ...over,
});

describe('freezeReason mirrors the server, and says WHICH reason', () => {
    it('HARVESTED and COMPLETED both freeze', () => {
        expect(freezeReason(open({ status: 'HARVESTED' }))).toBe('HARVESTED');
        expect(freezeReason(open({ status: 'COMPLETED' }))).toBe('HARVESTED');
    });

    it('having batches freezes a cycle that is still GROWING', () => {
        // The server's isLocked is `status OR batches > 0`; a screen that only
        // checked status would offer edits the door then refuses.
        expect(freezeReason(open({ status: 'GROWING', batchCount: 2 }))).toBe('HAS_BATCHES');
    });

    it('an open cycle is not frozen', () => {
        expect(freezeReason(open())).toBeNull();
    });
});

describe('freezeReason reads the batch count the REAL API sends', () => {
    // getById (planting-cycle-detail-loader.js) returns the batch count at
    // `traceSummary.batchCount` and `_count.batches` — there is NO top-level
    // `batchCount` on a live response. A screen that only checked the top-level
    // key would never see the HAS_BATCHES freeze from the real door, and would
    // offer edits the server then refuses with 409 CYCLE_FROZEN — the exact
    // "reject after typing" the design (§2.1) forbids.
    it('traceSummary.batchCount freezes a GROWING cycle', () => {
        expect(
            freezeReason(open({ status: 'GROWING', batchCount: undefined, traceSummary: { batchCount: 1 } })),
        ).toBe('HAS_BATCHES');
    });

    it('_count.batches freezes a GROWING cycle', () => {
        expect(
            freezeReason(open({ status: 'GROWING', batchCount: undefined, _count: { batches: 3 } })),
        ).toBe('HAS_BATCHES');
    });

    it('no batches in any shape leaves an open cycle editable', () => {
        expect(
            freezeReason(open({ status: 'GROWING', batchCount: undefined, traceSummary: { batchCount: 0 }, _count: { batches: 0 } })),
        ).toBeNull();
    });
});

describe('frozenRefusalMessage — a 409 must name the refused fields IN THAI', () => {
    // Belt-and-braces for the door's CYCLE_FROZEN 409. The screen freezes those
    // inputs up front, so this is only reached if state slips; when it is, the
    // farmer must read Thai field names, not the raw English keys the door joins
    // into its own message.
    it('maps the door field keys to Thai labels, dropping the raw keys', () => {
        const msg = frozenRefusalMessage(['varietyName', 'seedSource']);
        expect(msg).toContain('สายพันธุ์');
        expect(msg).toContain('แหล่งที่มาของเมล็ด/ต้นพันธุ์');
        expect(msg).not.toContain('varietyName');
        expect(msg).not.toContain('seedSource');
        expect(msg).toContain('ติดต่อเจ้าหน้าที่');
    });

    it('is null when there is nothing to name', () => {
        expect(frozenRefusalMessage([])).toBeNull();
        expect(frozenRefusalMessage(undefined)).toBeNull();
        expect(frozenRefusalMessage('varietyName')).toBeNull();
    });

    it('never silently drops an unknown key — it shows it raw', () => {
        expect(frozenRefusalMessage(['mysteryField'])).toContain('mysteryField');
    });
});

describe('pageState — three states, and "cannot read" is one of them', () => {
    it('an error is UNREADABLE, never an empty form', () => {
        // A blank editable form after a failed load invites the farmer to retype
        // everything and overwrite what is actually stored.
        expect(pageState({ loading: false, error: true, cycle: null })).toEqual({ kind: 'unreadable' });
        expect(pageState({ loading: false, error: false, cycle: null })).toEqual({ kind: 'unreadable' });
    });

    it('an open cycle is editable', () => {
        expect(pageState({ loading: false, error: false, cycle: open() }).kind).toBe('editable');
    });

    it('a cut cycle is frozen, and carries why', () => {
        const s = pageState({ loading: false, error: false, cycle: open({ status: 'HARVESTED' }) });
        expect(s.kind).toBe('frozen');
        expect(s.kind === 'frozen' && s.reason).toBe('HARVESTED');
    });
});

describe('buildPatch — never send what the door will refuse', () => {
    it('an open cycle may change everything', () => {
        const patch = buildPatch(open(), { varietyName: 'ใหม่', notes: 'n2' }, false);
        expect(patch).toEqual({ varietyName: 'ใหม่', notes: 'n2' });
    });

    it('a frozen cycle sends notes ONLY, even if the draft holds more', () => {
        // The door refuses the WHOLE request when a frozen key is present — it does
        // not drop the key quietly. So sending an unchanged frozen field anyway
        // would fail an edit the farmer is entitled to make.
        const patch = buildPatch(open({ status: 'HARVESTED' }), { varietyName: 'ใหม่', notes: 'n2' }, true);
        expect(patch).toEqual({ notes: 'n2' });
    });

    it('unchanged fields are not sent at all', () => {
        expect(buildPatch(open(), { varietyName: 'หางกระรอก' }, false)).toEqual({});
    });

    it('every frozen field is in the editable set BEFORE the cut', () => {
        const draft = Object.fromEntries(FROZEN_AFTER_CUT.map((f) => [f, 'x']));
        expect(Object.keys(buildPatch(open(), draft, false)).sort()).toEqual([...FROZEN_AFTER_CUT].sort());
    });

    it('and none of them after it', () => {
        const draft = Object.fromEntries(FROZEN_AFTER_CUT.map((f) => [f, 'x']));
        expect(buildPatch(open({ status: 'HARVESTED' }), draft, true)).toEqual({});
    });
});

describe('saveState', () => {
    it('nothing changed means nothing to save', () => {
        expect(saveState({}, false)).toEqual({ canSave: false, reason: 'NOTHING_CHANGED' });
    });

    it('a request in flight blocks a second press', () => {
        expect(saveState({ notes: 'n' }, true)).toEqual({ canSave: false, reason: 'IN_FLIGHT' });
    });

    it('a real change can be saved', () => {
        expect(saveState({ notes: 'n' }, false)).toEqual({ canSave: true, reason: null });
    });
});
