@Tags(['live'])
library;

// LIVE read-contract test for the M4b read screens — hits the real staging
// backend over the network with READ-ONLY GETs (no register/submit/upload).
// Skipped by default (see dart_test.yaml). Run explicitly — this file ONLY
// (running the whole integration dir would also run the full-flow suite,
// which mutates staging):
//
//   flutter test --tags live --run-skipped test/integration/m4b_read_contract_test.dart
//
// Proves the envelopes the M4b screens parse:
//   - GET /certificates/my  → { success:true, data:[CertificateRow...] }
//   - GET /documents        → { success:true, data:[DocumentRow...], total }
//
// Empty lists are fine for this account — assertions are on SHAPE, not content.

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/config/api_config.dart';

void main() {
  // Read-only, but keep the same anti-prod guard as the sibling suite: the
  // creds below are staging seeds and must never be pointed elsewhere.
  final host = Uri.parse(ApiConfig.baseUrl).host;
  final allowedHost = host == 'staging.gacpth.com' ||
      host == 'localhost' ||
      host == '127.0.0.1' ||
      host == '10.0.2.2';
  if (!allowedHost) {
    throw StateError(
        'REFUSING to run live tests against "$host" — staging/localhost only.');
  }

  // Mobile-test HEALTH applicant (created by the full-flow suite; INDIVIDUAL).
  const identifier = '1101700999998';
  const password = 'Test@12345';

  late Dio dio;
  setUp(() {
    dio = Dio(BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 20),
      validateStatus: (_) => true,
    ));
  });

  Future<Options> auth() async {
    final login = await dio.post('/auth/health/login', data: {
      'accountType': 'INDIVIDUAL',
      'identifier': identifier,
      'password': password,
    });
    expect(login.statusCode, 200,
        reason: 'login must succeed; body=${login.data}');
    final token = login.data['data']['tokens']['accessToken'] as String;
    return Options(headers: {'Authorization': 'Bearer $token'});
  }

  test('LIVE GET /certificates/my returns the {success,data:[...]} envelope',
      () async {
    final resp = await dio.get('/certificates/my', options: await auth());

    expect(resp.statusCode, 200,
        reason: 'certificates/my must be 200; body=${resp.data}');
    expect(resp.data, isA<Map<dynamic, dynamic>>());
    expect(resp.data['success'], isTrue);
    final data = resp.data['data'];
    expect(data, isA<List<dynamic>>());

    // Shape check on the first row when present (empty list is fine).
    if ((data as List).isNotEmpty) {
      final row = data.first as Map;
      expect(row.containsKey('certificateNumber'), isTrue,
          reason: 'row keys=${row.keys.toList()}');
      expect(row.containsKey('status'), isTrue);
      expect(row.containsKey('qrCode'), isTrue,
          reason: 'qrCode = public verify URL string');
      expect(row.containsKey('siteName'), isTrue);
      expect(row.containsKey('plantType'), isTrue);
      expect(row.containsKey('expiryDate'), isTrue);
    }
  });

  test('LIVE GET /documents returns the {success,data:[...],total} envelope',
      () async {
    final resp = await dio.get('/documents', options: await auth());

    expect(resp.statusCode, 200,
        reason: '/documents must be 200; body=${resp.data}');
    expect(resp.data, isA<Map<dynamic, dynamic>>());
    expect(resp.data['success'], isTrue);
    final data = resp.data['data'];
    expect(data, isA<List<dynamic>>());
    expect(resp.data.containsKey('total'), isTrue,
        reason: 'contract has a total sibling next to data');

    if ((data as List).isNotEmpty) {
      final row = data.first as Map;
      expect(row.containsKey('fileName'), isTrue,
          reason: 'row keys=${row.keys.toList()}');
      expect(row.containsKey('fileUrl'), isTrue);
      expect(row.containsKey('applicationNumber'), isTrue);
      expect(row.containsKey('uploadedAt'), isTrue);
    }
  });
}
