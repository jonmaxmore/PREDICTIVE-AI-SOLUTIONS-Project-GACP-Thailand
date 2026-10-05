import 'package:image_picker/image_picker.dart';
import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';
import '../../core/errors/failures.dart';
import '../../core/network/dio_client.dart';
import '../../domain/entities/establishment_entity.dart';
import '../../domain/repositories/establishment_repository.dart';

class EstablishmentRepositoryImpl implements EstablishmentRepository {
  final DioClient _dioClient;

  EstablishmentRepositoryImpl(this._dioClient);

  @override
  Future<Either<Failure, List<EstablishmentEntity>>> getEstablishments() async {
    try {
      final response =
          await _dioClient.get('/establishments/my-establishments');

      if (response.statusCode == 200) {
        final List<dynamic> data = response.data['data'] ?? [];
        final establishments =
            data.map((item) => EstablishmentEntity.fromJson(item)).toList();

        return Right(establishments);
      } else {
        return const Left(
            ServerFailure(message: 'ไม่สามารถโหลดข้อมูลสถานประกอบการได้ในขณะนี้'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'Network Error'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, EstablishmentEntity>> createEstablishment({
    required String name,
    required String type,
    required String address,
    required double latitude,
    required double longitude,
    required String titleDeedNo,
    required String security,
    XFile? image, // Changed from File
  }) async {
    try {
      final data = {
        'name': name,
        'type': type,
        'address':
            address, // Backend expects top-level address or location.address? Swagger says top-level object. Let's send top-level string to be safe based on 'index.js' line 151 logic.
        // Backend 'index.js' (Line 151) manually constructs location from latitude/longitude.
        // So we MUST send flattened lat/long.
        'latitude': latitude,
        'longitude': longitude,
        'titleDeedNo': titleDeedNo,
        'security': security,
      };

      FormData formData;
      if (image != null) {
        final bytes = await image.readAsBytes();
        formData = FormData.fromMap({
          ...data,
          'image': MultipartFile.fromBytes(bytes, filename: image.name),
        });
      } else {
        formData = FormData.fromMap(data);
      }

      final response = await _dioClient.post('/establishments', data: formData);

      if (response.statusCode == 201 || response.statusCode == 200) {
        return Right(EstablishmentEntity.fromJson(response.data['data']));
      } else {
        return const Left(
            ServerFailure(message: 'บันทึกสถานประกอบการไม่สำเร็จ'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'Network Error'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> deleteEstablishment(String id) async {
    try {
      final response = await _dioClient.delete('/establishments/$id');

      if (response.statusCode == 200) {
        return const Right(null);
      } else {
        return const Left(
            ServerFailure(message: 'ลบสถานประกอบการไม่สำเร็จ'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'Network Error'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }
}
