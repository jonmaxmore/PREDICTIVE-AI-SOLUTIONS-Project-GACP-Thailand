import 'package:fpdart/fpdart.dart';
import 'package:mobile_app/core/errors/failures.dart';
import '../entity/establishment_entity.dart';
import 'dart:io';

abstract class EstablishmentRepository {
  Future<Either<Failure, List<EstablishmentEntity>>> getEstablishments();

  Future<Either<Failure, EstablishmentEntity>> createEstablishment({
    required String name,
    required EstablishmentType type,
    required EstablishmentAddress address,
    required EstablishmentCoordinates coordinates,
    required String titleDeedNo,
    required String security,
    List<File>? images,
  });

  Future<Either<Failure, void>> deleteEstablishment(String id);
}
