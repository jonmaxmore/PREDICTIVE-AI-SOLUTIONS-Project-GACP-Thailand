import 'dart:io';

import 'package:dio/dio.dart';
import 'package:fpdart/fpdart.dart';
import 'package:mobile_app/core/errors/failures.dart';
import 'package:mobile_app/core/network/dio_client.dart';
import '../../domain/entity/establishment_entity.dart';
import '../../domain/repository/establishment_repository.dart';
import '../model/establishment_model.dart';

class EstablishmentRepositoryImpl implements EstablishmentRepository {
  final DioClient _dioClient;

  EstablishmentRepositoryImpl(this._dioClient);

  @override
  Future<Either<Failure, List<EstablishmentEntity>>> getEstablishments() async {
    try {
      final response = await _dioClient.get('/v2/establishments');

      if (response.statusCode == 200 && response.data['success'] == true) {
        final List<dynamic> data = response.data['data'];
        final establishments =
            data.map((e) => EstablishmentModel.fromJson(e).toEntity()).toList();
        return Right(establishments);
      } else {
        return Left(
            ServerFailure(message: response.data['error'] ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'));
      }
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, EstablishmentEntity>> createEstablishment({
    required String name,
    required EstablishmentType type,
    required EstablishmentAddress address,
    required EstablishmentCoordinates coordinates,
    required String titleDeedNo,
    required String security,
    List<File>? images,
  }) async {
    try {
      final Map<String, dynamic> fields = {
        'name': name,
        'type': type.name, // Enum to String
        'address[street]': address.street,
        'address[city]': address.city,
        'address[zipCode]': address.zipCode,
        'coordinates[lat]': coordinates.lat,
        'coordinates[lng]': coordinates.lng,
        'titleDeedNo': titleDeedNo,
        'security': security,
      };

      final formData = FormData.fromMap(fields);

      if (images != null && images.isNotEmpty) {
        for (var file in images) {
          final String fileName = file.path.split('/').last;
          formData.files.add(MapEntry(
            'images',
            await MultipartFile.fromFile(
              file.path,
              filename: fileName,
            ),
          ));
        }
      }

      final response =
          await _dioClient.post('/v2/establishments', data: formData);

      if (response.statusCode == 201 && response.data['success'] == true) {
        final model = EstablishmentModel.fromJson(response.data['data']);
        return Right(model.toEntity());
      } else {
        return Left(ServerFailure(
            message: response.data['error'] ?? 'บันทึกข้อมูลไม่สำเร็จ'));
      }
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> deleteEstablishment(String id) async {
    try {
      final response = await _dioClient.delete('/v2/establishments/$id');

      if (response.statusCode == 200 && response.data['success'] == true) {
        return const Right(null);
      } else {
        return Left(
            ServerFailure(message: response.data['error'] ?? 'ลบข้อมูลไม่สำเร็จ'));
      }
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }
}
