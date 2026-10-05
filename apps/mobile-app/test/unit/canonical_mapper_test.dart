import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/presentation/features/application/models/gacp_application_models.dart';
import 'package:mobile_app/presentation/features/application/services/application_service.dart';

/// These assertions mirror the backend `validateCanonicalSubmission`
/// (apps/backend/validation/canonical-application-validator.js) required-field
/// list. If the mapper produces an object that satisfies every check here, a
/// real submit against the backend will pass step-2/4/5/6/7/8 validation.

GACPApplication _fullIndividualApp() {
  return GACPApplication(
    plantId: 'TUR',
    type: ServiceType.newApplication,
    certificationPurposes: const ['EXPORT'],
    acceptedStandards: true,
    consentedPDPA: true,
    profile: const ApplicantProfile(
      applicantType: 'Individual',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      name: 'สมชาย ใจดี',
      idCard: '1100000000008',
      mobile: '0812345678',
      email: 'somchai@example.com',
      address: '123 หมู่ 4 ต.บางรัก',
      responsibleName: 'สมชาย ใจดี',
    ),
    location: const SiteLocation(
      name: 'ฟาร์มสมุนไพรสมชาย',
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
        harvestMethod: 'เก็บด้วยมือ (Manual)',
        dryingMethod: 'ตากแดด (Sun Dry)',
        packaging: 'สุญญากาศ',
        storage: 'ห้องเย็น 25C',
      ),
    ),
    documents: const [
      UploadedDocRef(
        documentId: 'doc-1',
        type: 'ID_CARD',
        name: 'id.pdf',
        url: '/uploads/application-drafts/1-abc.pdf',
      ),
    ],
  );
}

void main() {
  // Operator ruling 2026-10-05: a purpose is valid only when a ภ.ท. licence backs it
  // (RESEARCH / EXPORT / PROCESSING). The mapper used to post ['COMMERCIAL'] on the
  // applicant's behalf — an invented default and a word the backend now refuses.
  group('certificationPurposes — what the applicant chose, never a default', () {
    test('is exactly the chosen purposes', () {
      final app = _fullIndividualApp()
          .copyWith(certificationPurposes: ['RESEARCH', 'PROCESSING']);
      expect(buildCanonicalFormData(app)['certificationPurposes'],
          ['RESEARCH', 'PROCESSING']);
    });

    test('is empty when nothing was chosen — no COMMERCIAL, no other default', () {
      final app = _fullIndividualApp().copyWith(certificationPurposes: []);
      expect(buildCanonicalFormData(app)['certificationPurposes'], isEmpty);
    });

    test('a submit without a choice is refused before any request is made', () {
      final none = _fullIndividualApp().copyWith(certificationPurposes: []);
      final chosen = _fullIndividualApp();
      expect(missingPurposeMessage(none), contains('วัตถุประสงค์'));
      expect(missingPurposeMessage(chosen), isNull);
    });

    test('survives the draft round trip', () {
      final app = _fullIndividualApp()
          .copyWith(certificationPurposes: ['RESEARCH']);
      expect(GACPApplication.fromMap(app.toMap()).certificationPurposes,
          ['RESEARCH']);
    });
  });

  group('buildCanonicalFormData — backend required fields', () {
    final fd = buildCanonicalFormData(_fullIndividualApp());

    test('step 2: plantId + cultivationMethods', () {
      expect((fd['plantId'] as String).isNotEmpty, isTrue);
      expect((fd['cultivationMethods'] as List).isNotEmpty, isTrue);
      // derived from the single OUTDOOR plot
      expect(fd['cultivationMethods'], contains('OUTDOOR'));
    });

    test('step 4: INDIVIDUAL applicant identity', () {
      final a = fd['applicantData'] as Map;
      expect(a['applicantType'], 'INDIVIDUAL');
      expect((a['firstName'] as String).isNotEmpty, isTrue);
      expect((a['lastName'] as String).isNotEmpty, isTrue);
      expect((a['idCard'] as String).length, greaterThanOrEqualTo(13));
      expect((a['phone'] as String).isNotEmpty, isTrue);
      expect((a['address'] as String).isNotEmpty, isTrue);
    });

    test('step 5: farmData + first plot', () {
      final f = fd['farmData'] as Map;
      expect((f['farmName'] as String).isNotEmpty, isTrue);
      expect((f['address'] as String).isNotEmpty, isTrue);
      expect((f['province'] as String).isNotEmpty, isTrue);
      expect((f['totalAreaSize'] as String).isNotEmpty, isTrue);
      expect(f['landOwnership'], 'OWN');

      final plots = fd['plots'] as List;
      expect(plots.length, greaterThanOrEqualTo(1));
      final p0 = plots.first as Map;
      expect((p0['name'] as String).isNotEmpty, isTrue);
      expect((p0['areaSize'] as String).isNotEmpty, isTrue);
      expect((p0['solarSystem'] as String).isNotEmpty, isTrue);
    });

    test('step 6: productionData propagationType + plantParts (>=1)', () {
      final pr = fd['productionData'] as Map;
      expect((pr['propagationType'] as List).isNotEmpty, isTrue);
      expect((pr['plantParts'] as List).isNotEmpty, isTrue);
    });

    test('step 7: harvestData harvest/drying/storage', () {
      final h = fd['harvestData'] as Map;
      expect((h['harvestMethod'] as String).isNotEmpty, isTrue);
      expect((h['dryingMethod'] as String).isNotEmpty, isTrue);
      expect((h['storageSystem'] as String).isNotEmpty, isTrue);
    });

    test('step 8: >=1 uploaded document', () {
      final docs = fd['documents'] as List;
      expect(docs.isNotEmpty, isTrue);
      final d0 = docs.first as Map;
      expect(d0['uploaded'], true);
      expect((d0['url'] as String).isNotEmpty, isTrue);
    });
  });

  group('enum + fallback mapping', () {
    test(
        'applicantType Community -> COMMUNITY with ALL backend-required fields non-empty',
        () {
      final app = _fullIndividualApp().copyWith(
        profile: _fullIndividualApp().profile.copyWith(
              applicantType: 'Community',
              name: 'วิสาหกิจชุมชนสมุนไพร',
            ),
      );
      final a = buildCanonicalFormData(app)['applicantData'] as Map;
      expect(a['applicantType'], 'COMMUNITY');
      // canonicalStep4Schema COMMUNITY branch requires all three non-empty:
      expect((a['communityName'] as String).isNotEmpty, isTrue);
      expect((a['presidentName'] as String).isNotEmpty, isTrue);
      expect((a['communityRegNumber'] as String).isNotEmpty, isTrue,
          reason: 'reg number maps from the idCard field the UI collects');
    });

    test(
        'applicantType Juristic -> JURISTIC with ALL backend-required fields non-empty',
        () {
      final app = _fullIndividualApp().copyWith(
        profile: _fullIndividualApp()
            .profile
            .copyWith(applicantType: 'Juristic', name: 'บจก. สมุนไพรไทย'),
      );
      final a = buildCanonicalFormData(app)['applicantData'] as Map;
      expect(a['applicantType'], 'JURISTIC');
      // canonicalStep4Schema JURISTIC branch requires all three non-empty:
      expect((a['companyName'] as String).isNotEmpty, isTrue);
      expect((a['registrationNumber'] as String).isNotEmpty, isTrue,
          reason: 'reg number maps from the idCard field the UI collects');
      expect((a['directorName'] as String).isNotEmpty, isTrue);
    });

    test('name splits into first/last when explicit fields empty', () {
      final app = _fullIndividualApp().copyWith(
        profile: const ApplicantProfile(
          applicantType: 'Individual',
          name: 'อาทิตย์ พระอาทิตย์',
          idCard: '1100000000008',
          mobile: '0812345678',
          address: 'x',
        ),
      );
      final a = buildCanonicalFormData(app)['applicantData'] as Map;
      expect(a['firstName'], 'อาทิตย์');
      expect(a['lastName'], 'พระอาทิตย์');
    });

    test('serviceType maps to backend snake value', () {
      final fd = buildCanonicalFormData(_fullIndividualApp());
      expect(fd['serviceType'], 'new_application');
    });
  });
}
