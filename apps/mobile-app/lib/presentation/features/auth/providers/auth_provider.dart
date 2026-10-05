import 'dart:async';
import 'package:image_picker/image_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../../../core/network/dio_client.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../../../data/repositories/auth_repository_impl.dart';
import '../../../../domain/entities/user_entity.dart';
import '../../../../domain/repositories/auth_repository.dart';
import '../../application/providers/form_state_provider.dart';

// 1. Providers for Dependencies
final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return kSecureStorage;
});

final dioClientProvider = Provider<DioClient>((ref) {
  final storage = ref.watch(secureStorageProvider);
  return DioClient(storage);
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final dioClient = ref.watch(dioClientProvider);
  final storage = ref.watch(secureStorageProvider);
  return AuthRepositoryImpl(dioClient, storage);
});

// 2. Auth State
class AuthState {
  final bool isLoading;
  final UserEntity? user;
  final String? error;

  const AuthState({this.isLoading = false, this.user, this.error});

  bool get isAuthenticated => user != null;

  AuthState copyWith({bool? isLoading, UserEntity? user, String? error}) {
    return AuthState(
      isLoading: isLoading ?? this.isLoading,
      user: user ?? this.user,
      error: error,
    );
  }
}

// 3. Auth Notifier
class AuthNotifier extends StateNotifier<AuthState> {
  final AuthRepository _repository;
  final Ref? _ref; // for cross-provider cleanup on logout (nullable for tests)
  // Stream controller to notify GoRouter of auth changes
  final _streamController = StreamController<AuthState>.broadcast();
  @override
  Stream<AuthState> get stream => _streamController.stream;

  AuthNotifier(this._repository, [this._ref]) : super(const AuthState()) {
    checkAuthStatus();
  }

  @override
  set state(AuthState value) {
    super.state = value;
    _streamController.add(value);
  }

  @override
  void dispose() {
    _streamController.close();
    super.dispose();
  }

  Future<void> checkAuthStatus() async {
    state = state.copyWith(isLoading: true);
    final result = await _repository.getCurrentUser();
    result.fold(
      (failure) => state = state.copyWith(isLoading: false, user: null),
      (user) => state = state.copyWith(isLoading: false, user: user),
    );
  }

  Future<void> login(String email, String password) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _repository.login(email, password);
    result.fold(
      (failure) =>
          state = state.copyWith(isLoading: false, error: failure.message),
      (user) => state = state.copyWith(isLoading: false, user: user),
    );
  }

  /// Login with specific account type
  /// [accountType] - INDIVIDUAL, JURISTIC, COMMUNITY_ENTERPRISE
  /// [identifier] - Thai ID, Tax ID, or Community Registration Number
  /// [password] - User password
  Future<void> loginWithAccountType(
    String accountType,
    String identifier,
    String password,
  ) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _repository.loginWithAccountType(
      accountType,
      identifier,
      password,
    );
    result.fold(
      (failure) =>
          state = state.copyWith(isLoading: false, error: failure.message),
      (user) => state = state.copyWith(isLoading: false, user: user),
    );
  }

  Future<void> register(Map<String, dynamic> data, XFile image) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _repository.register(data, image);
    result.fold(
      (failure) =>
          state = state.copyWith(isLoading: false, error: failure.message),
      (_) => state = state.copyWith(isLoading: false),
    );
  }

  /// Register with data only (no image required)
  /// Returns null on success, error message on failure
  Future<String?> registerWithData(Map<String, dynamic> data) async {
    state = state.copyWith(isLoading: true, error: null);
    final result = await _repository.registerWithData(data);
    return result.fold(
      (failure) {
        state = state.copyWith(isLoading: false, error: failure.message);
        return failure.message;
      },
      (_) {
        state = state.copyWith(isLoading: false);
        return null;
      },
    );
  }

  Future<void> logout() async {
    // Clear user state FIRST to trigger immediate auth change notification
    state = const AuthState(isLoading: false, user: null, error: null);
    // PDPA: wipe in-progress wizard state (13-digit national ID, address,
    // phone, doc refs) so it cannot pre-fill for the next account on a
    // shared device.
    try {
      _ref?.read(applicationFormProvider.notifier).resetForm();
    } catch (_) {
      // container tearing down — nothing to wipe
    }
    // Then delete token asynchronously
    await _repository.logout();
  }
}

// 4. Auth Provider
final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return AuthNotifier(repository, ref);
});
