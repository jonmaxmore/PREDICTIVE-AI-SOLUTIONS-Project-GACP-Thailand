import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';
import '../../core/errors/failures.dart';
import '../../core/network/dio_client.dart';
import '../../domain/entities/application_entity.dart';
import '../../domain/repositories/application_repository.dart';

class ApplicationRepositoryImpl implements ApplicationRepository {
  final DioClient _dioClient;

  ApplicationRepositoryImpl(this._dioClient);

  @override
  Future<Either<Failure, List<ApplicationEntity>>> getMyApplications() async {
    try {
      final response = await _dioClient.get('/applications/my');

      if (response.statusCode == 200) {
        final List<dynamic> data = response.data['data'] ?? [];
        final apps = data.map((item) => _mapToEntity(item)).toList();
        return Right(apps);
      } else {
        return const Left(
            ServerFailure(message: 'ไม่สามารถโหลดข้อมูลคำขอได้ในขณะนี้'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'เครือข่ายขัดข้อง กรุณาลองใหม่อีกครั้ง'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, ApplicationEntity>> getApplicationById(
      String id) async {
    try {
      final response = await _dioClient.get('/applications/$id');

      if (response.statusCode == 200) {
        final data = response.data['data'];
        return Right(_mapToEntity(data));
      } else {
        return const Left(
            ServerFailure(message: 'ไม่สามารถโหลดรายละเอียดคำขอได้ในขณะนี้'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'เครือข่ายขัดข้อง กรุณาลองใหม่อีกครั้ง'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, ApplicationEntity>> updateApplicationStatus(
      String id, String status,
      {String? notes}) async {
    try {
      final body = {
        'status': status,
        if (notes != null) 'notes': notes,
      };

      final response =
          await _dioClient.patch('/applications/$id/status', data: body);

      if (response.statusCode == 200) {
        final data = response.data['data'];
        return Right(_mapToEntity(data));
      } else {
        return const Left(
            ServerFailure(message: 'ไม่สามารถอัปเดตสถานะคำขอได้ในขณะนี้'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'เครือข่ายขัดข้อง กรุณาลองใหม่อีกครั้ง'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, ApplicationEntity>> createApplication({
    required String establishmentId,
    required String type,
    required Map<String, dynamic> formData,
    required Map<String, XFile> documents,
  }) async {
    try {
      // Step 0: Fetch Establishment Details (Required for backend 'farm' address)
      // We need this to populate farm.address.province for Officer Assignment
      final estResponse =
          await _dioClient.get('/establishments/$establishmentId');
      Map<String, dynamic> estData = {};
      if (estResponse.statusCode == 200) {
        estData = estResponse.data['data'] ?? {};
      }

      // Step 1: Construct Structured Payload for GACP V2 Backend
      final body = {
        'establishmentId': establishmentId,
        'farmId': establishmentId, // Redundant but safe
        'type': type,

        // Pass through structured GACP Data
        'requestType': formData['requestType'],
        'certificationType': formData['certificationType'],
        'objective': formData['objective'],
        'applicantType': formData['applicantType'],
        'applicantInfo': formData['applicantInfo'],
        'siteInfo': {
          ...(formData['siteInfo'] ?? {}),
          'name': estData['name'], // Fallback/Enrich
          'coordinates': estData['coordinates'],
        },

        // Legacy/Generic Data
        'formData': formData['formData'] ?? {},
      };

      final response = await _dioClient.post('/applications', data: body);

      if (response.statusCode == 201 || response.statusCode == 200) {
        final item = response.data['data'];
        final applicationId = item['applicationId'] ??
            item['_id']; // Handle different response formats

        // Step 2: Upload Documents
        for (var entry in documents.entries) {
          await _uploadDocument(applicationId, entry.key, entry.value);
        }

        // Return a constructed entity (or fetch fresh)
        return Right(ApplicationEntity(
          id: applicationId,
          type: type,
          status: 'Draft', // Initially draft
          establishmentId: establishmentId,
          establishmentName: estData['name'] ?? 'Current Farm',
          // Key fields
          totalArea: formData['totalArea']?.toDouble(),
          cropName: formData['cropName'] ?? '',
          documents: documents.keys.toList(),
          createdAt: DateTime.now(),
        ));
      } else {
        return const Left(
            ServerFailure(message: 'ส่งคำขอไม่สำเร็จ'));
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        return const Left(ServerFailure(message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'));
      }
      return Left(ServerFailure(message: e.message ?? 'เครือข่ายขัดข้อง กรุณาลองใหม่อีกครั้ง'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, ApplicationEntity>> submitApplication(
      String id) async {
    try {
      final response = await _dioClient.post('/applications/$id/submit');

      if (response.statusCode == 200) {
        final data = response.data['data'];
        return Right(_mapToEntity(data));
      } else {
        return const Left(
            ServerFailure(message: 'ส่งคำขอเข้าตรวจสอบไม่สำเร็จ'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'เครือข่ายขัดข้อง กรุณาลองใหม่อีกครั้ง'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  Future<void> _uploadDocument(
      String applicationId, String docType, XFile file) async {
    try {
      final bytes = await file.readAsBytes();
      final FormData formData = FormData.fromMap({
        'document': MultipartFile.fromBytes(bytes, filename: file.name),
      });

      await _dioClient.post(
        '/applications/$applicationId/documents/$docType',
        data: formData,
      );
    } catch (e) {
      debugPrint('Failed to upload document $docType: $e');
      // Continue uploading other documents even if one fails
    }
  }

  /// Maps the REAL `GET /applications/my` row (mapHealthApplication shape,
  /// backend routes/api/helpers/applications-helpers.js): `_id`,
  /// `applicationNumber`, `plantName`, `serviceType`, `status`,
  /// `dashboardStage`, `hasCertificate`, `createdAt`, `submittedAt`. (The old
  /// mapper guessed keys that the endpoint never returns — every card rendered
  /// "Unknown Farm"/"Unknown".)
  ApplicationEntity _mapToEntity(Map<String, dynamic> item) {
    return ApplicationEntity(
      id: (item['_id'] ?? item['id'])?.toString() ?? '',
      type: item['serviceType']?.toString() ?? '',
      status: item['status']?.toString() ?? 'DRAFT',
      establishmentId: '',
      establishmentName: item['plantName']?.toString() ?? '',
      applicationNumber: item['applicationNumber']?.toString() ?? '',
      plantName: item['plantName']?.toString() ?? '',
      serviceType: item['serviceType']?.toString() ?? '',
      dashboardStage: item['dashboardStage']?.toString() ?? '',
      hasCertificate: item['hasCertificate'] == true,
      isRenewal: item['isRenewal'] == true,
      submittedAt: item['submittedAt'] != null
          ? DateTime.tryParse(item['submittedAt'].toString())
          : null,
      documents: const [],
      createdAt:
          DateTime.tryParse(item['createdAt']?.toString() ?? '') ??
              DateTime.now(),
    );
  }

  @override
  Future<Either<Failure, Map<String, dynamic>>> getDashboardStats() async {
    try {
      final response = await _dioClient.get('/applications/stats');

      if (response.statusCode == 200) {
        return Right(response.data['data']);
      } else {
        return const Left(
            ServerFailure(message: 'ไม่สามารถโหลดข้อมูลแดชบอร์ดได้ในขณะนี้'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'เครือข่ายขัดข้อง กรุณาลองใหม่อีกครั้ง'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, List<ApplicationEntity>>>
      getAuditorAssignments() async {
    try {
      final response =
          await _dioClient.get('/applications/auditor/assignments');

      if (response.statusCode == 200) {
        final List<dynamic> data = response.data['data'] ?? [];
        final apps = data.map((item) => _mapToEntity(item)).toList();
        return Right(apps);
      } else {
        return const Left(
            ServerFailure(message: 'ไม่สามารถโหลดข้อมูลงานตรวจประเมินได้ในขณะนี้'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'เครือข่ายขัดข้อง กรุณาลองใหม่อีกครั้ง'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }
}
