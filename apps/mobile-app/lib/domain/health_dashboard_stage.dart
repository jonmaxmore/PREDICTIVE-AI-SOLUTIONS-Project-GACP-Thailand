import 'fee_service_catalogue.dart';

/// Mobile projection of the backend 10-stage health dashboard model.
///
/// `dashboardStage` on GET /applications/my rows is produced by
/// `apps/backend/shared/health-dashboard-stage.js` and is ALWAYS one of:
///   DRAFT, PENDING_FEE_PHASE1, UNDER_DOCUMENT_REVIEW, REVISION_REQUIRED,
///   PENDING_FEE_PHASE2, PENDING_AUDIT_SCHEDULE, UNDER_FIELD_AUDIT, APPROVED,
///   CERTIFIED, CLOSED
///
/// CLOSED is terminal — REJECTED / EXPIRED / CANCEL_EXPIRED. Those three
/// matched no classification set on the server and fell through to its
/// UNDER_DOCUMENT_REVIEW fallback, so a rejected applicant was shown a
/// document-review timeline that would never advance.
///
/// PENDING_AUDIT_SCHEDULE is the gap between "งวดที่ 2 is paid" and "someone
/// booked a date". AUDIT_FEE_PAID used to be lumped in with the audit states,
/// so this app said the field audit was in progress from the moment the money
/// landed — before an auditor or a date existed. The dispatcher is who moves it
/// on (AUDIT_FEE_PAID → AUDIT_CONFIRMED).
///
/// The slip flow it used to mirror is gone: payment is Stripe-only, settled by
/// webhook, and nobody reviews a payment (operator 2026-09-11).
///
/// This helper maps that stage onto the tracking timeline (8 linear steps)
/// and the dashboard stepper (7 steps), plus the payment-routing rules for
/// payable workflow STATUSES (raw 20-state machine values, not stages).
class HealthStageProgress {
  HealthStageProgress._();

  /// Linear tracking timeline. REVISION_REQUIRED shares the document-review
  /// step (it is a loop within that stage, not a forward step).
  static const List<({String title, String description})> trackingSteps = [
    (title: 'ยื่นคำขอ', description: 'จัดทำและยื่นคำขอรับรองมาตรฐาน GACP'),
    (
      title: 'ชำระ${FeeServiceCatalogue.phase1Name}',
      description: 'ตรวจความครบถ้วนและความถูกต้องของเอกสารคำขอ'
    ),
    (
      title: 'ตรวจสอบเอกสาร',
      description: 'เจ้าหน้าที่ตรวจสอบเอกสารประกอบคำขอ'
    ),
    (
      title: 'ชำระ${FeeServiceCatalogue.phase2Name}',
      description: 'ตรวจประเมินแปลง ณ สถานที่จริง และออกใบรับรอง'
    ),
    (
      title: 'รอนัดวันตรวจแปลง',
      description: 'เจ้าหน้าที่กำลังนัดวันและมอบหมายผู้ตรวจประเมิน'
    ),
    (
      title: 'ตรวจประเมินแปลง',
      description: 'ผู้ตรวจประเมินเข้าตรวจสถานที่ปลูก/เก็บเกี่ยว'
    ),
    (title: 'อนุมัติผล', description: 'ผลการตรวจประเมินผ่านการอนุมัติ'),
    (title: 'ออกใบรับรอง', description: 'ได้รับใบรับรองมาตรฐาน GACP'),
  ];

  /// Thai labels — mirrors backend STAGE_LABEL_TH.
  static const Map<String, String> _labelTh = {
    'DRAFT': 'ร่างคำขอ',
    'PENDING_FEE_PHASE1': 'รอชำระ${FeeServiceCatalogue.phase1Name}',
    'UNDER_DOCUMENT_REVIEW': 'อยู่ระหว่างตรวจเอกสาร',
    'REVISION_REQUIRED': 'แก้ไขเอกสารตามข้อเสนอแนะ',
    'PENDING_FEE_PHASE2': 'รอชำระค่าบริการก่อนตรวจประเมินแปลง',
    'PENDING_AUDIT_SCHEDULE': 'รอนัดวันตรวจประเมินแปลง',
    'UNDER_FIELD_AUDIT': 'อยู่ระหว่างตรวจประเมินแปลง',
    'APPROVED': 'ผ่านการอนุมัติ',
    'CERTIFIED': 'ได้รับใบรับรอง GACP',
    'CLOSED': 'คำขอปิดแล้ว',
  };

  static const Map<String, int> _trackingIndex = {
    'DRAFT': 0,
    'PENDING_FEE_PHASE1': 1,
    'UNDER_DOCUMENT_REVIEW': 2,
    'REVISION_REQUIRED': 2,
    'PENDING_FEE_PHASE2': 3,
    'PENDING_AUDIT_SCHEDULE': 4,
    'UNDER_FIELD_AUDIT': 5,
    'APPROVED': 6,
    'CERTIFIED': 7,
    // Terminal: off the timeline entirely. -1 is the "no step" signal —
    // collapsing it to 0 would render a closed file as a fresh draft.
    'CLOSED': -1,
  };

  static const Map<String, int> _dashboardStep = {
    'DRAFT': 1,
    'PENDING_FEE_PHASE1': 2,
    'UNDER_DOCUMENT_REVIEW': 3,
    'REVISION_REQUIRED': 3,
    'PENDING_FEE_PHASE2': 4,
    'PENDING_AUDIT_SCHEDULE': 5,
    'UNDER_FIELD_AUDIT': 6,
    'APPROVED': 7,
    'CERTIFIED': 7,
    'CLOSED': -1,
  };

  static String _norm(String? v) => (v ?? '').trim().toUpperCase();

  /// 0-based index into [trackingSteps]. Empty stage (row didn't come from
  /// /applications/my) → 0; unknown non-empty value → document-review
  /// fallback, mirroring the backend's own fallback.
  static int stepIndexForStage(String? dashboardStage) {
    final s = _norm(dashboardStage);
    if (s.isEmpty) return 0;
    return _trackingIndex[s] ?? 2;
  }

  // ── A renewal's own timeline (round 5, mirrors web stepperStepsFor) ──
  // A renewal pays ONE charge — the renewal service — and skips document
  // review, so it has no instalment-1 step and no review step, and its payment
  // step is named by the RENEWAL catalogue entry (never "งวดที่ 2").
  static const List<({String title, String description})> _renewalSteps = [
    (title: 'ยื่นคำขอต่ออายุ', description: 'ยื่นคำขอต่ออายุใบรับรองมาตรฐาน GACP'),
    (
      title: 'ชำระ${FeeServiceCatalogue.renewalName}',
      description: FeeServiceCatalogue.renewalCoverage
    ),
    (
      title: 'รอนัดวันตรวจแปลง',
      description: 'เจ้าหน้าที่กำลังนัดวันและมอบหมายผู้ตรวจประเมิน'
    ),
    (
      title: 'ตรวจประเมินแปลง',
      description: 'ผู้ตรวจประเมินเข้าตรวจสถานที่ปลูก/เก็บเกี่ยว'
    ),
    (title: 'อนุมัติผล', description: 'ผลการตรวจประเมินผ่านการอนุมัติ'),
    (title: 'ออกใบรับรอง', description: 'ได้รับใบรับรองฉบับใหม่'),
  ];

  static const Map<String, int> _renewalIndex = {
    'DRAFT': 0,
    'PENDING_FEE_PHASE2': 1,
    'PENDING_AUDIT_SCHEDULE': 2,
    'UNDER_FIELD_AUDIT': 3,
    'APPROVED': 4,
    'CERTIFIED': 5,
    'CLOSED': -1,
  };

  /// The timeline for one application: a renewal's own, else [trackingSteps].
  static List<({String title, String description})> trackingStepsFor(
          {required bool isRenewal}) =>
      isRenewal ? _renewalSteps : trackingSteps;

  /// [stepIndexForStage] on the application's own timeline.
  static int stepIndexFor(String? dashboardStage, {required bool isRenewal}) {
    if (!isRenewal) return stepIndexForStage(dashboardStage);
    final s = _norm(dashboardStage);
    if (s.isEmpty) return 0;
    return _renewalIndex[s] ?? 1;
  }

  /// CERTIFIED = every timeline step completed.
  static bool isComplete(String? dashboardStage) =>
      _norm(dashboardStage) == 'CERTIFIED';

  /// The file is finished and has no next step. Callers must branch on this
  /// rather than on `stepIndexForStage(...) == 0`, which DRAFT also satisfies.
  static bool isClosed(String? dashboardStage) =>
      _norm(dashboardStage) == 'CLOSED';

  static String thaiLabel(String? dashboardStage) {
    final s = _norm(dashboardStage);
    return _labelTh[s] ?? s;
  }

  /// [thaiLabel] with the application at hand: a renewal's payment stage names
  /// the renewal service; without the answer the neutral map is used.
  static String thaiLabelFor(String? dashboardStage, {required bool isRenewal}) {
    if (isRenewal && _norm(dashboardStage) == 'PENDING_FEE_PHASE2') {
      return 'รอชำระ${FeeServiceCatalogue.renewalName}';
    }
    return thaiLabel(dashboardStage);
  }

  /// 1-based step for the dashboard 7-step stepper
  /// (ยื่นคำขอ → งวด 1 → ตรวจเอกสาร → งวด 2 → รอนัด → ตรวจแปลง → รับรอง).
  static int dashboardStepForStage(String? dashboardStage) {
    final s = _norm(dashboardStage);
    if (s.isEmpty) return 1;
    return _dashboardStep[s] ?? 3;
  }

  // ── Payment routing (raw workflow STATUS) ──
  // Payable ONLY in the two pending-fee states. The slip statuses that used to
  // be here were payable too, because a rejected slip was re-uploaded on the
  // same screen; with Stripe settling by webhook there is no rejected slip and
  // no second door.

  static const Set<String> _payable = {
    'PENDING_DOC_FEE',
    'PENDING_AUDIT_FEE',
  };

  static const Set<String> _phase2 = {
    'PENDING_AUDIT_FEE',
  };

  static bool isPayable(String status) => _payable.contains(_norm(status));

  static bool isPhase2(String status) => _phase2.contains(_norm(status));

  static String payRoute(String appId, String status) =>
      isPhase2(status) ? '/applications/$appId/pay2' : '/applications/$appId/pay1';
}
