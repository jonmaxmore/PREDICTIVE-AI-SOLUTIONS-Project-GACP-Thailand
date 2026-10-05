import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../data/repositories/dashboard_repository_impl.dart';
import '../../../../domain/entities/dashboard_stats_entity.dart';
import '../../../../domain/repositories/dashboard_repository.dart';
import '../../auth/providers/auth_provider.dart'; // To get dioClientProvider

// 1. Repository Provider
final dashboardRepositoryProvider = Provider<DashboardRepository>((ref) {
  final dioClient = ref.watch(dioClientProvider);
  return DashboardRepositoryImpl(dioClient);
});

// 2. State Class
class DashboardState {
  final bool isLoading;
  final DashboardStatsEntity? stats;
  final String? error;

  const DashboardState({
    this.isLoading = false,
    this.stats,
    this.error,
  });

  DashboardState copyWith({
    bool? isLoading,
    DashboardStatsEntity? stats,
    String? error,
  }) {
    return DashboardState(
      isLoading: isLoading ?? this.isLoading,
      stats: stats ?? this.stats,
      error: error,
    );
  }
}

// 3. Notifier
class DashboardNotifier extends StateNotifier<DashboardState> {
  final DashboardRepository _repository;

  DashboardNotifier(this._repository) : super(const DashboardState()) {
    loadStats();
  }

  Future<void> loadStats() async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _repository.getDashboardStats();
    result.fold(
      (failure) => state = state.copyWith(isLoading: false, error: failure.message),
      (data) => state = state.copyWith(isLoading: false, stats: data),
    );
  }
}

// 4. Provider
final dashboardProvider = StateNotifierProvider<DashboardNotifier, DashboardState>((ref) {
  final repository = ref.watch(dashboardRepositoryProvider);
  return DashboardNotifier(repository);
});
