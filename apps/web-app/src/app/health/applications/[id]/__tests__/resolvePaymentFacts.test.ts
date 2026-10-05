/**
 * resolvePaymentFacts unit tests — closes gap #3 from the 2026-04-29
 * testing-strategy audit. The function shipped in v3.4.2 (commit 0292078)
 * to fix the production bug where /health/applications/<id> rendered
 * the wrong action card when status=REGISTERED + phase1Status=PAID.
 *
 * The contract:
 *  - When `canonical` is provided AND has phase1Status / phase2Status,
 *    those win (canonical truth from DB).
 *  - When `canonical` is null/undefined OR has no phase fields,
 *    fall back to inferring from workflow text (legacy payloads).
 *  - canonical phase{1,2}PaidAt is preserved when canonical wins.
 */

import { resolvePaymentFacts } from '../application-detail-page-helpers';
import type { ApplicationHistoryPayload } from '../application-detail-page-config';

function buildHistory(events: Array<{
  fromStatus?: string;
  toStatus?: string;
  action?: string;
  timestamp?: string;
}>): ApplicationHistoryPayload {
  return {
    applicationId: 'test-app',
    applicationNumber: 'APP-TEST',
    status: events[events.length - 1]?.toStatus || 'DRAFT',
    workflowHistory: events.map((e, i) => ({
      index: i + 1,
      timestamp: e.timestamp || `2026-04-2${i}T00:00:00Z`,
      action: e.action || null,
      fromStatus: e.fromStatus || null,
      toStatus: e.toStatus || null,
      actorId: null,
      actorRole: null,
      step: null,
      reason: null,
      comment: null,
    })),
    comments: [],
    revisions: [],
    rejections: [],
  };
}

describe('resolvePaymentFacts (v3.4.2 canonical-vs-fallback resolver)', () => {
  describe('canonical phase status wins when present', () => {
    it('returns docPaid=true when canonical.phase1Status=PAID, regardless of status text', () => {
      // The exact production bug: status=REGISTERED but phase1 IS paid in DB.
      // Without canonical, the workflow-text inference would say docPaid=false.
      const facts = resolvePaymentFacts('REGISTERED', null, {
        phase1Status: 'PAID',
        phase1PaidAt: '2026-03-15T03:28:59Z',
        phase2Status: 'PENDING',
        phase2PaidAt: null,
      });
      expect(facts.docPaid).toBe(true);
      expect(facts.auditPaid).toBe(false);
      expect(facts.docPaidAt).toBe('2026-03-15T03:28:59Z');
      expect(facts.auditPaidAt).toBeNull();
    });

    it('returns auditPaid=true when canonical.phase2Status=PAID', () => {
      const facts = resolvePaymentFacts('AUDIT_FEE_PAID', null, {
        phase1Status: 'PAID',
        phase1PaidAt: '2026-03-15T03:28:59Z',
        phase2Status: 'PAID',
        phase2PaidAt: '2026-04-01T10:00:00Z',
      });
      expect(facts.docPaid).toBe(true);
      expect(facts.auditPaid).toBe(true);
      expect(facts.docPaidAt).toBe('2026-03-15T03:28:59Z');
      expect(facts.auditPaidAt).toBe('2026-04-01T10:00:00Z');
    });

    it('returns docPaid=false when canonical.phase1Status is not PAID (e.g. PENDING)', () => {
      const facts = resolvePaymentFacts('SUBMITTED', null, {
        phase1Status: 'PENDING',
        phase1PaidAt: null,
        phase2Status: 'PENDING',
        phase2PaidAt: null,
      });
      expect(facts.docPaid).toBe(false);
      expect(facts.auditPaid).toBe(false);
      expect(facts.docPaidAt).toBeNull();
      expect(facts.auditPaidAt).toBeNull();
    });

    it('canonical wins even when workflow history would say PAID', () => {
      // Workflow history says SUBMITTED → DOC_FEE_PAID (would-be docPaid=true
      // via fallback inference) but canonical says phase1Status=PENDING. We
      // trust canonical (DB truth) over workflow text (potentially stale).
      const history = buildHistory([
        { fromStatus: 'DRAFT', toStatus: 'SUBMITTED' },
        { fromStatus: 'SUBMITTED', toStatus: 'DOC_FEE_PAID' },
      ]);
      const facts = resolvePaymentFacts('DOC_FEE_PAID', history, {
        phase1Status: 'PENDING',
        phase1PaidAt: null,
        phase2Status: 'PENDING',
        phase2PaidAt: null,
      });
      expect(facts.docPaid).toBe(false);
    });

    it('handles only phase1Status set (phase2Status undefined → falls back to inference for phase2)', () => {
      // Edge case: backend sends phase1Status but not phase2Status. The
      // canonical short-circuit fires because at least one phase field is
      // present, then falls back to legacy markers for phase2 within the
      // same canonical branch (auditPaidByColumn = upper(undefined||'') === 'PAID' = false).
      const facts = resolvePaymentFacts('SUBMITTED', null, {
        phase1Status: 'PAID',
        phase1PaidAt: '2026-03-15T00:00:00Z',
      });
      expect(facts.docPaid).toBe(true);
      expect(facts.auditPaid).toBe(false);
    });
  });

  describe('falls back to workflow inference when canonical is missing', () => {
    it('returns docPaid=false when status=REGISTERED + no canonical + no history (old payload)', () => {
      // This is the EXACT bug shape v3.4.2 was meant to fix. With no canonical
      // and no useful history, fallback inference says docPaid=false. The fix
      // works because frontend now passes canonical (from new API payload).
      const facts = resolvePaymentFacts('REGISTERED', null, null);
      expect(facts.docPaid).toBe(false);
      expect(facts.auditPaid).toBe(false);
    });

    it('infers docPaid=true from history with action=APPLICATION_FINALIZED_AFTER_PHASE1_PAYMENT', () => {
      const history = buildHistory([
        {
          action: 'APPLICATION_FINALIZED_AFTER_PHASE1_PAYMENT',
          fromStatus: 'PENDING_DOC_FEE',
          toStatus: 'DOC_FEE_PAID',
          timestamp: '2026-04-01T12:00:00Z',
        },
      ]);
      const facts = resolvePaymentFacts('DOC_FEE_PAID', history, null);
      expect(facts.docPaid).toBe(true);
      expect(facts.docPaidAt).toBe('2026-04-01T12:00:00Z');
    });

    it('infers auditPaid=true from history with toStatus=AUDIT_FEE_PAID', () => {
      const history = buildHistory([
        { fromStatus: 'PENDING_AUDIT_FEE', toStatus: 'AUDIT_FEE_PAID', timestamp: '2026-04-15T00:00:00Z' },
      ]);
      const facts = resolvePaymentFacts('AUDIT_FEE_PAID', history, null);
      expect(facts.auditPaid).toBe(true);
      expect(facts.auditPaidAt).toBe('2026-04-15T00:00:00Z');
    });

    it('treats CERTIFIED status alone as docPaid=true + auditPaid=true (terminal)', () => {
      const facts = resolvePaymentFacts('CERTIFIED', null, null);
      expect(facts.docPaid).toBe(true);
      expect(facts.auditPaid).toBe(true);
    });
  });

  describe('canonical with empty fields = falls back to inference', () => {
    it('canonical with both phase fields empty/undefined → fallback path runs', () => {
      // The canonical short-circuit fires when phase1Status OR phase2Status
      // is truthy. If both are empty strings or undefined, the function
      // continues to the fallback inference.
      const history = buildHistory([
        { fromStatus: 'DRAFT', toStatus: 'SUBMITTED', timestamp: '2026-04-01T00:00:00Z' },
      ]);
      const facts = resolvePaymentFacts('SUBMITTED', history, {
        phase1Status: '',
        phase2Status: '',
      });
      // SUBMITTED is in the docPaidMarkers set (per fallback logic).
      expect(facts.docPaid).toBe(true);
    });
  });
});
