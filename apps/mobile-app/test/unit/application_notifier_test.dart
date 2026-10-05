import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dartz/dartz.dart';
import 'package:mobile_app/core/network/dio_client.dart';
import 'package:mobile_app/domain/repositories/application_repository.dart';
import 'package:mobile_app/presentation/features/application/providers/application_provider.dart';
import 'package:mobile_app/domain/entities/application_entity.dart';
import 'package:image_picker/image_picker.dart';

// Mocks
class MockApplicationRepository extends Mock implements ApplicationRepository {}

class MockDioClient extends Mock implements DioClient {}

void main() {
  late ApplicationNotifier notifier;
  late MockApplicationRepository mockRepo;
  late MockDioClient mockDio;

  setUp(() {
    mockRepo = MockApplicationRepository();
    mockDio = MockDioClient();
    notifier = ApplicationNotifier(mockRepo, mockDio);
  });

  group('ApplicationNotifier', () {
    test('initial state should be clean', () {
      expect(notifier.state.isLoading, false);
      expect(notifier.state.currentApplication, null);
    });

    group('fetchMyApplications', () {
      test('should update state with list on success', () async {
        // Arrange
        final tApps = [
          ApplicationEntity(
              id: '1',
              status: 'DRAFT',
              createdAt: DateTime.now(),
              type: 'GACP',
              establishmentId: 'est_1',
              establishmentName: 'Farm',
              documents: const [])
        ];
        when(() => mockRepo.getMyApplications())
            .thenAnswer((_) async => Right(tApps));

        // Act
        await notifier.fetchMyApplications();

        // Assert
        expect(notifier.state.isLoading, false);
        expect(notifier.state.myApplications, tApps);
        expect(notifier.state.error, null);
      });
    });

    group('createApplication', () {
      test('should call repository with correct args and update state',
          () async {
        // Arrange
        final tMap = {'key': 'val'};
        final tDocs = {'doc1': XFile('path/to/doc')};
        final tApp = ApplicationEntity(
            id: 'new_id',
            status: 'DRAFT',
            createdAt: DateTime.now(),
            type: 'GACP',
            establishmentId: 'est_1',
            establishmentName: 'Farm',
            documents: const ['doc_url']);

        when(() => mockRepo.createApplication(
              establishmentId: 'est_1',
              type: 'GACP',
              formData: any(named: 'formData'),
              documents: tDocs,
            )).thenAnswer((_) async => Right(tApp));

        // Act
        final result = await notifier.createApplication(
          establishmentId: 'est_1',
          formData: tMap,
          documents: tDocs,
        );

        // Assert
        expect(result, true);
        expect(notifier.state.applicationId, 'new_id');
        verify(() => mockRepo.createApplication(
              establishmentId: 'est_1',
              type: 'GACP',
              formData: any(named: 'formData'),
              documents: tDocs,
            )).called(1);
      });
    });
  });
}
