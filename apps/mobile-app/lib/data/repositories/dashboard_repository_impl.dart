import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';
import '../../core/errors/failures.dart';
import '../../core/network/dio_client.dart';
import '../../domain/entities/dashboard_stats_entity.dart';
import '../../domain/repositories/dashboard_repository.dart';

class DashboardRepositoryImpl implements DashboardRepository {
  final DioClient _dioClient;

  DashboardRepositoryImpl(this._dioClient);

  @override
  Future<Either<Failure, DashboardStatsEntity>> getDashboardStats() async {
    try {
      final response = await _dioClient.get('/applications/dashboard');

      if (response.statusCode == 200) {
        final data = response.data;
        return Right(DashboardStatsEntity(
          totalApplications: data['total'] ?? 0,
          pendingApplications: data['pending'] ?? 0,
          approvedApplications: data['approved'] ?? 0,
          totalEstablishments: data['totalEstablishments'] ?? 0, // Assuming backend adds this
        ));
      } else {
        return const Left(ServerFailure(message: 'ไม่สามารถโหลดข้อมูลแดชบอร์ดได้ในขณะนี้'));
      }
    } on DioException catch (e) {
      return Left(ServerFailure(message: e.message ?? 'Network Error'));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }
}
