import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/api_config.dart';
import '../storage/secure_storage.dart';
final apiServiceProvider = Provider<ApiService>((ref) => ApiService());

class ApiService {
  late final Dio _dio;
  final _secureStorage = kSecureStorage;
  
  ApiService() {
    _dio = Dio(BaseOptions(
      // Was hardcoded to a second origin this platform does not serve, which
      // silently bypassed ApiConfig — the file that calls itself the single
      // source of truth for the backend base URL. Every call through this
      // client would have failed the moment a screen started using it.
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));
    
    // Add auth interceptor
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _getToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        return handler.next(options);
      },
      onError: (error, handler) async {
        // Handle 401 - try to refresh token
        if (error.response?.statusCode == 401) {
          final refreshed = await _refreshToken();
          if (refreshed) {
            // Retry request
            final token = await _getToken();
            error.requestOptions.headers['Authorization'] = 'Bearer $token';
            return handler.resolve(await _dio.fetch(error.requestOptions));
          }
        }
        return handler.next(error);
      },
    ));
    
    // No LogInterceptor here: the built-in one logs request/response bodies
    // AND headers unredacted. This parallel client is not routed through the
    // redactor, so it must emit nothing to the device log (closes the latent
    // trap where fixing the jwt_token/auth_token key mismatch would print
    // `Authorization: Bearer <JWT>`). Networked logging lives on DioClient,
    // which redacts. See core/network/log_redactor.dart.
  }
  
  Future<ApiResponse> get(String path, {Map<String, dynamic>? queryParameters}) async {
    try {
      final response = await _dio.get(path, queryParameters: queryParameters);
      return ApiResponse.success(response.data);
    } on DioException catch (e) {
      return _handleError(e);
    }
  }
  
  Future<ApiResponse> post(String path, dynamic data) async {
    try {
      final response = await _dio.post(path, data: data);
      return ApiResponse.success(response.data);
    } on DioException catch (e) {
      return _handleError(e);
    }
  }
  
  Future<ApiResponse> put(String path, dynamic data) async {
    try {
      final response = await _dio.put(path, data: data);
      return ApiResponse.success(response.data);
    } on DioException catch (e) {
      return _handleError(e);
    }
  }
  
  Future<ApiResponse> delete(String path) async {
    try {
      final response = await _dio.delete(path);
      return ApiResponse.success(response.data);
    } on DioException catch (e) {
      return _handleError(e);
    }
  }
  
  Future<ApiResponse> upload(String path, FormData formData) async {
    try {
      final response = await _dio.post(
        path,
        data: formData,
        options: Options(contentType: 'multipart/form-data'),
      );
      return ApiResponse.success(response.data);
    } on DioException catch (e) {
      return _handleError(e);
    }
  }
  
  Future<String?> _getToken() async {
    return await _secureStorage.read(key: 'jwt_token');
  }
  
  Future<bool> _refreshToken() async {
    try {
      final refreshToken = await _secureStorage.read(key: 'refresh_token');
      if (refreshToken == null) return false;
      
      final response = await _dio.post('/api/auth/refresh', data: {
        'refreshToken': refreshToken,
      });
      
      if (response.statusCode == 200 && response.data['token'] != null) {
        await _secureStorage.write(
          key: 'jwt_token',
          value: response.data['token'],
        );
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
  
  ApiResponse _handleError(DioException e) {
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout) {
      throw NetworkException('ไม่มีการเชื่อมต่ออินเทอร์เน็ต');
    }
    
    final data = e.response?.data;
    return ApiResponse.error(
      data?['error']?['message'] ?? data?['message'] ?? 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      statusCode: e.response?.statusCode,
    );
  }
}

class ApiResponse {
  final bool success;
  final dynamic data;
  final String? error;
  final int? statusCode;
  
  ApiResponse._({
    required this.success,
    this.data,
    this.error,
    this.statusCode,
  });
  
  factory ApiResponse.success(dynamic data) => 
      ApiResponse._(success: true, data: data);
  
  factory ApiResponse.error(String error, {int? statusCode}) => 
      ApiResponse._(success: false, error: error, statusCode: statusCode);
  
  T? getData<T>(String key) {
    if (data is Map && data.containsKey(key)) {
      return data[key] as T?;
    }
    return null;
  }
}

class NetworkException implements Exception {
  final String message;
  NetworkException(this.message);
  
  @override
  String toString() => message;
}
