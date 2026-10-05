import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/domain/certification_purposes.dart';

/// The mobile copy of the purpose vocabulary. It is pinned equal to the backend file by
/// apps/backend/__tests__/unit/certification-purposes-vocabulary.test.js; this test pins
/// what the app does with it.
void main() {
  test('exactly the three words a ภ.ท. licence backs, in licence order', () {
    expect(CertificationPurposes.codes, ['RESEARCH', 'EXPORT', 'PROCESSING']);
  });

  test('each option label carries its licence code', () {
    final labels = [for (final p in CertificationPurposes.all) p.optionLabel];
    expect(labels, [
      'ศึกษาวิจัย (ภ.ท. 09)',
      'ส่งออกเพื่อการค้า (ภ.ท. 10)',
      'แปรรูปหรือจำหน่ายเพื่อการค้า (ภ.ท. 11)',
    ]);
  });

  test('neither the medical purpose nor the commercial default exists', () {
    expect(CertificationPurposes.codes, isNot(contains('MEDICAL')));
    expect(CertificationPurposes.codes, isNot(contains('COMMERCIAL')));
  });
}
