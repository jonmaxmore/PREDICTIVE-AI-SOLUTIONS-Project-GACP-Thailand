// Unit tests for CertificateRow — parses the REAL GET /certificates/my row
// (apps/backend/routes/api/certificates/certificates.js:132-157):
//   { id, _id, certificateNumber, applicationId, farmId, siteName, plantType,
//     issuedDate, expiryDate, status, canonicalStatus, qrCode, farm, crops, audit }
// Gotchas covered: status is stored lowercase 'active' and relabeled
// 'EXPIRED' when past expiry; qrCode is the public verify URL STRING.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/presentation/features/certificates/certificate_model.dart';

void main() {
  final activeJson = {
    'id': 'cert-uuid-1',
    '_id': 'cert-uuid-1',
    'certificateNumber': 'GACP-TH-2569-A3F7B2',
    'applicationId': 'app-uuid-1',
    'farmId': 'farm-uuid-1',
    'siteName': 'ฟาร์มทดสอบ',
    'plantType': 'ขมิ้นชัน',
    'issuedDate': '2026-01-15T00:00:00.000Z',
    'expiryDate': DateTime.now()
        .add(const Duration(days: 200))
        .toIso8601String(),
    'status': 'active', // stored lowercase — must not break badge logic
    'canonicalStatus': 'active',
    'qrCode': 'https://gacpth.com/verify/GACP-TH-2569-A3F7B2',
    'farm': {'name': 'ฟาร์มทดสอบ', 'province': 'กรุงเทพมหานคร'},
    'crops': ['ขมิ้นชัน'],
    'audit': null,
  };

  test('parses the full contract row', () {
    final cert = CertificateRow.fromJson(activeJson);
    expect(cert.id, 'cert-uuid-1');
    expect(cert.certificateNumber, 'GACP-TH-2569-A3F7B2');
    expect(cert.siteName, 'ฟาร์มทดสอบ');
    expect(cert.plantType, 'ขมิ้นชัน');
    expect(cert.issuedDate, isNotNull);
    expect(cert.issuedDate!.year, 2026);
    expect(cert.expiryDate, isNotNull);
    expect(cert.qrCode, 'https://gacpth.com/verify/GACP-TH-2569-A3F7B2');
    expect(cert.status, 'active');
  });

  test('lowercase "active" with future expiry → not expired', () {
    final cert = CertificateRow.fromJson(activeJson);
    expect(cert.isExpired, isFalse);
  });

  test('backend-relabeled status EXPIRED wins even without local date math',
      () {
    final cert = CertificateRow.fromJson({
      ...activeJson,
      'status': 'EXPIRED',
    });
    expect(cert.isExpired, isTrue);
  });

  test('past expiryDate → expired even if status still says active', () {
    final cert = CertificateRow.fromJson({
      ...activeJson,
      'expiryDate': DateTime.now()
          .subtract(const Duration(days: 1))
          .toIso8601String(),
    });
    expect(cert.isExpired, isTrue);
  });

  test('expiring-soon window: <30 days remaining and not expired', () {
    final soon = CertificateRow.fromJson({
      ...activeJson,
      'expiryDate':
          DateTime.now().add(const Duration(days: 10)).toIso8601String(),
    });
    expect(soon.isExpired, isFalse);
    expect(soon.isExpiringSoon, isTrue);

    final far = CertificateRow.fromJson(activeJson);
    expect(far.isExpiringSoon, isFalse);
  });

  test('falls back to _id when id missing; tolerates missing optionals', () {
    final cert = CertificateRow.fromJson({
      '_id': 'only-underscore-id',
      'certificateNumber': 'GACP-X',
      'status': 'active',
    });
    expect(cert.id, 'only-underscore-id');
    expect(cert.siteName, '');
    expect(cert.plantType, '');
    expect(cert.qrCode, '');
    expect(cert.issuedDate, isNull);
    expect(cert.expiryDate, isNull);
    expect(cert.isExpired, isFalse,
        reason: 'no expiry date + active status = not expired');
    expect(cert.isExpiringSoon, isFalse);
  });
}
