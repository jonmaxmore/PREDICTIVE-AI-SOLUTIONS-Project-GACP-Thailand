import 'package:dartz/dartz.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/errors/failures.dart';
import '../entities/user_entity.dart';

abstract class AuthRepository {
  Future<Either<Failure, void>> register(
      Map<String, dynamic> data, XFile image);

  /// Register with data only (no image)
  Future<Either<Failure, void>> registerWithData(Map<String, dynamic> data);

  Future<Either<Failure, UserEntity>> login(String email, String password);

  /// Login with specific account type (INDIVIDUAL, JURISTIC, COMMUNITY_ENTERPRISE)
  Future<Either<Failure, UserEntity>> loginWithAccountType(
    String accountType,
    String identifier,
    String password,
  );

  Future<Either<Failure, void>> logout();
  Future<Either<Failure, UserEntity>> getCurrentUser();
}
