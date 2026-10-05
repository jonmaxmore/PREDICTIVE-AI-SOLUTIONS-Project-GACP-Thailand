import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show debugPrint, kDebugMode;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'app_exception.dart';
import 'log_redactor.dart';
import '../config/api_config.dart';

class DioClient {
  final Dio _dio;
  final FlutterSecureStorage _storage;

  // Use centralized API config - SINGLE SOURCE OF TRUTH
  static String get _baseUrl => ApiConfig.baseUrl;

  DioClient(this._storage)
      : _dio = Dio(
          BaseOptions(
            baseUrl: _baseUrl,
            connectTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 15),
            headers: {
              'Accept': 'application/json',
            },
          ),
        ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          // Add Auth Token
          final token = await _storage.read(key: 'auth_token');
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
        onError: (DioException e, handler) async {
          // Handle 401 Unauthorized
          if (e.response?.statusCode == 401) {
            return handler.reject(DioException(
                requestOptions: e.requestOptions,
                error: UnauthorizedException()));
          }

          // Handle Timeouts
          if (e.type == DioExceptionType.connectionTimeout ||
              e.type == DioExceptionType.receiveTimeout ||
              e.type == DioExceptionType.sendTimeout) {
            return handler.reject(DioException(
                requestOptions: e.requestOptions,
                error: NetworkException(
                    'การเชื่อมต่อหมดเวลา กรุณาตรวจสอบอินเทอร์เน็ต')));
          }

          // Handle No Internet
          if (e.type == DioExceptionType.connectionError) {
            return handler.reject(DioException(
                requestOptions: e.requestOptions,
                error: NetworkException('ไม่มีการเชื่อมต่ออินเทอร์เน็ต')));
          }

          return handler.next(e);
        },
      ),
    );

    // Log Interceptor — DEBUG ONLY, headers never logged (the auth interceptor
    // injects `Authorization: Bearer <JWT>`), and request/response BODIES are
    // routed through redactForLog() so national IDs, passwords and tokens are
    // masked even if a dev signs in with a real account. A release build emits
    // nothing here.
    if (kDebugMode) {
      _dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            debugPrint(
                '[DIO] → ${options.method} ${options.path} ${_bodyForLog(options.data)}');
            return handler.next(options);
          },
          onResponse: (response, handler) {
            debugPrint(
                '[DIO] ← ${response.statusCode} ${response.requestOptions.path} ${_bodyForLog(response.data)}');
            return handler.next(response);
          },
          onError: (e, handler) {
            debugPrint(
                '[DIO] ✗ ${e.response?.statusCode ?? e.type} ${e.requestOptions.path} ${_bodyForLog(e.response?.data)}');
            return handler.next(e);
          },
        ),
      );
    }
    // Retry Interceptor
    _dio.interceptors.add(
      InterceptorsWrapper(
        onError: (DioException e, handler) async {
          // Retry SAFE (idempotent) requests only = GET.
          // SECURITY: auth POSTs (login/register) are deliberately NOT retried.
          // On a network timeout the server may already have processed the
          // request; replaying a login re-counts a wrong password against the
          // backend lockout counter (up to 3× amplification) and replaying a
          // register re-attempts account creation. State-changing POSTs must
          // fail fast and let the user re-initiate.
          final isGetRequest = e.requestOptions.method == 'GET';

          if (isGetRequest && _shouldRetry(e)) {
            final int retries =
                (e.requestOptions.extra['retries'] as int?) ?? 0;
            if (retries < 3) {
              e.requestOptions.extra['retries'] = retries + 1;
              // Exponential Backoff: 1s, 2s, 4s
              await Future.delayed(
                  Duration(milliseconds: 1000 * (1 << retries)));
              try {
                final response = await _dio.request(
                  e.requestOptions.path,
                  options: Options(
                    method: e.requestOptions.method,
                    headers: e.requestOptions.headers,
                    extra: e.requestOptions.extra,
                  ),
                  queryParameters: e.requestOptions.queryParameters,
                  data: e.requestOptions.data,
                );
                return handler.resolve(response);
              } catch (_) {
                // If retry fails, continue to normal error handling
              }
            }
          }
          return handler.next(e);
        },
      ),
    );
  }

  /// Debug-log-safe rendering of a request/response body: JSON bodies go
  /// through the PII redactor; multipart bodies show only their (redacted)
  /// field keys, never file bytes.
  static String _bodyForLog(dynamic data) {
    if (data == null) return '';
    if (data is FormData) {
      final fields = {for (final f in data.fields) f.key: f.value};
      final files = data.files.map((f) => f.key).toList();
      return 'multipart{fields:${redactForLog(fields)}, files:$files}';
    }
    return redactForLog(data);
  }

  bool _shouldRetry(DioException e) {
    return e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.connectionError;
  }

  Future<Response> get(String path,
      {Map<String, dynamic>? queryParameters, Options? options}) async {
    return await _dio.get(path,
        queryParameters: queryParameters, options: options);
  }

  Future<Response> post(String path, {dynamic data}) async {
    return await _dio.post(path, data: data);
  }

  Future<Response> put(String path, {dynamic data}) async {
    return await _dio.put(path, data: data);
  }

  Future<Response> delete(String path, {dynamic data}) async {
    return await _dio.delete(path, data: data);
  }

  Future<Response> patch(String path, {dynamic data}) async {
    return await _dio.patch(path, data: data);
  }
}
