import 'package:dartz/dartz.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/errors/failures.dart';
import '../entities/application_entity.dart';

abstract class ApplicationRepository {
  Future<Either<Failure, List<ApplicationEntity>>> getMyApplications();
  Future<Either<Failure, ApplicationEntity>> createApplication({
    required String establishmentId,
    required String type,
    required Map<String, dynamic> formData,
    required Map<String, XFile> documents, // key: document_type, value: file
  });
  Future<Either<Failure, ApplicationEntity>> getApplicationById(String id);
  Future<Either<Failure, ApplicationEntity>> updateApplicationStatus(
      String id, String status,
      {String? notes});
  Future<Either<Failure, ApplicationEntity>> submitApplication(String id);
  Future<Either<Failure, Map<String, dynamic>>> getDashboardStats();
  Future<Either<Failure, List<ApplicationEntity>>> getAuditorAssignments();
}
