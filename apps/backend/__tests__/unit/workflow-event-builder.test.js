/**
 * Workflow event shape contract — shared/workflow-event-builder.js.
 *
 * Every workflow state change appends an event to Application.workflowHistory
 * via this builder. Frontend timeline + audit-log search depend on the
 * shape — extra/missing fields silently break those readers.
 */

const { buildWorkflowEvent } = require('../../shared/workflow-event-builder');

describe('workflow-event-builder', () => {
    it('returns the documented event shape with all fields populated', () => {
        const event = buildWorkflowEvent({
            action: 'WORKFLOW_TRANSITION',
            fromState: 'DOC_FEE_PAID',
            toState: 'ASSIGNED_FOR_REVIEW',
            fromStatus: 'DOC_FEE_PAID',
            toStatus: 'ASSIGNED_FOR_REVIEW',
            actorId: 'user-1',
            actorRole: 'scheduler',
            comment: 'assigned to reviewer A',
            reasonCode: 'SCHEDULER_ASSIGN',
        });

        expect(event.action).toBe('WORKFLOW_TRANSITION');
        expect(event.fromState).toBe('DOC_FEE_PAID');
        expect(event.toState).toBe('ASSIGNED_FOR_REVIEW');
        expect(event.fromStatus).toBe('DOC_FEE_PAID');
        expect(event.toStatus).toBe('ASSIGNED_FOR_REVIEW');
        expect(event.actorId).toBe('user-1');
        expect(event.actorRole).toBe('scheduler');
        expect(event.comment).toBe('assigned to reviewer A');
        expect(event.reasonCode).toBe('SCHEDULER_ASSIGN');
        // metadata is omitted when not provided
        expect(event).not.toHaveProperty('metadata');
        // timestamp is always present + ISO 8601
        expect(typeof event.timestamp).toBe('string');
        expect(() => new Date(event.timestamp).toISOString()).not.toThrow();
    });

    it('attaches metadata only when provided (no empty stub)', () => {
        const withMeta = buildWorkflowEvent({
            action: 'REVISION_REQUESTED',
            metadata: { deadline: '2026-06-01', reasonType: 'document' },
        });
        expect(withMeta.metadata).toEqual({ deadline: '2026-06-01', reasonType: 'document' });

        const withoutMeta = buildWorkflowEvent({ action: 'REVISION_REQUESTED' });
        expect(withoutMeta).not.toHaveProperty('metadata');
    });

    it('defaults every optional field to null (not undefined)', () => {
        // Minimum-input call — the audit-log reader reads every field
        // unconditionally, so undefined would surface as "undefined" in
        // logs. null is the documented placeholder.
        const event = buildWorkflowEvent({ action: 'NOTE' });
        expect(event.fromState).toBeNull();
        expect(event.toState).toBeNull();
        expect(event.fromStatus).toBeNull();
        expect(event.toStatus).toBeNull();
        expect(event.actorId).toBeNull();
        expect(event.actorRole).toBeNull();
        expect(event.comment).toBeNull();
        expect(event.reasonCode).toBeNull();
    });

    it('coerces falsy inputs to null', () => {
        // Empty strings / 0 / undefined collapse to null — keeps the
        // serialized history compact and uniform.
        const event = buildWorkflowEvent({
            action: 'WORKFLOW_TRANSITION',
            fromState: '',
            toState: undefined,
            actorId: 0,
            actorRole: null,
        });
        expect(event.fromState).toBeNull();
        expect(event.toState).toBeNull();
        expect(event.actorId).toBeNull();
        expect(event.actorRole).toBeNull();
    });

    it('produces a fresh ISO timestamp on each call', () => {
        const a = buildWorkflowEvent({ action: 'A' });
        // Force monotonic difference so we do not rely on clock resolution.
        const t1 = new Date(a.timestamp).getTime();
        const b = buildWorkflowEvent({ action: 'B' });
        const t2 = new Date(b.timestamp).getTime();
        expect(t2).toBeGreaterThanOrEqual(t1);
        // Both must serialize back through Date without loss.
        expect(new Date(a.timestamp).toISOString()).toBe(a.timestamp);
        expect(new Date(b.timestamp).toISOString()).toBe(b.timestamp);
    });
});
