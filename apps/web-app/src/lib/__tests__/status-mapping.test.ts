/**
 * status-mapping.test.ts — frontend "what should the user do next" copy
 * for every workflow state.
 *
 * STATUS_NEXT_ACTIONS is a Record<WorkflowState, StatusInfo> — the dashboard
 * action card reads it to render the prompt + button. If a new workflow
 * state lands in apps/web-app/src/lib/constants/workflow-states.ts but
 * STATUS_NEXT_ACTIONS doesn't get a row, getStatusInfo() falls through
 * to the generic "ดูรายละเอียดในหน้าคำขอ" — silently degrading the user
 * experience. This test catches that drift.
 */

import {
  STATUS_NEXT_ACTIONS,
  getNextAction,
  getStatusInfo,
  isUserActionRequired,
  getActionRequiredStatuses,
  type StatusUrgency,
} from '../status-mapping';
import { WORKFLOW_STATES } from '../constants/workflow-states';

describe('status-mapping (frontend per-state action copy)', () => {
  describe('STATUS_NEXT_ACTIONS — dictionary completeness', () => {
    it('has exactly one entry for every WorkflowState', () => {
      // Every canonical state must have a row. Missing state → user sees
      // generic fallback instead of the targeted next-action.
      for (const state of WORKFLOW_STATES) {
        expect(STATUS_NEXT_ACTIONS[state]).toBeDefined();
        expect(typeof STATUS_NEXT_ACTIONS[state].nextAction).toBe('string');
        expect(STATUS_NEXT_ACTIONS[state].nextAction.length).toBeGreaterThan(0);
      }
    });

    it('every entry has the documented shape (icon + urgency + description)', () => {
      const validUrgencies: StatusUrgency[] = ['none', 'low', 'medium', 'high'];
      for (const state of WORKFLOW_STATES) {
        const info = STATUS_NEXT_ACTIONS[state];
        expect(typeof info.icon).toBe('string');
        expect(info.icon.length).toBeGreaterThan(0);
        expect(validUrgencies).toContain(info.urgency);
        expect(typeof info.description).toBe('string');
      }
    });

    it('high-urgency states have an actionLabel (button copy)', () => {
      // High-urgency = the user must do something. The dashboard renders
      // a button using `actionLabel`; missing it would render an unlabeled
      // CTA. Pin the contract: high → must have actionLabel.
      for (const state of WORKFLOW_STATES) {
        const info = STATUS_NEXT_ACTIONS[state];
        if (info.urgency === 'high') {
          expect(typeof info.actionLabel).toBe('string');
          expect(info.actionLabel?.length ?? 0).toBeGreaterThan(0);
        }
      }
    });

    it('STATUS_NEXT_ACTIONS does NOT include states outside WORKFLOW_STATES', () => {
      // Catch the reverse drift: a stale row in STATUS_NEXT_ACTIONS for
      // a state that's been removed from WORKFLOW_STATES.
      const declaredStates = new Set<string>(WORKFLOW_STATES);
      for (const key of Object.keys(STATUS_NEXT_ACTIONS)) {
        expect(declaredStates.has(key)).toBe(true);
      }
    });
  });

  describe('Terminal states', () => {
    it('CERTIFIED urgency is "low" (download-cert is optional)', () => {
      // The applicant has reached the goal; the optional next step is
      // downloading the cert PDF. "low" urgency renders the action card
      // without the red/orange CTA emphasis. Pin so a future refactor
      // doesn't accidentally re-elevate it to "high" and nag certified
      // users to "do something" when they've already finished.
      expect(STATUS_NEXT_ACTIONS.CERTIFIED.urgency).toBe('low');
    });

    it('REJECTED + EXPIRED + CANCEL_EXPIRED have no high-urgency CTA', () => {
      // Terminal-failure states should not push the user to take an action
      // (the legitimate path is starting a new application, which is
      // surfaced elsewhere in the UI).
      for (const state of ['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED'] as const) {
        const info = STATUS_NEXT_ACTIONS[state];
        expect(info.urgency).not.toBe('high');
      }
    });
  });

  describe('Helper functions', () => {
    it('getNextAction returns the documented copy for known state', () => {
      expect(getNextAction('DRAFT')).toBe(STATUS_NEXT_ACTIONS.DRAFT.nextAction);
      expect(getNextAction('CERTIFIED')).toBe(STATUS_NEXT_ACTIONS.CERTIFIED.nextAction);
    });

    it('getNextAction falls back to generic copy for unknown state', () => {
      expect(getNextAction('GARBAGE_STATE')).toBe('ดูรายละเอียดในหน้าคำขอ');
      expect(getNextAction('')).toBe('ดูรายละเอียดในหน้าคำขอ');
    });

    it('getStatusInfo returns full StatusInfo for known state', () => {
      const info = getStatusInfo('DOC_FEE_PAID');
      expect(info.nextAction).toBe(STATUS_NEXT_ACTIONS.DOC_FEE_PAID.nextAction);
      expect(info.urgency).toBe(STATUS_NEXT_ACTIONS.DOC_FEE_PAID.urgency);
    });

    it('getStatusInfo falls back to a complete StatusInfo for unknown state', () => {
      // Important: the fallback must be a *complete* StatusInfo (not undefined
      // partial) so callers can read .urgency / .icon without optional chaining.
      const info = getStatusInfo('GARBAGE_STATE');
      expect(typeof info.nextAction).toBe('string');
      expect(typeof info.description).toBe('string');
      expect(typeof info.icon).toBe('string');
      expect(info.urgency).toBe('none');
    });

    it('isUserActionRequired is true ONLY for high + medium urgency', () => {
      // Pin the boolean contract — UI badge color depends on it.
      for (const state of WORKFLOW_STATES) {
        const info = STATUS_NEXT_ACTIONS[state];
        const expected = info.urgency === 'high' || info.urgency === 'medium';
        expect(isUserActionRequired(state)).toBe(expected);
      }
    });

    it('isUserActionRequired returns false for unknown state', () => {
      expect(isUserActionRequired('GARBAGE_STATE')).toBe(false);
    });

    it('getActionRequiredStatuses returns the high+medium set', () => {
      const set = getActionRequiredStatuses();
      expect(Array.isArray(set)).toBe(true);
      expect(set.length).toBeGreaterThan(0);
      // Every entry must actually be a known state with high/medium urgency.
      for (const state of set) {
        expect(WORKFLOW_STATES).toContain(state);
        const u = STATUS_NEXT_ACTIONS[state].urgency;
        expect(['high', 'medium']).toContain(u);
      }
    });

    it('DRAFT is action-required (medium urgency)', () => {
      // Anchor a specific known-good case so a future "tighten DRAFT to
      // urgency=none" refactor is explicit instead of silent.
      expect(isUserActionRequired('DRAFT')).toBe(true);
    });

    it('CERTIFIED is NOT action-required', () => {
      expect(isUserActionRequired('CERTIFIED')).toBe(false);
    });
  });
});
