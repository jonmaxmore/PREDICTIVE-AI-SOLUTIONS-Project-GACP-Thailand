'use strict';

/**
 * Contract lock for mapHealthApplication's identifier field — INVERTED 2026-09-05.
 *
 * This file used to assert the opposite: that the identifier is emitted as `_id`
 * and that a plain `id` key must NOT exist ("a rename would re-break billing").
 * That was an honest reading of the situation at the time — the health billing
 * page read `._id`, and a previous version that read `.id` got undefined, a
 * permanent spinner and colliding React keys.
 *
 * But the lock was holding the WRONG NAME in place. Every record's key is `id`.
 * The PostgreSQL database has no `_id` column anywhere (checked:
 * information_schema, 0 rows) and neither does the Prisma schema — the name existed only on the wire, and only because five
 * route handlers spelled it that way. Operator ordered it removed root and branch
 * on 2026-09-05.
 *
 * So the assertions are turned around rather than deleted. The file keeps doing
 * the same job — stopping the identifier from silently changing shape — but now
 * it guards the CORRECT name, and the old one cannot come back without going red.
 *
 * The helper is a pure projection (it only pulls in shared/health-dashboard-stage,
 * which has no DB import), so it can be required directly with no prisma mock.
 */

const { mapHealthApplication } = require('../../routes/api/helpers/applications-helpers');

describe('mapHealthApplication emits `id`, and never `_id`', () => {
    const row = {
        id: 'app-uuid-123',
        applicationNumber: 'GACP-2569-0001',
        status: 'SUBMITTED',
        plantName: 'กัญชา',
        serviceType: 'GACP_CERTIFICATION',
        phase1Status: 'PAID',
        phase2Status: null,
        estimatedFee: 5535,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        submittedAt: new Date('2026-01-02T00:00:00Z'),
        formData: { workflowState: 'PENDING_DOC_FEE' },
        certificates: [],
    };

    test('the identifier is exposed as `id` carrying the Application.id value', () => {
        const mapped = mapHealthApplication(row);
        expect(mapped.id).toBe('app-uuid-123');
    });

    test('does NOT expose `_id` — the old name is gone, not aliased', () => {
        // Emitting BOTH is what let the wrong name survive for months: every
        // consumer picked one at random and the duplicate looked harmless.
        const mapped = mapHealthApplication(row);
        expect(Object.prototype.hasOwnProperty.call(mapped, '_id')).toBe(false);
        expect(mapped._id).toBeUndefined();
    });

    test('applicationNumber is preserved for the picker label', () => {
        const mapped = mapHealthApplication(row);
        expect(mapped.applicationNumber).toBe('GACP-2569-0001');
    });
});
