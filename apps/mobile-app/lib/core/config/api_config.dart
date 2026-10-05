import 'package:flutter/foundation.dart' show kReleaseMode;

/// GACP Platform — API Configuration
///
/// SINGLE SOURCE OF TRUTH for the backend base URL.
/// The backend mounts its REST API at `/api/v1/*`
/// (see apps/backend/routes/api/index.js). All endpoint paths in the repos are
/// relative to this base, e.g. `/auth/health/login`, `/applications`.
///
/// Override the host at build/run time (no code change needed):
///   flutter run    --dart-define=API_BASE_URL=http://10.0.2.2:8000/api/v1   // Android emulator → local backend
///   flutter run    --dart-define=API_BASE_URL=http://localhost:8000/api/v1  // desktop/web → local backend
///   flutter build  --dart-define=API_BASE_URL=https://staging.gacpth.com/api/v1  // staging build
///
/// Defaults when API_BASE_URL is unset:
///   - debug/profile → STAGING (safe to develop against out of the box)
///   - RELEASE       → PRODUCTION (a forgotten dart-define must never ship an
///     app that sends real farmers' registrations into the staging database)
class ApiConfig {
  static const String _envBase =
      String.fromEnvironment('API_BASE_URL', defaultValue: '');

  static const String _stagingBase = 'https://staging.gacpth.com/api/v1';
  static const String _productionBase = 'https://gacpth.com/api/v1';

  /// Effective backend base URL (already includes the `/api/v1` prefix).
  static String get baseUrl {
    if (_envBase.isNotEmpty) return _envBase;
    return kReleaseMode ? _productionBase : _stagingBase;
  }

  // Timeouts & retry
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 15);
  static const int maxRetries = 3;
}
