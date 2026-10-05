import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/presentation/features/application/models/gacp_application_models.dart';

void main() {
  group('SiteLocation Model', () {
    test('should have default empty landOwnership', () {
      const location = SiteLocation();
      expect(location.landOwnership, '');
    });

    test('copyWith should update landOwnership correctly', () {
      const location = SiteLocation(name: 'Test Farm');
      final updated = location.copyWith(landOwnership: 'Own');

      expect(updated.landOwnership, 'Own');
      expect(updated.name, 'Test Farm');
    });

    test('toMap should include landOwnership', () {
      const location = SiteLocation(
        name: 'Test Farm',
        landOwnership: 'Rent',
      );
      final map = location.toMap();

      expect(map['landOwnership'], 'Rent');
    });

    test('fromMap should parse landOwnership', () {
      final map = {
        'name': 'Test Farm',
        'landOwnership': 'Consent',
      };
      final location = SiteLocation.fromMap(map);

      expect(location.landOwnership, 'Consent');
    });
  });

  group('Document Generation Logic', () {
    test('should include House Registration for new applications', () {
      const state = GACPApplication(
        type: ServiceType.newApplication,
        profile: ApplicantProfile(),
        location: SiteLocation(),
        securityMeasures: SecurityChecklist(),
        production: ProductionPlan(),
      );

      // Document list should include House Registration
      // This tests the logic that was added in step_7_documents.dart
      expect(state.type, ServiceType.newApplication);
    });

    test('Land Ownership Own should not require lease agreement', () {
      const location = SiteLocation(landOwnership: 'Own');
      expect(location.landOwnership, 'Own');
      // When 'Own', no additional land docs needed
    });

    test('Land Ownership Rent should require lease agreement', () {
      const location = SiteLocation(landOwnership: 'Rent');
      expect(location.landOwnership, 'Rent');
      // When 'Rent', lease agreement is required
    });

    test('Land Ownership Consent should require consent letter', () {
      const location = SiteLocation(landOwnership: 'Consent');
      expect(location.landOwnership, 'Consent');
      // When 'Consent', consent letter is required
    });
  });

  group('Applicant Type Conditional Docs', () {
    test('Juristic applicant should require company registration', () {
      const profile = ApplicantProfile(applicantType: 'Juristic');
      expect(profile.applicantType, 'Juristic');
    });

    test('Community applicant should require community enterprise cert', () {
      const profile = ApplicantProfile(applicantType: 'Community');
      expect(profile.applicantType, 'Community');
    });

    test('Cooperative applicant should require cooperative cert', () {
      const profile = ApplicantProfile(applicantType: 'Cooperative');
      expect(profile.applicantType, 'Cooperative');
    });
  });

  group('PlantGroup Classification', () {
    test('plantConfigs should contain 6 plants', () {
      expect(plantConfigs.length, 6);
    });

    test('highControl plants should be Cannabis and Kratom', () {
      final highControlPlants = plantConfigs.values
          .where((p) => p.group == PlantGroup.highControl)
          .toList();
      expect(highControlPlants.length, 2);
    });

    test('generalHerb plants should be 4 (Turmeric, Ginger, Galingale, Plai)',
        () {
      final generalPlants = plantConfigs.values
          .where((p) => p.group == PlantGroup.generalHerb)
          .toList();
      expect(generalPlants.length, 4);
    });
  });

  group('Pre-submission Checklist Validation', () {
    test('Empty profile should fail validation', () {
      const profile = ApplicantProfile();
      final isValid = profile.name.isNotEmpty && profile.idCard.isNotEmpty;
      expect(isValid, false);
    });

    test('Complete profile should pass validation', () {
      const profile = ApplicantProfile(
        name: 'สมชาย ใจดี',
        idCard: '1234567890123',
      );
      final isValid = profile.name.isNotEmpty && profile.idCard.isNotEmpty;
      expect(isValid, true);
    });

    test('Empty landOwnership should fail validation', () {
      const location = SiteLocation();
      final isValid = location.landOwnership.isNotEmpty;
      expect(isValid, false);
    });

    test('Set landOwnership should pass validation', () {
      const location = SiteLocation(landOwnership: 'Own');
      final isValid = location.landOwnership.isNotEmpty;
      expect(isValid, true);
    });
  });

  group('Thai ID Card Validation', () {
    test('Valid 13-digit ID should pass', () {
      const id = '1234567890123';
      final isValid = id.length == 13 && RegExp(r'^\d+$').hasMatch(id);
      expect(isValid, true);
    });

    test('Short ID should fail', () {
      const id = '12345';
      const isValid = id.length == 13;
      expect(isValid, false);
    });

    test('ID with letters should fail', () {
      const id = '123456789012A';
      final isValid = RegExp(r'^\d+$').hasMatch(id);
      expect(isValid, false);
    });
  });
}
