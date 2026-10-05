import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dartz/dartz.dart';
import 'package:mobile_app/domain/repositories/establishment_repository.dart';
import 'package:mobile_app/domain/entities/establishment_entity.dart';
import 'package:mobile_app/presentation/features/establishment/providers/establishment_provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';

// Mocks
class MockEstablishmentRepository extends Mock
    implements EstablishmentRepository {}

class MockXFile extends Mock implements XFile {}

void main() {
  late EstablishmentNotifier notifier;
  late MockEstablishmentRepository mockRepo;

  setUp(() {
    mockRepo = MockEstablishmentRepository();
    registerFallbackValue(MockXFile());
    registerFallbackValue('');
    registerFallbackValue(0.0);
    when(() => mockRepo.getEstablishments())
        .thenAnswer((_) async => const Right([]));
    notifier = EstablishmentNotifier(mockRepo);
  });

  group('EstablishmentNotifier', () {
    test('initial state should trigger loadEstablishments', () async {
      // already called in constructor
      verify(() => mockRepo.getEstablishments()).called(1);
    });

    group('loadEstablishments', () {
      test('should update state with list on success', () async {
        // Arrange
        final tList = [
          const EstablishmentEntity(
              id: '1',
              name: 'Farm 1',
              type: 'farm',
              address: 'Addr 1',
              latitude: 0,
              longitude: 0,
              status: 'ACTIVE')
        ];
        when(() => mockRepo.getEstablishments())
            .thenAnswer((_) async => Right(tList));

        // Act
        await notifier.loadEstablishments();

        // Assert
        expect(notifier.state.establishments, tList);
        expect(notifier.state.isLoading, false);
      });
    });

    group('createEstablishment', () {
      test('should fail if location is not selected', () async {
        // Act
        await notifier.createEstablishment(
            name: 'n',
            type: 't',
            address: 'a',
            titleDeedNo: '1',
            security: 's');

        // Assert
        expect(notifier.state.error, 'กรุณาเลือกตำแหน่งที่ตั้ง');
      });

      test('should call repo and update state on success', () async {
        // Arrange
        notifier.setLocation(const LatLng(10, 20));
        const tEst = EstablishmentEntity(
            id: 'new',
            name: 'n',
            type: 't',
            address: 'a',
            latitude: 10,
            longitude: 20,
            status: 'ACTIVE');

        when(() => mockRepo.createEstablishment(
              name: any(named: 'name'),
              type: any(named: 'type'),
              address: any(named: 'address'),
              latitude: any(named: 'latitude'),
              longitude: any(named: 'longitude'),
              titleDeedNo: any(named: 'titleDeedNo'),
              security: any(named: 'security'),
              image: any(named: 'image'),
            )).thenAnswer((_) async => const Right(tEst));

        // Act
        await notifier.createEstablishment(
            name: 'n',
            type: 't',
            address: 'a',
            titleDeedNo: '1',
            security: 's');

        // Assert
        expect(notifier.state.isSuccess, true);
        expect(notifier.state.establishments.length, 1);
        expect(notifier.state.establishments.first.id, 'new');
      });
    });
  });
}
