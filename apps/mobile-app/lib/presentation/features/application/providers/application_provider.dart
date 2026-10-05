import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/network/dio_client.dart';
import '../../../../data/repositories/application_repository_impl.dart';
import '../../../../domain/entities/application_entity.dart';
import '../../../../domain/repositories/application_repository.dart';
import '../../auth/providers/auth_provider.dart';

// State Class
class ApplicationState {
  final bool isLoading;
  final String? error;
  final String? applicationId;
  // Use Entity for consistent parts, but Map for flexible parts (legacy)
  final Map<String, dynamic>? currentApplication;
  final List<ApplicationEntity> myApplications;
  final List<dynamic> pendingReviews;
  final List<ApplicationEntity> auditorAssignments; // New typed list

  ApplicationState({
    this.isLoading = false,
    this.error,
    this.applicationId,
    this.currentApplication,
    this.myApplications = const [],
    this.pendingReviews = const [],
    this.auditorAssignments = const [],
  });

  ApplicationState copyWith({
    bool? isLoading,
    String? error,
    String? applicationId,
    Map<String, dynamic>? currentApplication,
    List<ApplicationEntity>? myApplications,
    List<dynamic>? pendingReviews,
    List<ApplicationEntity>? auditorAssignments,
  }) {
    return ApplicationState(
      isLoading: isLoading ?? this.isLoading,
      error: error,
      applicationId: applicationId ?? this.applicationId,
      currentApplication: currentApplication ?? this.currentApplication,
      myApplications: myApplications ?? this.myApplications,
      pendingReviews: pendingReviews ?? this.pendingReviews,
      auditorAssignments: auditorAssignments ?? this.auditorAssignments,
    );
  }
}

// Notifier
class ApplicationNotifier extends StateNotifier<ApplicationState> {
  final ApplicationRepository _repository;
  final DioClient _dio; // Keep direct Dio access for legacy methods if needed

  ApplicationNotifier(this._repository, this._dio) : super(ApplicationState());

  // Expose dio for screens that might access it directly (bad pattern but legacy support)
  DioClient get dio => _dio;

  // --- New Methods (Repository Pattern) ---

  Future<void> fetchMyApplications() async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _repository.getMyApplications();
    result.fold(
      (failure) =>
          state = state.copyWith(isLoading: false, error: failure.message),
      (apps) => state = state.copyWith(isLoading: false, myApplications: apps),
    );
  }

  Future<void> fetchApplicationById(String id) async {
    state = state.copyWith(isLoading: true, error: null);
    // Try Repository first
    final result = await _repository.getApplicationById(id);

    result.fold(
      (failure) async {
        // Fallback to old Dio method if Repo fails or not fully implemented for full details
        // But actually, let's trust the logic.
        state = state.copyWith(isLoading: false, error: failure.message);
      },
      (app) => state = state.copyWith(isLoading: false, applicationId: id),
      // Note: currentApplication is Map<String, dynamic>, app is Entity.
      // We might need to fetch raw JSON if screens depend on Map.
      // For now, let's keep the OLD logic for `fetchApplicationById` to match `currentApplication` type
    );

    // Legacy fetch to populate `currentApplication` Map
    try {
      final response = await _dio.get('/v2/applications/$id');
      state = state.copyWith(
        isLoading: false,
        currentApplication: response.data['data'],
        applicationId: id,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  // --- Legacy / Existing Methods (Restored) ---

  Future<void> fetchPendingReviews() async {
    state = state.copyWith(isLoading: true);
    try {
      final response = await _dio.get('/v2/applications/pending-reviews');
      state = state.copyWith(
        isLoading: false,
        pendingReviews: response.data['data'] ?? [],
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  // Stage 1: Create Draft (v2) - Refactored to use Repository and XFile
  Future<bool> createApplication({
    required String establishmentId,
    // Provide defaults or optional for new fields if not passed
    String requestType = 'NEW',
    dynamic
        certificationType, // Changed from String to dynamic to support List<String>
    dynamic objective, // Changed from String to dynamic
    String applicantType = '',
    Map<String, dynamic> applicantInfo = const {},
    Map<String, dynamic> siteInfo = const {},
    required Map<String, dynamic> formData,
    required Map<String, XFile> documents, // Changed to XFile
  }) async {
    if (state.isLoading) return false;
    state = state.copyWith(isLoading: true);

    // Construct the payload for the repository
    final fullFormData = {
      'requestType': requestType,
      'certificationType': certificationType,
      'objective': objective,
      'applicantType': applicantType,
      'applicantInfo': applicantInfo,
      'siteInfo': siteInfo,
      'formData': formData,
    };

    final result = await _repository.createApplication(
      establishmentId: establishmentId,
      type: 'GACP',
      formData: fullFormData,
      documents: documents,
    );

    return result.fold(
      (failure) {
        state = state.copyWith(isLoading: false, error: failure.message);
        return false;
      },
      (app) {
        state = state.copyWith(
          isLoading: false,
          applicationId: app.id,
          // We don't have the full map here, but we have the ID.
          // The UI typically navigates away or fetches details.
          // For consistency with legacy cache, we could fetch, but let's trust the ID for now.
        );
        return true;
      },
    );
  }

  Future<bool> simulateOfficerReview({required bool approve}) async {
    if (state.applicationId == null) return false;
    state = state.copyWith(isLoading: true);
    try {
      await _dio.post(
        '/v2/applications/${state.applicationId}/review',
        data: {'action': approve ? 'APPROVE' : 'REJECT'},
      );
      state = state.copyWith(isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }


  Future<bool> assignAuditor(
      {required String auditorId, required String date}) async {
    if (state.applicationId == null) return false;
    state = state.copyWith(isLoading: true);
    try {
      await _dio.post(
        '/v2/applications/${state.applicationId}/assign-auditor',
        data: {'auditorId': auditorId, 'date': date},
      );
      state = state.copyWith(isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }

  Future<bool> submitAudit({required bool pass, String notes = ''}) async {
    if (state.applicationId == null) return false;
    state = state.copyWith(isLoading: true);
    try {
      await _dio.post(
        '/v2/applications/${state.applicationId}/audit-result',
        data: {'result': pass ? 'PASS' : 'FAIL', 'notes': notes},
      );
      state = state.copyWith(isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      return false;
    }
  }

  // Auditor/Officer Assignment Fetch
  // Auditor assignment fetch
  Future<void> fetchAuditorAssignments() async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _repository.getAuditorAssignments();
    result.fold(
      (failure) =>
          state = state.copyWith(isLoading: false, error: failure.message),
      (apps) =>
          state = state.copyWith(isLoading: false, auditorAssignments: apps),
    );
  }
}

// Provider
final applicationProvider =
    StateNotifierProvider<ApplicationNotifier, ApplicationState>((ref) {
  final dioClient = ref.watch(dioClientProvider);
  final repository = ApplicationRepositoryImpl(dioClient);
  return ApplicationNotifier(repository, dioClient);
});
