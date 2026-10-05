/**
 * Every status this codebase writes must be one the rest of the codebase can
 * read — and can move on from.
 *
 * `createPhase1Payment` wrote `toStatus: 'PAYMENT_PHASE_1'`. That string is in
 * neither WORKFLOW_STATES nor STATE_BY_LEGACY_STATUS nor ALLOWED_TRANSITIONS.
 * The write itself succeeded, because writeApplicationStatus only consults the
 * transition table when the caller opts in with `assertTransition`, and this
 * caller does not.
 *
 * The consequence lands one step later. `POST /payments/phase1/:id` is what the
 * wizard's payment button calls, so every applicant who reaches the payment
 * screen is moved into PAYMENT_PHASE_1. They then transfer the money and upload
 * the slip, and payment-slip-service checked (that service is gone now — the slip
 * flow retired 2026-09-11 — but the defect class it demonstrates is the point):
 *
 *     const canonicalStatus = STATE_BY_LEGACY_STATUS[application.status] || application.status;
 *     if (canonicalStatus is neither the pending-fee state nor the slip-review
 *         state) throw
 *
 * PAYMENT_PHASE_1 maps to nothing, so it stays PAYMENT_PHASE_1, so the upload
 * throws: "Cannot upload slip from application status PAYMENT_PHASE_1". The
 * farmer has paid a real fee into a real bank account and cannot submit the
 * proof. The whole certification pipeline stops there.
 *
 * The team found this exact defect in the Phase-2 twin and retired that endpoint
 * in June 2026 — payments.js:299 says so: "createPhase2Payment wrote a
 * non-canonical PAYMENT_PHASE_2 status + an off-canon invoice that desynced the
 * 20-state workflow". Phase 1 was left as it was.
 *
 * So this test does not check one string. It scans every `toStatus:` literal in
 * the service and route layers and requires each to be resolvable and to have
 * somewhere to go — which is the property that was actually missing.
 */

const fs = require('fs');
const path = require('path');

const wf = require('../../services/workflow-transition-service');

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['services', 'routes', 'controllers'];

/** Every `toStatus: 'X'` literal the backend writes, with where it came from. */
function collectStatusWrites() {
    const found = new Map();

    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '__tests__') {continue;}
                walk(full);
                continue;
            }
            if (!entry.name.endsWith('.js')) {continue;}

            const text = fs.readFileSync(full, 'utf8');
            for (const match of text.matchAll(/toStatus:\s*'([A-Z0-9_]+)'/g)) {
                const status = match[1];
                if (!found.has(status)) {found.set(status, []);}
                found.get(status).push(path.relative(ROOT, full));
            }
        }
    };

    for (const dir of SCAN_DIRS) {walk(path.join(ROOT, dir));}
    return found;
}

/**
 * What the rest of the platform will understand this status to mean.
 *
 * Was `STATE_BY_LEGACY_STATUS[status] || status` until PR 2c deleted that
 * table. The column is canonical-only now, so "what it means" is just "does
 * the SSOT recognise it" — and a status that does not resolve is exactly the
 * unreachable-write this suite exists to catch.
 */
function resolve(status) {
    return wf.normalizeWorkflowStateInput(status) || status;
}

describe('every status the backend writes is reachable', () => {
    const writes = collectStatusWrites();

    it('finds status writes to check', () => {
        // A regex that silently matches nothing would make this whole file pass
        // while checking absolutely nothing.
        expect(writes.size).toBeGreaterThan(3);
    });

    it('resolves each one to a canonical state', () => {
        const unresolvable = [];
        for (const [status, files] of writes) {
            if (!wf.WORKFLOW_STATES.includes(resolve(status))) {
                unresolvable.push(`${status} (written by ${files.join(', ')})`);
            }
        }
        expect(unresolvable).toEqual([]);
    });

    it('leaves each one with somewhere to go', () => {
        // A status with no outbound edge is a dead end: whatever the applicant
        // does next is refused, and the refusal names a status they have never
        // seen and cannot act on.
        const terminal = new Set(['CERTIFIED', 'REJECTED', 'CANCEL_EXPIRED']);
        const deadEnds = [];

        for (const [status, files] of writes) {
            const canonical = resolve(status);
            if (terminal.has(canonical)) {continue;}
            const edges = wf.ALLOWED_TRANSITIONS?.[canonical];
            if (!edges || edges.size === 0) {
                deadEnds.push(`${status} → ${canonical} (written by ${files.join(', ')})`);
            }
        }
        expect(deadEnds).toEqual([]);
    });
});

describe('the งวดที่ 1 path lands where checkout will accept payment', () => {
    /**
     * เดิมบล็อกนี้เทียบกับประตูอัปโหลดสลิป · สลิปปลดระวาง 2026-09-11 · ประตูที่ต้อง
     * รับได้ตอนนี้คือ checkout ซึ่งมีรายการสถานะที่ชำระได้ของตัวเองอยู่แล้ว
     * (`PAYABLE_STATES` ใน services/checkout/stripe-checkout-service.js)
     *
     * ถ้าเส้นทางการชำระพาคำขอไปอยู่สถานะอื่น ผู้ยื่นจะกดจ่ายไม่ได้ — อาการเดียวกับ
     * ที่บล็อกนี้กันไว้ตั้งแต่แรก คนละประตู
     *
     * อ่านจาก SSOT ไม่ใช่พิมพ์รายการซ้ำ: รายการที่พิมพ์มือจะไม่ขยับตามประตูจริง
     */
    const { PAYABLE_STATES } = require('../../services/checkout/stripe-checkout-service');

    it('the งวดที่ 1 path lands on a state checkout accepts', () => {
        expect(PAYABLE_STATES.M1).toContain(resolve('PENDING_DOC_FEE'));
    });

    it('and the งวดที่ 2 path does too', () => {
        expect(PAYABLE_STATES.M2).toContain(resolve('PENDING_AUDIT_FEE'));
    });

    it('the legacy spellings resolve to nothing rather than to a plausible state', () => {
        // Fail-closed: an application carrying one of these is corrupt data,
        // and silently reading it as "pending fee" would let a payment flow
        // proceed on a row no writer could have produced.
        expect(wf.normalizeWorkflowStateInput('PAYMENT_PHASE_1')).toBeNull();
        expect(wf.normalizeWorkflowStateInput('PAYMENT_PHASE_2')).toBeNull();
    });

    it('has a legal edge onward from each fee state — the settled webhook', () => {
        // เดิมข้อนี้ตรึงขาไปหาสถานะสลิป · สลิปปลดระวาง 2026-09-11 แต่สิ่งที่ต้องตรึงยัง
        // เหมือนเดิม: สถานะที่เขียนได้ต้อง **เดินต่อไปไหนได้** ไม่ใช่ทางตัน
        expect(wf.canTransition('PENDING_DOC_FEE', 'DOC_FEE_PAID')).toBe(true);
        expect(wf.canTransition('PENDING_AUDIT_FEE', 'AUDIT_FEE_PAID')).toBe(true);
    });

    it('no longer writes the non-canonical status at all', () => {
        // The legacy mapping above unsticks existing rows. This stops new ones
        // being created — the same conclusion the Phase-2 retirement reached.
        const source = fs.readFileSync(
            path.join(ROOT, 'services/payment-service-phase-flow.js'), 'utf8',
        );
        expect(source).not.toMatch(/toStatus:\s*'PAYMENT_PHASE_[12]'/);
    });
});
