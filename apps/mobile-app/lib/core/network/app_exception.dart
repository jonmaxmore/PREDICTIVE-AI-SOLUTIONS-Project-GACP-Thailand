class AppException implements Exception {
  final String message;
  final String? code;

  AppException(this.message, {this.code});

  @override
  String toString() => message;
}

class NetworkException extends AppException {
  NetworkException(super.message);
}

class UnauthorizedException extends AppException {
  UnauthorizedException() : super('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
}

class ServerException extends AppException {
  ServerException(super.message);
}
