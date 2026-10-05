import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/domain/fee_service_catalogue.dart';
import 'package:mobile_app/domain/health_dashboard_stage.dart';

/// fix/fee-line-descriptions round 5 (review): a renewal pays ONE charge, the renewal
/// service, and skips document review. Its timeline mirrors the web stepperStepsFor:
/// no "ชำระงวดที่ 1" step, no document-review step, and the payment step is named by
/// the RENEWAL catalogue entry — never "งวดที่ 2".
void main() {
  group('trackingStepsFor(isRenewal: true)', () {
    final steps = HealthStageProgress.trackingStepsFor(isRenewal: true);

    test('exactly one payment step, named as the renewal service', () {
      final pay = steps.where((s) => s.title.startsWith('ชำระ')).toList();
      expect(pay, hasLength(1));
      expect(pay.single.title, 'ชำระ${FeeServiceCatalogue.renewalName}');
      expect(pay.single.description, FeeServiceCatalogue.renewalCoverage);
    });

    test('no instalment and no document review', () {
      for (final s in steps) {
        expect(s.title, isNot(contains('งวดที่')));
        expect(s.title, isNot(contains('ตรวจสอบเอกสาร')));
      }
    });

    test('the renewal stage index points at its payment step', () {
      final i = HealthStageProgress.stepIndexFor('PENDING_FEE_PHASE2', isRenewal: true);
      expect(steps[i].title, 'ชำระ${FeeServiceCatalogue.renewalName}');
      expect(HealthStageProgress.stepIndexFor('CERTIFIED', isRenewal: true), steps.length - 1);
      expect(HealthStageProgress.stepIndexFor('CLOSED', isRenewal: true), -1);
    });
  });

  test('a new filing keeps its two instalments, named from the catalogue', () {
    final steps = HealthStageProgress.trackingStepsFor(isRenewal: false);
    expect(steps, same(HealthStageProgress.trackingSteps));
    expect(steps[1].title, 'ชำระ${FeeServiceCatalogue.phase1Name}');
    expect(steps[3].title, 'ชำระ${FeeServiceCatalogue.phase2Name}');
    expect(HealthStageProgress.stepIndexFor('PENDING_FEE_PHASE2', isRenewal: false), 3);
  });
}
