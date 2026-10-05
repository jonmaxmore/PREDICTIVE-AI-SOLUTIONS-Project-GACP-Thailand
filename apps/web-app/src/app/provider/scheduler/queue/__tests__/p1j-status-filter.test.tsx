/**
 * p1j-status-filter.test.tsx — Wave-3 P1-J scheduler queue status filter.
 *
 * The scheduler works cases across the whole audit phase, but the queue
 * status dropdown previously offered only AUDIT_FEE_PAID + "all". This pins
 * the expanded status set (the backend /queue endpoint already threads any
 * ?status into the WHERE), while keeping AUDIT_FEE_PAID the default.
 *
 * Shape — source-read assertion (repo FE convention; the queue client mounts
 * the finance component kit + AssignAuditorModal).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CLIENT_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'client-view.tsx'),
    'utf8',
);

describe('P1-J scheduler queue — expanded status filter', () => {
    it('defines a SCHEDULER_QUEUE_STATUSES set with the audit-phase states', () => {
        for (const status of [
            'AUDIT_FEE_PAID',
            'AUDIT_CONFIRMED',
            'CAR_PENDING',
            'CAR_REVIEWING',
            'AUDIT_PASSED',
        ]) {
            expect(CLIENT_SOURCE).toMatch(new RegExp(`value: '${status}'`));
        }
    });

    it('keeps a "ทุกสถานะ" (all) option with an empty value', () => {
        expect(CLIENT_SOURCE).toMatch(/value: '', label: 'ทุกสถานะ'/);
    });

    it('populates the <select> from SCHEDULER_QUEUE_STATUSES (not hard-coded options)', () => {
        expect(CLIENT_SOURCE).toMatch(
            /SCHEDULER_QUEUE_STATUSES\.map\(\(s\) => \([\s\S]*?<option/,
        );
    });

    it('defaults the status filter to AUDIT_FEE_PAID', () => {
        expect(CLIENT_SOURCE).toMatch(/filters\.status \|\| 'AUDIT_FEE_PAID'/);
    });
});
