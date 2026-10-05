import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile_app/core/network/dio_client.dart';
import 'package:mobile_app/data/repositories/establishment_repository_impl.dart';

class MockDioClient extends Mock implements DioClient {}

void main() {
  late EstablishmentRepositoryImpl repository;
  late MockDioClient mockDioClient;

  setUp(() {
    mockDioClient = MockDioClient();
    repository = EstablishmentRepositoryImpl(mockDioClient);
  });

  const tId = '12345';
  final tEstablishmentJson = {
    'id': tId,
    'name': 'Test Farm',
    'type': 'Indoor',
    'status': 'Active'
  };

  group('EstablishmentRepositoryImpl', () {
    group('deleteEstablishment', () {
      test('should return Right(null) when call is successful (201)', () async {
        // Changed from 200 to 201 potentially? Repo checks 200 or 204
        when(() => mockDioClient.delete('/establishments/$tId')).thenAnswer(
          (_) async => Response(
            requestOptions: RequestOptions(path: '/establishments/$tId'),
            statusCode: 200,
            data: {'success': true},
          ),
        );

        final result = await repository.deleteEstablishment(tId);

        expect(result.isRight(), true);
      });
    });

    group('getEstablishments', () {
      test('should return Right(List<EstablishmentEntity>) on success (200)',
          () async {
        // Arrange
        when(() => mockDioClient.get('/establishments/my-establishments'))
            .thenAnswer(
          (_) async => Response(
            requestOptions:
                RequestOptions(path: '/establishments/my-establishments'),
            statusCode: 200,
            data: {
              'data': [tEstablishmentJson]
            },
          ),
        );

        // Act
        final result = await repository.getEstablishments();

        // Assert
        result.fold(
          (failure) => fail('Returned Failure: ${failure.message}'),
          (data) => expect(data.length, 1),
        );
      });
    });
  });
}
