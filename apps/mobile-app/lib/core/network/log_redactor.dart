import 'dart:convert';

/// Redacts PII/secrets from request/response payloads BEFORE they reach the
/// (debug-only) network log. A government app must never emit national IDs,
/// passwords, or bearer tokens to the device log — even in debug, where a dev
/// might sign in with a real account and adb logcat is capturable.
///
/// Pure + deterministic so it can be unit-tested.

/// Keys whose VALUE is replaced wholesale with `***` (case-insensitive).
const Set<String> kSensitiveKeys = {
  'password', 'newpassword', 'oldpassword', 'confirmpassword',
  'idcard', 'id_card', 'identifier', 'healthid', 'health_id',
  'providerid', 'provider_id', 'taxid', 'tax_id',
  'thaicitizenid', 'thai_citizen_id', 'nationalid', 'national_id',
  'communityregistrationno', 'communityregnumber', 'community_reg_number',
  'registrationnumber', 'registration_number', 'lasercode', 'laser_code',
  'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
  'token', 'idtoken', 'id_token', 'customtoken', 'custom_token',
  'csrftoken', 'csrf_token', 'authorization', 'otp', 'secret', 'apikey',
  'api_key',
};

// UUID shield (2026-10-03): each canonical UUID (8-4-4-4-12 hex, either case,
// found left to right) is swapped for a sentinel with no digit and no hex
// letter, the mask runs unchanged, and the UUIDs are put back — so a 13-digit
// run can no longer reach into a UUID (an ID glued after a UUID that ends in
// digits used to take the UUID's last digits with it). Same shield as the
// backend (apps/backend/utils/field-encryption.js). Sentinel: U+F0000, the
// index in U+F0010..U+F0019, U+F0001.
final RegExp _uuidShape = RegExp(
    r'[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}');
final RegExp _sentinel =
    RegExp('\u{F0000}([\u{F0010}-\u{F0019}]+)\u{F0001}', unicode: true);
final RegExp _sentinelChar = RegExp('[\u{F0000}-\u{F0019}]', unicode: true);

String _withUuidsShielded(String s, String Function(String) mask) {
  if (_sentinelChar.hasMatch(s)) return mask(s);
  final uuids = <String>[];
  final swapped = s.replaceAllMapped(_uuidShape, (m) {
    uuids.add(m.group(0)!);
    final index = '${uuids.length - 1}'
        .split('')
        .map((d) => String.fromCharCode(0xF0010 + int.parse(d)))
        .join();
    return '\u{F0000}$index\u{F0001}';
  });
  if (uuids.isEmpty) return mask(s);
  return mask(swapped).replaceAllMapped(_sentinel, (m) {
    final index = m.group(1)!.runes.map((r) => r - 0xF0010).join();
    return uuids[int.parse(index)];
  });
}

String _maskThaiId(String s) {
  // Mask any standalone 13-digit run (Thai national / juristic ID).
  return _withUuidsShielded(
      s,
      (t) => t.replaceAllMapped(RegExp(r'\d{13}'), (m) {
            final d = m.group(0)!;
            return '${d.substring(0, 2)}*********${d.substring(11)}';
          }));
}

Object? _redactValue(Object? data) {
  if (data is Map) {
    final out = <String, dynamic>{};
    data.forEach((k, val) {
      final key = k.toString();
      if (kSensitiveKeys.contains(key.toLowerCase())) {
        out[key] = '***';
      } else {
        out[key] = _redactValue(val);
      }
    });
    return out;
  }
  if (data is Iterable) {
    return data.map(_redactValue).toList();
  }
  if (data is String) {
    return _maskThaiId(data);
  }
  return data; // num / bool / null
}

/// Returns a log-safe string for an arbitrary request/response body.
/// Never throws — falls back to a placeholder on any error.
String redactForLog(Object? data) {
  try {
    if (data == null) return 'null';
    final redacted = _redactValue(data);
    return jsonEncode(redacted);
  } catch (_) {
    return '[unloggable]';
  }
}
