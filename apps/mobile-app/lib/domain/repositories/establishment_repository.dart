import 'package:dartz/dartz.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/errors/failures.dart';
import '../entities/establishment_entity.dart';

abstract class EstablishmentRepository {
  Future<Either<Failure, List<EstablishmentEntity>>> getEstablishments();
  Future<Either<Failure, EstablishmentEntity>> createEstablishment({
    required String name,
    required String type,
    required String address,
    required double latitude,
    required double longitude,
    required String titleDeedNo,
    required String security,
    XFile? image, // Changed from File to XFile
  });

  Future<Either<Failure, void>> deleteEstablishment(String id);
}
