import 'package:dartz/dartz.dart';
import '../../core/errors/failures.dart';
import '../entities/dashboard_stats_entity.dart';

abstract class DashboardRepository {
  Future<Either<Failure, DashboardStatsEntity>> getDashboardStats();
}
