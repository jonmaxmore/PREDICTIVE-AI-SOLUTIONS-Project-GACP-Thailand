import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_app/core/network/dio_client.dart';
import 'package:mobile_app/core/errors/failures.dart';
import 'package:mobile_app/domain/entities/user_entity.dart';
import 'package:mobile_app/data/repositories/auth_repository_impl.dart';
import 'package:image_picker/image_picker.dart';

// Mocks
class MockDioClient extends Mock implements DioClient {}

class MockFlutterSecureStorage extends Mock implements FlutterSecureStorage {}

class MockXFile extends Mock implements XFile {}

void main() {
  late AuthRepositoryImpl repository;
  late MockDioClient mockDioClient;
  late MockFlutterSecureStorage mockStorage;

  setUp(() {
    mockDioClient = MockDioClient();
    mockStorage = MockFlutterSecureStorage();
    repository = AuthRepositoryImpl(mockDioClient, mockStorage);
    registerFallbackValue(FormData());
  });

  group('AuthRepository', () {
    const tEmail = 'test@example.com';
    const tPassword = 'password123';

    // User JSON from API
    final tUserJson = {
      '_id': '123',
      'email': tEmail,
      'firstName': 'Test',
      'lastName': 'User',
      'role': 'Applicant',
      'phoneNumber': '0812345678',
      'address': '123 Test St',
      'province': 'BKK',
    };

    const tUserEntity = UserEntity(
      id: '123',
      email: tEmail,
      firstName: 'Test',
      lastName: 'User',
      role: 'Applicant',
      phoneNumber: '0812345678',
      address: '123 Test St',
      province: 'BKK',
      // other fields null
    );

    group('login', () {
      test('should return UserEntity and save token on success (200)',
          () async {
        // Arrange
        when(() => mockDioClient.post(
              '/auth/health/login',
              data: any(named: 'data'),
            )).thenAnswer((_) async => Response(
              requestOptions: RequestOptions(path: '/'),
              statusCode: 200,
              data: {
                'success': true,
                'data': {'token': 'fake_token', 'user': tUserJson}
              },
            ));
        when(() => mockStorage.write(key: 'auth_token', value: 'fake_token'))
            .thenAnswer((_) async => {});

        // Act
        final result = await repository.login(tEmail, tPassword);

        // Assert
        expect(result.fold((l) => null, (r) => r.email), tUserEntity.email);
        verify(() => mockStorage.write(key: 'auth_token', value: 'fake_token'))
            .called(1);
      });

      test('should return ServerFailure on failure (401)', () async {
        // Arrange
        when(() => mockDioClient.post(
              '/auth/health/login',
              data: any(named: 'data'),
            )).thenAnswer((_) async => Response(
              requestOptions: RequestOptions(path: '/'),
              statusCode: 401,
              data: {'message': 'Unauthorized'},
            ));

        // Act
        final result = await repository.login(tEmail, tPassword);

        // Assert
        expect(result.isLeft(), true);
        result.fold((l) => expect(l, isA<ServerFailure>()), (r) => null);
      });
    });

    group('logout', () {
      test('wipes ALL auth/session/PII keys (not just auth_token)', () async {
        // SECURITY: nothing may survive into the next account's session on a
        // shared device.
        const keys = [
          'auth_token',
          'user',
          'user_role',
          'account_type',
          'jwt_token',
          'refresh_token',
        ];
        for (final k in keys) {
          when(() => mockStorage.delete(key: k)).thenAnswer((_) async {});
        }

        final result = await repository.logout();

        expect(result.isRight(), true);
        for (final k in keys) {
          verify(() => mockStorage.delete(key: k)).called(1);
        }
      });
    });
  });
}
