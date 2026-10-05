import 'package:equatable/equatable.dart';

class DashboardStatsEntity extends Equatable {
  final int totalApplications;
  final int pendingApplications;
  final int approvedApplications;
  final int totalEstablishments;

  const DashboardStatsEntity({
    required this.totalApplications,
    required this.pendingApplications,
    required this.approvedApplications,
    required this.totalEstablishments,
  });

  @override
  List<Object?> get props => [
        totalApplications,
        pendingApplications,
        approvedApplications,
        totalEstablishments,
      ];
}
