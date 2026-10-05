// Unit tests for the mobile projection of the backend 8-stage health
// dashboard model (apps/backend/shared/health-dashboard-stage.js).
// The REAL `dashboardStage` values returned by GET /applications/my are the
// backend's ten (shared/health-dashboard-stage.js HEALTH_DASHBOARD_STAGES):
//   DRAFT, PENDING_FEE_PHASE1, UNDER_DOCUMENT_REVIEW, REVISION_REQUIRED,
//   PENDING_FEE_PHASE2, PENDING_AUDIT_SCHEDULE, UNDER_FIELD_AUDIT, APPROVED,
//   CERTIFIED, CLOSED
// fix/fee-line-descriptions round 4: this file still pinned the 8-stage model
// and the retired slip-review statuses; the code had already moved on
// (PENDING_AUDIT_SCHEDULE added, slip retired 2026-09-11), so the TEST was wrong.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/domain/health_dashboard_stage.dart';

void main() {
  group('HealthStageProgress.stepIndexForStage (8-step tracking timeline)', () {
    test('maps each backend stage to its timeline step', () {
      expect(HealthStageProgress.stepIndexForStage('DRAFT'), 0);
      expect(HealthStageProgress.stepIndexForStage('PENDING_FEE_PHASE1'), 1);
      expect(HealthStageProgress.stepIndexForStage('UNDER_DOCUMENT_REVIEW'), 2);
      expect(HealthStageProgress.stepIndexForStage('REVISION_REQUIRED'), 2);
      expect(HealthStageProgress.stepIndexForStage('PENDING_FEE_PHASE2'), 3);
      expect(
          HealthStageProgress.stepIndexForStage('PENDING_AUDIT_SCHEDULE'), 4);
      expect(HealthStageProgress.stepIndexForStage('UNDER_FIELD_AUDIT'), 5);
      expect(HealthStageProgress.stepIndexForStage('APPROVED'), 6);
      expect(HealthStageProgress.stepIndexForStage('CERTIFIED'), 7);
      expect(HealthStageProgress.stepIndexForStage('CLOSED'), -1,
          reason: 'a closed file is off the timeline, not a fresh draft');
    });

    test('empty/null stage (row not from /my) → DRAFT step 0', () {
      expect(HealthStageProgress.stepIndexForStage(''), 0);
      expect(HealthStageProgress.stepIndexForStage(null), 0);
    });

    test('unknown non-empty stage → document-review fallback (mirrors backend)',
        () {
      expect(HealthStageProgress.stepIndexForStage('SOMETHING_NEW'), 2);
    });

    test('is case-insensitive', () {
      expect(HealthStageProgress.stepIndexForStage('certified'), 7);
    });
  });

  group('HealthStageProgress.isComplete', () {
    test('only CERTIFIED is complete', () {
      expect(HealthStageProgress.isComplete('CERTIFIED'), isTrue);
      expect(HealthStageProgress.isComplete('APPROVED'), isFalse);
      expect(HealthStageProgress.isComplete('DRAFT'), isFalse);
      expect(HealthStageProgress.isComplete(null), isFalse);
    });
  });

  group('HealthStageProgress.thaiLabel', () {
    test('mirrors backend STAGE_LABEL_TH', () {
      expect(HealthStageProgress.thaiLabel('DRAFT'), 'ร่างคำขอ');
      expect(HealthStageProgress.thaiLabel('PENDING_FEE_PHASE1'),
          'รอชำระงวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
      expect(HealthStageProgress.thaiLabel('UNDER_DOCUMENT_REVIEW'),
          'อยู่ระหว่างตรวจเอกสาร');
      expect(HealthStageProgress.thaiLabel('REVISION_REQUIRED'),
          'แก้ไขเอกสารตามข้อเสนอแนะ');
      expect(HealthStageProgress.thaiLabel('PENDING_FEE_PHASE2'),
          'รอชำระค่าบริการก่อนตรวจประเมินแปลง');
      expect(HealthStageProgress.thaiLabel('UNDER_FIELD_AUDIT'),
          'อยู่ระหว่างตรวจประเมินแปลง');
      expect(HealthStageProgress.thaiLabel('APPROVED'), 'ผ่านการอนุมัติ');
      expect(
          HealthStageProgress.thaiLabel('CERTIFIED'), 'ได้รับใบรับรอง GACP');
    });

    test('unknown stage falls back to the raw value', () {
      expect(HealthStageProgress.thaiLabel('WEIRD'), 'WEIRD');
      expect(HealthStageProgress.thaiLabel(null), '');
    });
  });

  group('HealthStageProgress payment routing (workflow status, not stage)',
      () {
    test('payable statuses: only the two pending-fee states (slip review retired)', () {
      expect(HealthStageProgress.isPayable('PENDING_DOC_FEE'), isTrue);
      expect(HealthStageProgress.isPayable('PENDING_AUDIT_FEE'), isTrue);
      // Payment is Stripe-only, settled by webhook; no slip is reviewed, so the
      // old slip-review statuses are not a door to the payment screen.
      expect(
          HealthStageProgress.isPayable('PHASE_1_SLIP_UNDER_REVIEW'), isFalse);
      expect(
          HealthStageProgress.isPayable('PHASE_2_SLIP_UNDER_REVIEW'), isFalse);
      expect(HealthStageProgress.isPayable('pending_doc_fee'), isTrue,
          reason: 'case-insensitive');
    });

    test('non-payable statuses', () {
      expect(HealthStageProgress.isPayable('DRAFT'), isFalse);
      expect(HealthStageProgress.isPayable('DOC_FEE_PAID'), isFalse);
      expect(HealthStageProgress.isPayable('CERTIFIED'), isFalse);
      expect(HealthStageProgress.isPayable(''), isFalse);
    });

    test('PENDING_AUDIT_FEE routes to pay2 (a renewal pays there too), PENDING_DOC_FEE to pay1', () {
      expect(HealthStageProgress.payRoute('abc', 'PENDING_AUDIT_FEE'),
          '/applications/abc/pay2');
      expect(HealthStageProgress.payRoute('abc', 'pending_audit_fee'),
          '/applications/abc/pay2');
      expect(HealthStageProgress.payRoute('abc', 'PENDING_DOC_FEE'),
          '/applications/abc/pay1');
    });
  });

  group('HealthStageProgress.dashboardStepForStage (7-step dashboard stepper)',
      () {
    test('maps stage → 1-based dashboard step', () {
      expect(HealthStageProgress.dashboardStepForStage('DRAFT'), 1);
      expect(
          HealthStageProgress.dashboardStepForStage('PENDING_FEE_PHASE1'), 2);
      expect(HealthStageProgress.dashboardStepForStage('UNDER_DOCUMENT_REVIEW'),
          3);
      expect(
          HealthStageProgress.dashboardStepForStage('REVISION_REQUIRED'), 3);
      expect(
          HealthStageProgress.dashboardStepForStage('PENDING_FEE_PHASE2'), 4);
      expect(HealthStageProgress.dashboardStepForStage('PENDING_AUDIT_SCHEDULE'),
          5);
      expect(
          HealthStageProgress.dashboardStepForStage('UNDER_FIELD_AUDIT'), 6);
      expect(HealthStageProgress.dashboardStepForStage('APPROVED'), 7);
      expect(HealthStageProgress.dashboardStepForStage('CERTIFIED'), 7);
      expect(HealthStageProgress.dashboardStepForStage('CLOSED'), -1);
    });
  });

  test('tracking timeline has exactly 8 steps', () {
    expect(HealthStageProgress.trackingSteps.length, 8);
  });

  test('no step names a split fee (one service fee)', () {
    for (final step in HealthStageProgress.trackingSteps) {
      expect('${step.title} ${step.description}', isNot(contains('แพลตฟอร์ม')));
      expect('${step.title} ${step.description}', isNot(contains('รัฐ +')));
    }
  });
}
