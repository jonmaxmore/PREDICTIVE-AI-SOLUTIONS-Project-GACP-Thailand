import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../network/dio_client.dart';
import '../storage/secure_storage.dart';

final dioClientProvider = Provider((ref) {
  return DioClient(kSecureStorage);
});
