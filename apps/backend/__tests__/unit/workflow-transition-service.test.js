const workflowTransitionService = require('../../services/workflow-transition-service');

describe('workflow-transition-service', () => {
  it('normalizes canonical states regardless of case', () => {
    expect(workflowTransitionService.normalizeWorkflowStateInput('certified'))
      .toBe('CERTIFIED');
    expect(workflowTransitionService.normalizeWorkflowStateInput('Assigned_For_Review'))
      .toBe('ASSIGNED_FOR_REVIEW');
    expect(workflowTransitionService.normalizeWorkflowStateInput('unknown_state'))
      .toBeNull();
  });

  it('rejects the ERP and legacy aliases it used to resolve (PR 2c)', () => {
    // STATE_INPUT_ALIASES and STATE_BY_LEGACY_STATUS resolved these until the
    // purge. They exist in no writer and in no row, so accepting them could
    // only mask a defect.
    for (const alias of ['pending_document_review', 'inspection_in_progress', 'registered', 'REGISTERED']) {
      expect(workflowTransitionService.normalizeWorkflowStateInput(alias)).toBeNull();
    }
  });

  it('an unresolvable formData.workflowState falls back to the status column', () => {
    const resolved = workflowTransitionService.resolveStateFromApplication({
      status: 'SUBMITTED',
      formData: { workflowState: 'pending_document_review' },
    });
    expect(resolved).toBe('SUBMITTED');
  });

  it('allows scheduler to transition doc_fee_paid -> assigned_for_review', () => {
    const transition = workflowTransitionService.buildTransitionUpdate({
      application: {
        status: 'DOC_FEE_PAID',
        formData: {},
        workflowHistory: [],
      },
      toState: 'assigned_for_review',
      actorId: 'provider-1',
      actorRole: 'dispatcher',
    });

    expect(transition.previousState).toBe('DOC_FEE_PAID');
    expect(transition.nextState).toBe('ASSIGNED_FOR_REVIEW');
    expect(transition.updateData.formData.workflowState).toBe('ASSIGNED_FOR_REVIEW');
  });

  it('blocks unauthorized role transition', () => {
    expect(() => workflowTransitionService.buildTransitionUpdate({
      application: {
        status: 'DOC_FEE_PAID',
        formData: {},
        workflowHistory: [],
      },
      toState: 'ASSIGNED_FOR_REVIEW',
      actorId: 'provider-2',
      actorRole: 'finance_officer_platform',
    })).toThrow(/cannot transition|invalid transition/i);
  });

  describe('canRoleTransition (direct)', () => {
    it('returns true for documented role-owned transitions', () => {
      expect(workflowTransitionService.canRoleTransition(
        'dispatcher', 'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW',
      )).toBe(true);
      expect(workflowTransitionService.canRoleTransition(
        'document_reviewer', 'ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED',
      )).toBe(true);
      expect(workflowTransitionService.canRoleTransition(
        'field_inspector', 'AUDIT_CONFIRMED', 'AUDIT_PASSED',
      )).toBe(true);
    });

    it('returns false when role lacks the specific transition', () => {
      // account never owns workflow transitions; document_reviewer can't approve
      // a final certificate (that's auditor + admin territory).
      expect(workflowTransitionService.canRoleTransition(
        'finance_officer_platform', 'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW',
      )).toBe(false);
      expect(workflowTransitionService.canRoleTransition(
        'document_reviewer', 'AUDIT_PASSED', 'APPROVED',
      )).toBe(false);
    });

    it('legacy alias roles resolve through normalizeRole before lookup', () => {
      // head_auditor → auditor.
      expect(workflowTransitionService.canRoleTransition(
        'field_inspector', 'AUDIT_CONFIRMED', 'AUDIT_PASSED',
      )).toBe(true);
      // 'inspector' is also documented to alias auditor.
      expect(workflowTransitionService.canRoleTransition(
        'FIELD_INSPECTOR', 'CAR_REVIEWING', 'AUDIT_PASSED',
      )).toBe(true);
      // คำเก่าถูกปฏิเสธ ไม่ใช่แปลให้
      expect(workflowTransitionService.canRoleTransition(
        'inspector', 'CAR_REVIEWING', 'AUDIT_PASSED',
      )).toBe(false);
    });

    it('admin has no ROLE_TRANSITIONS entry — uses force=true override instead', () => {
      // Admin bypasses canRoleTransition via the force flag in
      // buildTransitionUpdate. Direct canRoleTransition therefore
      // returns false for admin even on canonical transitions.
      expect(workflowTransitionService.canRoleTransition(
        'system_admin_dtam', 'DRAFT', 'SUBMITTED',
      )).toBe(false);
      expect(workflowTransitionService.canRoleTransition(
        'system_admin_dtam', 'AUDIT_PASSED', 'APPROVED',
      )).toBe(false);
    });

    it('returns false for unknown / falsy roles (never throws)', () => {
      expect(workflowTransitionService.canRoleTransition(
        null, 'DRAFT', 'SUBMITTED',
      )).toBe(false);
      expect(workflowTransitionService.canRoleTransition(
        '', 'DRAFT', 'SUBMITTED',
      )).toBe(false);
      expect(workflowTransitionService.canRoleTransition(
        'garbage', 'DRAFT', 'SUBMITTED',
      )).toBe(false);
    });
  });

  describe('resolveRawStatusesForStates', () => {
    it('returns exactly the canonical state (PR 2c — no legacy fan-out)', () => {
      // This used to also return REGISTERED and every other legacy key whose
      // value was SUBMITTED, so a list-by-state query matched spellings no row
      // held. The column is canonical-only now, so a state matches itself.
      const raw = workflowTransitionService.resolveRawStatusesForStates(['SUBMITTED']);
      expect(raw).toEqual(['SUBMITTED']);
    });

    it('accepts a single value (not just an array)', () => {
      const raw = workflowTransitionService.resolveRawStatusesForStates('CERTIFIED');
      expect(Array.isArray(raw)).toBe(true);
      expect(raw).toContain('CERTIFIED');
    });

    it('returns the union when given multiple canonical states', () => {
      const raw = workflowTransitionService.resolveRawStatusesForStates([
        'PENDING_DOC_FEE',
        'DOC_FEE_PAID',
      ]);
      expect(raw).toContain('PENDING_DOC_FEE');
      expect(raw).toContain('DOC_FEE_PAID');
    });

    it('drops unknown / falsy inputs and returns the rest', () => {
      const raw = workflowTransitionService.resolveRawStatusesForStates([
        'CERTIFIED',
        'not_a_state',
        '',
        null,
      ]);
      expect(raw).toContain('CERTIFIED');
      // No surprising entries from the noise inputs.
      expect(raw.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
    });

    it('returns [] when no canonical states resolve', () => {
      expect(workflowTransitionService.resolveRawStatusesForStates([])).toEqual([]);
      expect(workflowTransitionService.resolveRawStatusesForStates(['garbage'])).toEqual([]);
    });
  });

  describe('resolveStateFromApplication (fallback chain)', () => {
    it('reads formData.workflowState first when present', () => {
      // formData wins over status — supports the case where the workflow
      // engine has advanced past the legacy-status mirror.
      expect(workflowTransitionService.resolveStateFromApplication({
        status: 'SUBMITTED',
        formData: { workflowState: 'AUDIT_CONFIRMED' },
      })).toBe('AUDIT_CONFIRMED');
    });

    it('falls back to the status column when formData.workflowState is absent', () => {
      expect(workflowTransitionService.resolveStateFromApplication({
        status: 'ASSIGNED_FOR_REVIEW',
        formData: {},
      })).toBe('ASSIGNED_FOR_REVIEW');
    });

    it('a legacy status in the column no longer resolves (PR 2c) — falls to DRAFT', () => {
      // Pre-purge this returned SUBMITTED via the alias table. DRAFT is the
      // documented fallback for an unresolvable state; no writer can produce
      // REGISTERED any more, so reaching this branch means corrupt data.
      expect(workflowTransitionService.resolveStateFromApplication({
        status: 'REGISTERED',
        formData: {},
      })).toBe('DRAFT');
    });

    it('returns DRAFT when neither formData.workflowState nor status resolves', () => {
      expect(workflowTransitionService.resolveStateFromApplication({})).toBe('DRAFT');
      expect(workflowTransitionService.resolveStateFromApplication({
        status: 'unknown_garbage_state',
        formData: {},
      })).toBe('DRAFT');
      expect(workflowTransitionService.resolveStateFromApplication(null)).toBe('DRAFT');
    });
  });

  // ── Two-person certification decision, ISO/IEC 17065 §7.6 (restored 2026-09-10) ──
  //
  // This block used to assert the OPPOSITE — "ALLOWS the evaluating auditor to approve
  // their own audit (two-person rule removed)" — pinning the 2026-06-05 product decision
  // that let one on-site auditor record the pass, approve it and issue the certificate.
  //
  // operator reversed that on 2026-09-10, unprompted: "ตอนแรกคนลงพื้นที่ออกได้เอง แต่ผมคิดว่า
  // ไม่น่าถูกต้อง มันควรมีดีกว่านี้" (ledger F-CERT-SOD). §7.6 is the clause a certification
  // body is itself audited against: the certification decision must not be made by anyone
  // who carried out the evaluation. A platform that issues GACP certificates to others
  // while exempting itself from that clause fails on the first external review.
  //
  // The tests are INVERTED here, not weakened: every case that used to assert "allowed"
  // now asserts the refusal by name.
  describe('certification — AUDIT_PASSED → APPROVED requires a second person (ISO/IEC 17065 §7.6)', () => {
    const auditedApp = (overrides = {}) => ({
      status: 'AUDIT_PASSED',
      formData: { workflowState: 'AUDIT_PASSED' },
      workflowHistory: [
        { toState: 'AUDIT_PASSED', actorId: 'auditor-1', actorRole: 'field_inspector' },
      ],
      auditorId: 'auditor-1',
      ...overrides,
    });

    // ด่านมีสองชั้น และเรียงกัน — เทสแยกทีละชั้น ไม่งั้นชั้นหนึ่งพังแล้วอีกชั้นปิดให้
    //   ชั้นที่ 1 (canRoleTransition): ต้องเป็นบทบาทที่มีอำนาจตัดสิน
    //   ชั้นที่ 2 (certification-decision-separation): และต้องไม่ใช่ผู้ประเมินคนนั้น

    it('ชั้นที่ 1 — ผู้ตรวจประเมินแปลง อนุมัติไม่ได้เลย แม้จะเป็นคนละคนกับผู้ประเมิน', () => {
      // ก่อน F-CERT-SOD เคสนี้ผ่าน: ผู้ตรวจคนไหนก็อนุมัติได้ ขอแค่ไม่ใช่คนที่ประเมิน
      expect(() => workflowTransitionService.buildTransitionUpdate({
        application: auditedApp(),
        toState: 'APPROVED',
        actorId: 'auditor-2',
        actorRole: 'field_inspector',
      })).toThrow(/cannot transition AUDIT_PASSED -> APPROVED/);
    });

    it('ชั้นที่ 2 — ผู้อนุมัติที่บังเอิญเป็นผู้ประเมินคำขอนี้เอง ก็ยังถูกปฏิเสธ', () => {
      // เคสที่ทำให้ชั้นที่ 1 อย่างเดียวไม่พอ: คนคนเดียวถือสองบทบาทพร้อมกัน
      expect(() => workflowTransitionService.buildTransitionUpdate({
        application: auditedApp(),
        toState: 'APPROVED',
        actorId: 'auditor-1', // the same person who performed the audit
        actorRole: 'certificate_approver',
      })).toThrow(/EVALUATOR_CANNOT_DECIDE/);
    });

    it('ผู้อนุมัติที่ไม่ได้ประเมินคำขอนี้ ตัดสินได้', () => {
      const transition = workflowTransitionService.buildTransitionUpdate({
        application: auditedApp(),
        toState: 'APPROVED',
        actorId: 'approver-1',
        actorRole: 'certificate_approver',
      });
      expect(transition.nextState).toBe('APPROVED');
    });

    it('records WHO decided, so the second person is a fact and not a convention', () => {
      const transition = workflowTransitionService.buildTransitionUpdate({
        application: auditedApp(),
        toState: 'APPROVED',
        actorId: 'approver-1',
        actorRole: 'certificate_approver',
      });
      expect(transition.updateData.headAuditorId).toBe('approver-1');
    });

    it('keeps the rule out of this module — it is shared with the writer', () => {
      // The check lives in services/certification-decision-separation.js so the route
      // path (buildTransitionUpdate) and the writer path cannot drift on what
      // "different person" means. This module still exposes no evaluator helper of
      // its own.
      expect(workflowTransitionService.resolveAuditEvaluatorIds).toBeUndefined();
    });
  });

});

