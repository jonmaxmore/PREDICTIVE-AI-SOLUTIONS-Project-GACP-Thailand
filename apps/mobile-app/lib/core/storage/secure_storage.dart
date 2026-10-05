import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Single source of truth for secure-storage options.
///
/// Android uses EncryptedSharedPreferences (Android Keystore-backed) so the
/// auth token / role are encrypted at rest rather than sitting in a plain
/// SharedPreferences file readable on a rooted or backed-up device.
///
/// ⚠️ EVERY construction site MUST use this constant. Mixing encrypted and
/// default options on Android splits the backing store — a token written by an
/// `encryptedSharedPreferences: true` instance is UNREADABLE by a default one
/// (and vice-versa), which would silently log users out on the next request.
///
/// Safe to enable now: the app has never been distributed, so there are no
/// pre-existing plaintext entries that would need migrating.
const FlutterSecureStorage kSecureStorage = FlutterSecureStorage(
  aOptions: AndroidOptions(encryptedSharedPreferences: true),
);
