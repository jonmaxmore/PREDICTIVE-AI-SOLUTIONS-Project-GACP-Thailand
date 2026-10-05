import 'package:image_picker/image_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:equatable/equatable.dart';
import '../../../../data/repositories/establishment_repository_impl.dart';
import '../../../../domain/entities/establishment_entity.dart';
import '../../../../domain/repositories/establishment_repository.dart';
import '../../../../core/providers/core_providers.dart';

// 1. Repository Provider
final establishmentRepositoryProvider =
    Provider<EstablishmentRepository>((ref) {
  final dioClient = ref.watch(dioClientProvider);
  return EstablishmentRepositoryImpl(dioClient);
});

// 2. State Class
class EstablishmentState extends Equatable {
  final bool isLoading;
  final List<EstablishmentEntity> establishments;
  final String? error;

  // Form State
  final XFile? selectedImage;
  final LatLng? selectedLocation;
  final bool isSuccess;

  const EstablishmentState({
    this.isLoading = false,
    this.establishments = const [],
    this.error,
    this.selectedImage,
    this.selectedLocation,
    this.isSuccess = false,
  });

  EstablishmentState copyWith({
    bool? isLoading,
    List<EstablishmentEntity>? establishments,
    String? error,
    XFile? selectedImage,
    LatLng? selectedLocation,
    bool? isSuccess,
  }) {
    return EstablishmentState(
      isLoading: isLoading ?? this.isLoading,
      establishments: establishments ?? this.establishments,
      error: error, // Reset error if not provided
      selectedImage: selectedImage ?? this.selectedImage,
      selectedLocation: selectedLocation ?? this.selectedLocation,
      isSuccess: isSuccess ?? this.isSuccess,
    );
  }

  @override
  List<Object?> get props => [
        isLoading,
        establishments,
        error,
        selectedImage,
        selectedLocation,
        isSuccess,
      ];
}

// 3. Notifier
class EstablishmentNotifier extends StateNotifier<EstablishmentState> {
  final EstablishmentRepository _repository;

  EstablishmentNotifier(this._repository) : super(const EstablishmentState()) {
    loadEstablishments();
  }

  Future<void> loadEstablishments() async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _repository.getEstablishments();
    result.fold(
      (failure) =>
          state = state.copyWith(isLoading: false, error: failure.message),
      (data) => state = state.copyWith(isLoading: false, establishments: data),
    );
  }

  void setImage(XFile? image) {
    state = state.copyWith(selectedImage: image);
  }

  void setLocation(LatLng? location) {
    state = state.copyWith(selectedLocation: location);
  }

  Future<void> createEstablishment({
    required String name,
    required String type,
    required String address,
    required String titleDeedNo,
    required String security,
  }) async {
    if (state.selectedLocation == null) {
      state = state.copyWith(error: 'กรุณาเลือกตำแหน่งที่ตั้ง');
      return;
    }

    state = state.copyWith(isLoading: true, error: null, isSuccess: false);

    final result = await _repository.createEstablishment(
      name: name,
      type: type,
      address: address,
      latitude: state.selectedLocation!.latitude,
      longitude: state.selectedLocation!.longitude,
      titleDeedNo: titleDeedNo,
      security: security,
      image: state.selectedImage, // Singular
    );

    result.fold(
      (failure) =>
          state = state.copyWith(isLoading: false, error: failure.message),
      (newItem) {
        // Add new item to list and reset form
        final newList = [...state.establishments, newItem];
        state = state.copyWith(
          isLoading: false,
          establishments: newList,
          isSuccess: true,
          selectedImage: null,
          selectedLocation: null,
        );
      },
    );
  }

  Future<void> deleteEstablishment(String id) async {
    state = state.copyWith(isLoading: true, error: null);

    final result = await _repository.deleteEstablishment(id);

    result.fold(
      (failure) =>
          state = state.copyWith(isLoading: false, error: failure.message),
      (_) {
        final newList =
            state.establishments.where((item) => item.id != id).toList();
        state = state.copyWith(
          isLoading: false,
          establishments: newList,
          isSuccess: true,
        );
      },
    );
  }

  void resetForm() {
    state = state.copyWith(
      isSuccess: false,
      error: null,
      selectedImage: null,
      selectedLocation: null,
    );
  }
}

// 4. Provider
final establishmentProvider =
    StateNotifierProvider<EstablishmentNotifier, EstablishmentState>((ref) {
  final repository = ref.watch(establishmentRepositoryProvider);
  return EstablishmentNotifier(repository);
});
