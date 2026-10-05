/**
 * AUDITOR re-review (2026-06-24) — AUDIT-009: per-audit ownership on the on-site
 * mutation paths. _ensureAuditorMatches was previously called ONLY in startInspection,
 * so submitChecklistItem / uploadPhoto / submitDecision let AUDITOR_A write checklist
 * items, photos, or a decision to AUDITOR_B's audit (same tenant). These lock in that
 * each mutation rejects an actor who is not the assigned auditor (AUDIT_AUDITOR_MISMATCH),
 * and still succeeds for the assigned auditor.
 *
 * cert-integrity fix (Phase A, 2026-08-16): the photo/checklist gate is now scoped to
 * decision === PASS and FAIL-CLOSED (throws EVIDENCE_CAPTURE_UNAVAILABLE when prisma
 * omits farmAuditPhoto/farmAuditChecklistItem `.count`, instead of silently skipping).
 * submitDecision's `prismaFor()` below provides sufficient evidence counts so the
 * ownership gate under test here — not the evidence gate — decides the outcome; the
 * ownership check runs BEFORE the evidence gate, so the mismatch case is unaffected
 * either way.
 */

'use strict';

jest.mock('../../services/application-status-writer', () => ({
  writeApplicationStatus: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../services/car-deadline-service', () => ({
  computeCarDueDate: jest.fn(() => new Date('2026-07-01T00:00:00.000Z')),
  seedCarRevisionDeadline: jest.fn(async () => ({})),
}));
jest.mock('../../middleware/audit-logger', () => ({
  statusTransitionAuditHook: () => (async () => {}),
}));
jest.mock('../../shared/logger', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return Object.assign(l, { createLogger: () => l, default: l });
});

const onsite = require('../../services/audit-onsite-service');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');

const ASSIGNED = 'auditor-A';
const OTHER = 'auditor-B';

function auditRow() {
  return {
    id: 'audit-1',
    status: 'IN_PROGRESS',
    auditorId: ASSIGNED,
    application: { id: 'app-1', status: 'AUDIT_CONFIRMED', applicationNumber: 'GACP-1', healthId: 'h1', formData: {} },
  };
}

describe('audit-onsite-service — per-audit ownership (AUDIT-009)', () => {
  describe('submitDecision', () => {
    function prismaFor() {
      return {
        auditChecklist: { findFirst: jest.fn(async () => auditRow()) },
        // PASS is fail-closed on unprovisioned evidence models (cert-integrity fix);
        // supply sufficient counts so this describe block tests ownership, not evidence.
        farmAuditPhoto: farmAuditPhotoStub(5),
        farmAuditChecklistItem: { count: jest.fn(async () => onsite.CHECKLIST_TEMPLATE_2026.length) },
        $transaction: jest.fn(async (cb) => cb({ auditChecklist: { update: jest.fn(async () => ({})) } })),
      };
    }
    it('rejects an actor who is NOT the assigned auditor (AUDIT_AUDITOR_MISMATCH)', async () => {
      await expect(onsite.submitDecision({
        auditId: 'audit-1', decision: 'PASS', actorId: OTHER, prisma: prismaFor(), fanoutService: { send: jest.fn() },
      })).rejects.toMatchObject({ code: 'AUDIT_AUDITOR_MISMATCH' });
    });
    it('allows the assigned auditor', async () => {
      await expect(onsite.submitDecision({
        auditId: 'audit-1', decision: 'PASS', actorId: ASSIGNED, prisma: prismaFor(), fanoutService: { send: jest.fn(async () => ({ ok: true })) },
      })).resolves.toBeDefined();
    });
  });

  describe('submitChecklistItem', () => {
    function prismaFor() {
      return {
        auditChecklist: { findFirst: jest.fn(async () => auditRow()) },
        $transaction: jest.fn(async (cb) => cb({
          farmAuditChecklistItem: { upsert: jest.fn(async () => ({ id: 'ci-1' })) },
          farmAuditPhoto: { updateMany: jest.fn(async () => ({})) },
        })),
      };
    }
    it('rejects an actor who is NOT the assigned auditor', async () => {
      await expect(onsite.submitChecklistItem({
        auditId: 'audit-1', itemCode: '1.1', response: 'PASS', actorId: OTHER, prisma: prismaFor(),
      })).rejects.toMatchObject({ code: 'AUDIT_AUDITOR_MISMATCH' });
    });
    it('allows the assigned auditor', async () => {
      await expect(onsite.submitChecklistItem({
        auditId: 'audit-1', itemCode: '1.1', response: 'PASS', actorId: ASSIGNED, prisma: prismaFor(),
      })).resolves.toBeDefined();
    });
  });

  describe('uploadPhoto', () => {
    it('rejects an uploader who is NOT the assigned auditor, BEFORE writing the file', async () => {
      const attachmentService = { attach: jest.fn(async () => ({ id: 'att-1' })) };
      const prisma = {
        auditChecklist: { findFirst: jest.fn(async () => auditRow()) },
        farmAuditPhoto: { create: jest.fn(async () => ({ id: 'p1' })) },
      };
      await expect(onsite.uploadPhoto({
        auditId: 'audit-1', fileBuffer: Buffer.from('x'), fileName: 'p.jpg', gpsLat: 13, gpsLng: 100,
        uploadedBy: OTHER, organizationId: 'org-1', prisma, attachmentService,
      })).rejects.toMatchObject({ code: 'AUDIT_AUDITOR_MISMATCH' });
      expect(attachmentService.attach).not.toHaveBeenCalled();
      expect(prisma.farmAuditPhoto.create).not.toHaveBeenCalled();
    });
    it('allows the assigned auditor', async () => {
      const attachmentService = { attach: jest.fn(async () => ({ id: 'att-1' })) };
      const prisma = {
        auditChecklist: { findFirst: jest.fn(async () => auditRow()) },
        farmAuditPhoto: { create: jest.fn(async () => ({ id: 'p1' })) },
      };
      await expect(onsite.uploadPhoto({
        auditId: 'audit-1', fileBuffer: Buffer.from('x'), fileName: 'p.jpg', gpsLat: 13, gpsLng: 100,
        uploadedBy: ASSIGNED, organizationId: 'org-1', prisma, attachmentService,
      })).resolves.toBeDefined();
      expect(attachmentService.attach).toHaveBeenCalledTimes(1);
    });
  });
});
