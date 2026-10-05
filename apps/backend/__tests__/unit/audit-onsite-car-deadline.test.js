/**
 * AUDITOR re-review (2026-06-24) — regression guard for the on-site CAR SLA clock.
 *
 * audit-onsite-service.submitDecision used to transition FAIL → CAR_PENDING WITHOUT
 * seeding the 5-working-day deadline (the 2026-06-11 HIGH, fixed only on the Job Sheet
 * handler). This locks in: on FAIL the deadline is seeded + carDueAt stamped into the
 * parent formData (preserving existing formData + workflowState); on PASS neither fires.
 *
 * cert-integrity fix (Phase A, 2026-08-16): the photo/checklist minimum gate is now
 * scoped to decision === PASS and is FAIL-CLOSED — a PASS with prisma omitting the
 * farmAuditPhoto / farmAuditChecklistItem `.count` methods THROWS EVIDENCE_CAPTURE_
 * UNAVAILABLE instead of silently skipping (see audit-onsite-service.js submitDecision).
 * The FAIL case below still uses the bare mock (a FAIL needs no evidence, so the models
 * stay legitimately absent); the PASS case below uses makePrismaWithEvidence() to reach
 * the decision write, since this file's purpose is the CAR-deadline clock, not the
 * evidence gate itself (that gate has its own coverage in audit-onsite-service.test.js).
 *
 * Task 3 (pin decided auditId through decision -> mint, 2026-08-17): submitDecision now
 * stamps formData.onsiteAuditId on BOTH branches (carFormData for FAIL, the new
 * passFormData for PASS) so the in-tx auto-mint verifies the SAME AuditChecklist row.
 * PASS no longer leaves formData untouched — it now carries the pin while still
 * preserving whatever formData already existed (asserted below, not clobbered).
 */

'use strict';

jest.mock('../../services/application-status-writer', () => ({
  writeApplicationStatus: jest.fn(async () => ({ ok: true })),
}));

const mockSeed = jest.fn(async () => ({}));
jest.mock('../../services/car-deadline-service', () => ({
  computeCarDueDate: jest.fn(() => new Date('2026-07-01T00:00:00.000Z')),
  seedCarRevisionDeadline: (...a) => mockSeed(...a),
}));

jest.mock('../../middleware/audit-logger', () => ({
  statusTransitionAuditHook: () => (async () => {}),
}));

jest.mock('../../shared/logger', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return Object.assign(l, { createLogger: () => l, default: l });
});

const { writeApplicationStatus } = require('../../services/application-status-writer');
const onsite = require('../../services/audit-onsite-service');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');

function makePrisma() {
  return {
    auditChecklist: {
      findFirst: jest.fn(async () => ({
        id: 'audit-1',
        status: 'IN_PROGRESS',
        application: {
          id: 'app-1',
          status: 'AUDIT_CONFIRMED',
          applicationNumber: 'GACP-2026-001',
          healthId: 'health-1',
          formData: { existing: true },
        },
      })),
    },
    // farmAuditPhoto / farmAuditChecklistItem intentionally omitted — fine for FAIL,
    // which needs no evidence; a PASS against this bare mock now throws fail-closed
    // (see makePrismaWithEvidence() below for the PASS test).
    $transaction: jest.fn(async (cb) => cb({
      auditChecklist: { update: jest.fn(async () => ({ id: 'audit-1', status: 'COMPLETED' })) },
    })),
  };
}

// PASS now requires provisioned + sufficient evidence models (fail-closed gate).
// This file's PASS test is about the CAR-deadline clock (it must NOT fire on PASS),
// not the evidence gate, so hand it enough evidence to clear the gate legitimately.
function makePrismaWithEvidence() {
  const p = makePrisma();
  p.farmAuditPhoto = farmAuditPhotoStub(5);
  p.farmAuditChecklistItem = { count: jest.fn(async () => onsite.CHECKLIST_TEMPLATE_2026.length) };
  return p;
}

describe('audit-onsite-service.submitDecision — CAR deadline SLA clock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('FAIL → seeds the RevisionDeadline + stamps formData.carDueAt + transitions CAR_PENDING', async () => {
    const prisma = makePrisma();
    const fanoutService = { send: jest.fn(async () => ({ ok: true })) };
    await onsite.submitDecision({
      auditId: 'audit-1', decision: 'FAIL', summary: 'ซ่อมรั้วแปลงปลูก', actorId: 'auditor-1', prisma, fanoutService,
    });

    expect(mockSeed).toHaveBeenCalledTimes(1);
    expect(mockSeed.mock.calls[0][0]).toMatchObject({ applicationId: 'app-1', actorId: 'auditor-1' });

    const writeArgs = writeApplicationStatus.mock.calls[0][0];
    expect(writeArgs.toStatus).toBe('CAR_PENDING');
    // carDueAt stamped into formData (applicant-facing CAR enforcement reads it),
    // existing formData preserved, and workflowState kept in sync (formData supplied
    // bypasses the writer's auto-sync).
    expect(writeArgs.additionalData.formData.carDueAt).toBe('2026-07-01T00:00:00.000Z');
    expect(writeArgs.additionalData.formData.car_due_at).toBe('2026-07-01T00:00:00.000Z');
    expect(writeArgs.additionalData.formData.workflowState).toBe('CAR_PENDING');
    expect(writeArgs.additionalData.formData.existing).toBe(true);
    // Task 3: the decided auditId is pinned alongside the CAR fields above.
    expect(writeArgs.additionalData.formData.onsiteAuditId).toBe('audit-1');
    expect(writeArgs.additionalData.auditResult).toBe('FAIL');
  });

  it('PASS → does NOT seed a CAR deadline; formData is preserved and pinned with onsiteAuditId (Task 3), not clobbered', async () => {
    const prisma = makePrismaWithEvidence();
    const fanoutService = { send: jest.fn(async () => ({ ok: true })) };
    await onsite.submitDecision({
      auditId: 'audit-1', decision: 'PASS', actorId: 'auditor-1', prisma, fanoutService,
    });

    expect(mockSeed).not.toHaveBeenCalled();
    const writeArgs = writeApplicationStatus.mock.calls[0][0];
    expect(writeArgs.toStatus).toBe('AUDIT_PASSED');
    // Task 3: PASS now stamps formData too (onsiteAuditId, the decided-row pin) —
    // but only that; the pre-existing formData.existing survives untouched, and no
    // CAR-only field (carDueAt/workflowState) leaks onto the PASS write.
    expect(writeArgs.additionalData.formData).toEqual({ existing: true, onsiteAuditId: 'audit-1' });
  });
});
