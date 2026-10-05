@Tags(['live'])
library;

// LIVE integration test — hits the real backend over the network.
// Skipped by default (see dart_test.yaml). Run explicitly (BOTH flags required
// — `--tags live` alone selects but does not un-skip):
//   flutter test --tags live --run-skipped test/integration/
//
// Proves the exact endpoints / request bodies / response-parse paths that the
// mobile app uses actually work against the real GACP backend:
//   - POST /auth/health/login  → data.tokens.accessToken   (auth_repository_impl.loginWithAccountType)
//   - GET  /applications/my    with Bearer token           (application_repository_impl.getMyApplications)
//   - register → upload → prepare (buildCanonicalFormData) → submit
//
// SAFETY: main() refuses to run against any host other than staging/localhost
// — the full-flow test REGISTERS an account and SUBMITS an application
// (UAT mutations are staging-only, never production).
//
// Test creds are the seeded staging HEALTH applicant (Applicant1) — read-only login.

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/config/api_config.dart';
import 'package:mobile_app/presentation/features/application/models/gacp_application_models.dart';
import 'package:mobile_app/presentation/features/application/services/application_service.dart';

void main() {
  // ANTI-PROD GUARD: this suite REGISTERS an account and SUBMITS an
  // application. UAT mutations are staging-only (golden rule #7) — refuse any
  // other host outright, even via --dart-define override.
  final host = Uri.parse(ApiConfig.baseUrl).host;
  final allowedHost = host == 'staging.gacpth.com' ||
      host == 'localhost' ||
      host == '127.0.0.1' ||
      host == '10.0.2.2';
  if (!allowedHost) {
    throw StateError(
        'REFUSING to run live mutation tests against "$host" — staging/localhost only.');
  }

  // Applicant1 seeded on staging (seed-test-accounts.js): HEALTH / INDIVIDUAL.
  const identifier = '1100000000008';
  const password = 'Test@12345';

  late Dio dio;
  setUp(() {
    dio = Dio(BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 20),
      // Accept any status so we assert on statusCode ourselves.
      validateStatus: (_) => true,
    ));
  });

  Future<String> login() async {
    final login = await dio.post('/auth/health/login', data: {
      'accountType': 'INDIVIDUAL',
      'identifier': identifier,
      'password': password,
    });
    return login.data['data']['tokens']['accessToken'] as String;
  }

  // A fully-filled INDIVIDUAL application, minus the uploaded document (which is
  // injected after the real upload below).
  GACPApplication fullApp({List<UploadedDocRef> docs = const []}) {
    return GACPApplication(
      plantId: 'TUR',
      type: ServiceType.newApplication,
      acceptedStandards: true,
      consentedPDPA: true,
      documents: docs,
      profile: const ApplicantProfile(
        applicantType: 'Individual',
        firstName: 'มือถือ',
        lastName: 'ทดสอบ',
        name: 'มือถือ ทดสอบ',
        idCard: '1101700999998',
        mobile: '0812345678',
        email: 'mobiletest@example.com',
        address: '123 หมู่ 4 ต.บางรัก',
        responsibleName: 'มือถือ ทดสอบ',
      ),
      location: const SiteLocation(
        name: 'ฟาร์มทดสอบมือถือ',
        address: '123 หมู่ 4',
        province: 'กรุงเทพมหานคร',
        landOwnership: 'Own',
        lat: 13.7,
        lng: 100.5,
        plots: [
          PlotDefinition(
            id: 'p1',
            name: 'แปลง A',
            areaSize: '2',
            areaUnit: 'Rai',
            solarSystem: 'OUTDOOR',
          ),
        ],
      ),
      securityMeasures: const SecurityChecklist(hasZoning: true),
      production: const ProductionPlan(
        plantParts: ['หัว/เหง้า (Rhizome)'],
        sourceType: 'Self',
        areaSizeRai: 2.0,
        estimatedYield: 500,
        productionCycle: '4 เดือน',
        postHarvest: PostHarvestPlan(
          harvestMethod: 'Manual',
          dryingMethod: 'Sun Dry',
          packaging: 'สุญญากาศ',
          storage: 'ห้องเย็น 25C',
        ),
      ),
    );
  }

  test('LIVE login returns a token at data.tokens.accessToken', () async {
    final resp = await dio.post('/auth/health/login', data: {
      'accountType': 'INDIVIDUAL',
      'identifier': identifier,
      'password': password,
    });

    expect(resp.statusCode, 200, reason: 'login should succeed; body=${resp.data}');
    final data = resp.data['data'] as Map<String, dynamic>;
    final token = data['tokens']?['accessToken'] as String?;
    expect(token, isNotNull);
    expect(token!.isNotEmpty, isTrue);
    expect(data['user']?['role'], 'HEALTH');
  });

  test('LIVE Bearer token authenticates GET /applications/my (returns a list)',
      () async {
    final token = await login();

    final resp = await dio.get(
      '/applications/my',
      options: Options(headers: {'Authorization': 'Bearer $token'}),
    );

    expect(resp.statusCode, 200,
        reason: 'Bearer auth should be accepted; body=${resp.data}');
    expect(resp.data['data'], isA<List<dynamic>>());
  });

  test(
      'LIVE full applicant flow: register(consent) -> upload doc -> prepare(canonical mapper) -> submit -> PENDING_DOC_FEE',
      () async {
    // Dedicated mobile-test applicant with a valid Mod-11 Thai ID. Registering
    // via /auth/health/register grants TERMS_OF_SERVICE + PRIVACY_POLICY consent
    // (auto-recorded on success), which the submit gate (requireConsent) needs.
    // Idempotent: first run creates it (201), later runs get "already registered".
    const mobileId = '1101700999998';
    const pw = 'Test@12345';
    final reg = await dio.post('/auth/health/register', data: {
      'idCard': mobileId,
      'password': pw,
      'firstName': 'มือถือ',
      'lastName': 'ทดสอบ',
      'phoneNumber': '0812345678',
      'accountType': 'INDIVIDUAL',
      'acceptedTermsOfService': true,
      'acceptedPrivacyPolicy': true,
    });
    // 201 = created. The ONLY acceptable non-201 is the duplicate-identifier
    // rejection (the account exists from a previous run). A blanket
    // anyOf(400,...) would mask a permanently-broken register (schema drift
    // also returns 400) while later steps pass via the pre-existing account.
    final regOk = reg.statusCode == 201 ||
        (reg.data is Map &&
            '${reg.data['code'] ?? reg.data['error'] ?? ''}'
                .contains('DUPLICATE'));
    expect(regOk, isTrue,
        reason:
            'register must be 201 or DUPLICATE_IDENTIFIER; got ${reg.statusCode} body=${reg.data}');

    final loginResp = await dio.post('/auth/health/login', data: {
      'accountType': 'INDIVIDUAL',
      'identifier': mobileId,
      'password': pw,
    });
    expect(loginResp.statusCode, 200,
        reason: 'mobile-test account login; body=${loginResp.data}');
    final token = loginResp.data['data']['tokens']['accessToken'] as String;
    final auth = Options(headers: {'Authorization': 'Bearer $token'});

    // 1) Upload one minimal PDF document (multipart) — mirrors step 7.
    final pdfBytes = <int>[
      ...'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'.codeUnits,
    ];
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        pdfBytes,
        filename: 'id_card.pdf',
        contentType: DioMediaType('application', 'pdf'),
      ),
      'slotId': 'ID_CARD',
      'stepKey': 'documents',
    });
    final up = await dio.post('/applications/draft-documents',
        data: form, options: auth);
    expect(up.statusCode, anyOf(200, 201),
        reason: 'draft-documents upload should succeed; body=${up.data}');
    final upData = up.data['data'] as Map<String, dynamic>;
    final fileUrl = (upData['fileUrl'] ?? upData['url'])?.toString() ?? '';
    expect(fileUrl.isNotEmpty, isTrue, reason: 'upload must return a fileUrl');

    final docRef = UploadedDocRef(
      documentId: upData['documentId']?.toString() ?? '',
      type: 'ID_CARD',
      name: upData['fileName']?.toString() ?? 'id_card.pdf',
      url: fileUrl,
    );

    // 2) Build canonical formData via the SAME mapper the app uses, then prepare.
    final canonical = buildCanonicalFormData(fullApp(docs: [docRef]));
    final prep =
        await dio.post('/applications/prepare', data: canonical, options: auth);
    expect(prep.statusCode, 200,
        reason: 'prepare should persist canonical formData; body=${prep.data}');
    final appId = prep.data['data']?['id']?.toString();
    expect(appId, isNotNull, reason: 'prepare must return an application id');

    // 3) Submit — validates the persisted formData; transitions to PENDING_DOC_FEE.
    final sub = await dio
        .post('/applications/submit', data: {'applicationId': appId}, options: auth);
    expect(sub.statusCode, 200,
        reason:
            'submit should pass validateCanonicalSubmission; body=${sub.data}');
    final status = sub.data['data']?['status']?.toString();
    // Exact match: the submit route always walks DRAFT→SUBMITTED→PENDING_DOC_FEE
    // in one call — accepting 'SUBMITTED' too would pre-tolerate a regression
    // that strands applications before phase-1 billing.
    expect(status, 'PENDING_DOC_FEE',
        reason: 'first submit lands on PENDING_DOC_FEE; body=${sub.data}');
    expect(sub.data['nextRequiredAction'], 'PAY_PHASE_1',
        reason: 'next action must be pay phase 1; body=${sub.data}');

    // ═══ M3: Phase-1 payment two-money-flow (same journey continues) ═══

    // (P1) Quotations auto-issued on submit (fire-and-forget → brief retry).
    Map<String, dynamic>? qData;
    for (var attempt = 0; attempt < 5; attempt++) {
      final q = await dio.get('/applications/$appId/quotations', options: auth);
      expect(q.statusCode, 200, reason: 'quotations list; body=${q.data}');
      qData = Map<String, dynamic>.from(q.data['data'] as Map);
      if (qData['dtam'] is Map && qData['platform'] is Map) break;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
    expect(qData?['dtam'], isA<Map<dynamic, dynamic>>(),
        reason: 'DTAM quotation must be auto-issued');
    expect(qData?['platform'], isA<Map<dynamic, dynamic>>(),
        reason: 'PLATFORM quotation must be auto-issued');

    // (P2) Accept BOTH sides — first accept mints both Phase-1 invoices.
    for (final side in ['DTAM', 'PLATFORM']) {
      final acc = await dio.post(
          '/applications/$appId/quotations/$side/accept',
          options: auth);
      expect(acc.statusCode, 200,
          reason: 'accept $side quotation; body=${acc.data}');
      expect(acc.data['data']?['status'], anyOf('ACCEPTED', 'INVOICED'),
          reason: '$side must be ACCEPTED; body=${acc.data}');
    }

    // (P3) Invoices: exactly one STATE (5000×scope, no VAT) + one PLATFORM
    // (535×scope incl VAT 7%) for this application.
    final invRes = await dio.get('/invoices/my', options: auth);
    expect(invRes.statusCode, 200);
    final myInvoices = (invRes.data['data'] as List)
        .whereType<Map>()
        .where((m) =>
            m['applicationId']?.toString() == appId &&
            m['serviceType'].toString().startsWith('PHASE_1_'))
        .toList();
    expect(myInvoices.length, 2,
        reason: 'both-or-neither atomic mint; got=${myInvoices.map((m) => m['serviceType'])}');
    final stateInv = myInvoices
        .firstWhere((m) => m['serviceType'].toString().endsWith('_STATE_FEE'));
    final platInv = myInvoices.firstWhere(
        (m) => !m['serviceType'].toString().endsWith('_STATE_FEE'));
    final stateAmt = num.parse(stateInv['totalAmount'].toString());
    final platAmt = num.parse(platInv['totalAmount'].toString());
    // Per-scope fee math: STATE = 5000/scope; PLATFORM = 535/scope (incl VAT).
    expect(stateAmt % 5000, 0,
        reason: 'STATE amount must be 5000×scope, got $stateAmt');
    expect(platAmt % 535, 0,
        reason: 'PLATFORM amount must be 535×scope (500+35 VAT), got $platAmt');

    // (P4) PAYMENT_TERMS consent (upload gate is fail-closed 409 without it).
    final consent = await dio.post('/consent',
        data: {'category': 'PAYMENT_TERMS', 'granted': true}, options: auth);
    expect(consent.statusCode, anyOf(200, 201),
        reason: 'grant PAYMENT_TERMS; body=${consent.data}');

    // (P5) Bank accounts resolvable per side.
    for (final side in ['STATE', 'PLATFORM']) {
      final bank = await dio.get(
          '/payments/bank-accounts/active?phase=PHASE_1&side=$side',
          options: auth);
      expect(bank.statusCode, 200,
          reason: 'active bank account for $side; body=${bank.data}');
      expect(bank.data['data']?['accountNumber'], isNotNull);
    }

    // (P6) Upload one slip per invoice (STATE then PLATFORM).
    final slipPng = <int>[
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG magic
      ...List<int>.filled(64, 0),
    ];
    for (final inv in [stateInv, platInv]) {
      final amt = num.parse(inv['totalAmount'].toString());
      final form = FormData.fromMap({
        'file': MultipartFile.fromBytes(slipPng,
            filename: 'slip.png', contentType: DioMediaType('image', 'png')),
        'applicationId': appId,
        'invoiceId': inv['id'].toString(),
        'phase': 'PHASE_1',
        'amountClaimed': amt.round().toString(),
      });
      final up = await dio.post('/payments/slip/upload',
          data: form, options: auth);
      expect(up.statusCode, anyOf(200, 201),
          reason: 'slip upload for ${inv['serviceType']}; body=${up.data}');
      expect(up.data['data']?['status'], 'PENDING_REVIEW',
          reason: 'fresh slip must be PENDING_REVIEW; body=${up.data}');
    }

    // (P7) Application transitioned to PHASE_1_SLIP_UNDER_REVIEW on the FIRST
    // slip (second only links itself; advance to DOC_FEE_PAID needs ACCOUNT
    // approval of BOTH sides — out of applicant scope).
    final appRes = await dio.get('/applications/$appId', options: auth);
    expect(appRes.statusCode, 200);
    expect(appRes.data['data']?['status'], 'PHASE_1_SLIP_UNDER_REVIEW',
        reason: 'app must be under slip review; body=${appRes.data['data']?['status']}');
  });
}
