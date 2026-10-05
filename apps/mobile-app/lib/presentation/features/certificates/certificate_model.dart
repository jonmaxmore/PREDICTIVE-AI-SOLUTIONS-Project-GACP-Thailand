/// Row model for the REAL GET /certificates/my response
/// (apps/backend/routes/api/certificates/certificates.js:132-157):
///   { id, _id, certificateNumber, applicationId, farmId, siteName, plantType,
///     issuedDate, expiryDate, status, canonicalStatus, qrCode, farm, crops, audit }
///
/// Gotchas: `status` is stored lowercase ('active') and the backend relabels
/// it 'EXPIRED' when past expiry; `qrCode` is the PUBLIC VERIFY URL STRING
/// (e.g. https://gacpth.com/verify/GACP-TH-2569-XXXX), not image data.
class CertificateRow {
  final String id;
  final String certificateNumber;
  final String applicationId;
  final String siteName;
  final String plantType;
  final DateTime? issuedDate;
  final DateTime? expiryDate;
  final String status;

  /// Public verify URL string.
  final String qrCode;

  const CertificateRow({
    required this.id,
    required this.certificateNumber,
    required this.applicationId,
    required this.siteName,
    required this.plantType,
    required this.issuedDate,
    required this.expiryDate,
    required this.status,
    required this.qrCode,
  });

  factory CertificateRow.fromJson(Map<String, dynamic> json) {
    DateTime? date(dynamic v) =>
        v == null ? null : DateTime.tryParse(v.toString());
    return CertificateRow(
      id: (json['id'] ?? json['_id'])?.toString() ?? '',
      certificateNumber: json['certificateNumber']?.toString() ?? '',
      applicationId: json['applicationId']?.toString() ?? '',
      siteName: json['siteName']?.toString() ?? '',
      plantType: json['plantType']?.toString() ?? '',
      issuedDate: date(json['issuedDate']),
      expiryDate: date(json['expiryDate']),
      status: json['status']?.toString() ?? '',
      qrCode: json['qrCode']?.toString() ?? '',
    );
  }

  /// Backend relabel wins; otherwise fall back to local date math.
  bool get isExpired {
    if (status.trim().toUpperCase() == 'EXPIRED') return true;
    final exp = expiryDate;
    return exp != null && DateTime.now().isAfter(exp);
  }

  int? get daysRemaining =>
      expiryDate?.difference(DateTime.now()).inDays;

  bool get isExpiringSoon {
    if (isExpired) return false;
    final days = daysRemaining;
    return days != null && days < 30;
  }
}
