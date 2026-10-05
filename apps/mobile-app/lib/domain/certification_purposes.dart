/// The application purposes — the mobile app's ONE copy
/// (backend: apps/backend/shared/certification-purposes.js).
///
/// Operator ruling 2026-10-05: a purpose is valid only when a ภ.ท. licence for
/// controlled herbs backs it, and what the applicant attaches is the ISSUED
/// licence. Pinned equal to the backend file by
/// apps/backend/__tests__/unit/certification-purposes-vocabulary.test.js.
class CertificationPurpose {
  final String code;
  final String label;
  final String licenceCode;
  final String licenceName;
  final String slotId;

  const CertificationPurpose({
    required this.code,
    required this.label,
    required this.licenceCode,
    required this.licenceName,
    required this.slotId,
  });

  /// Wizard option text: the label with its licence code.
  String get optionLabel => '$label ($licenceCode)';
}

class CertificationPurposes {
  CertificationPurposes._();

  static const List<CertificationPurpose> all = [
    CertificationPurpose(
      code: 'RESEARCH',
      label: 'ศึกษาวิจัย',
      licenceCode: 'ภ.ท. 09',
      licenceName: 'ใบอนุญาตให้ศึกษาวิจัยสมุนไพรควบคุม',
      slotId: 'licence_pt09',
    ),
    CertificationPurpose(
      code: 'EXPORT',
      label: 'ส่งออกเพื่อการค้า',
      licenceCode: 'ภ.ท. 10',
      licenceName: 'ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า',
      slotId: 'licence_pt10',
    ),
    CertificationPurpose(
      code: 'PROCESSING',
      label: 'แปรรูปหรือจำหน่ายเพื่อการค้า',
      licenceCode: 'ภ.ท. 11',
      licenceName: 'ใบอนุญาตให้จำหน่าย หรือแปรรูปสมุนไพรควบคุมเพื่อการค้า',
      slotId: 'licence_pt11',
    ),
  ];

  static List<String> get codes => [for (final p in all) p.code];
}
