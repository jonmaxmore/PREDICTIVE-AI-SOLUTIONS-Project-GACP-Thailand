import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/log_redactor.dart';

void main() {
  group('redactForLog — sensitive keys', () {
    test('password / identifier / idCard values are replaced with ***', () {
      final out = redactForLog({
        'accountType': 'INDIVIDUAL',
        'identifier': '1101700999998',
        'password': 'Test@12345',
        'idCard': '1101700999998',
      });
      expect(out.contains('Test@12345'), isFalse);
      expect(out.contains('1101700999998'), isFalse);
      expect(out.contains('***'), isTrue);
      expect(out.contains('INDIVIDUAL'), isTrue); // non-sensitive preserved
    });

    test('token fields redacted (accessToken/refreshToken/authorization)', () {
      final out = redactForLog({
        'data': {
          'tokens': {'accessToken': 'ey.secret.jwt', 'refreshToken': 'rt.sec'}
        },
        'authorization': 'Bearer ey.secret.jwt',
      });
      expect(out.contains('ey.secret.jwt'), isFalse);
      expect(out.contains('rt.sec'), isFalse);
    });

    test('key matching is case-insensitive', () {
      final out = redactForLog({'Password': 'x', 'IdCard': '1101700999998'});
      expect(out.contains('"Password":"***"'), isTrue);
    });
  });

  group('redactForLog — 13-digit value masking (unkeyed)', () {
    test('a national ID embedded in free text is masked', () {
      final out = redactForLog({
        'note': 'ผู้ยื่นเลข 1101700999998 แจ้งความ',
      });
      expect(out.contains('1101700999998'), isFalse);
      expect(out.contains('11*********98'), isTrue);
    });

    test('12-digit and 14-digit numbers are NOT masked (only exactly 13-run)',
        () {
      final out = redactForLog({'a': '123456789012', 'b': '12345678901234'});
      expect(out.contains('123456789012'), isTrue);
    });
  });

  group('redactForLog — identifiers are never rewritten', () {
    // xorshift32, fixed seed: the same ids on every run.
    int seed = 0x9e3779b9;
    int next() {
      seed ^= (seed << 13) & 0xFFFFFFFF;
      seed ^= seed >> 17;
      seed ^= (seed << 5) & 0xFFFFFFFF;
      return seed;
    }

    String hex(int n) {
      final b = StringBuffer();
      for (var i = 0; i < n; i++) {
        b.write('0123456789abcdef'[next() & 15]);
      }
      return b.toString();
    }

    const reportedUuid = 'c82d4715-4c75-4994-8945-880ab07c5ded';

    // A hex id holding a 13+ digit run IS masked, as on main (an ID glued to
    // hex letters must never leak); every other hex id stays intact.
    final maskable = RegExp(r'\d{13}');
    test('0 of 20000 fixed-seed hex ids (32/64 chars, no 13+ digit run) are changed', () {
      var bad = 0;
      for (var i = 0; i < 10000; i++) {
        for (final len in [32, 64]) {
          var id = hex(len);
          while (maskable.hasMatch(id)) {
            id = hex(len);
          }
          if (redactForLog({'hash': id}) != '{"hash":"$id"}') bad++;
        }
      }
      expect(bad, 0);
    });

    test('0 of 20000 fixed-seed UUIDs are changed', () {
      var bad = 0;
      for (var i = 0; i < 20000; i++) {
        final h = hex(32);
        final id = '${h.substring(0, 8)}-${h.substring(8, 12)}-'
            '4${h.substring(13, 16)}-a${h.substring(17, 20)}-${h.substring(20)}';
        if (redactForLog({'id': id}) != '{"id":"$id"}') bad++;
      }
      expect(bad, 0);
    });

    test('an ObjectId without a 13-digit run is left alone', () {
      const objectId = '5f1d7c2e9a123456789012bb';
      expect(redactForLog({'a': objectId}), '{"a":"$objectId"}');
    });

    test('an ID glued to hex letters or to a UUID is masked, the UUID kept', () {
      const id = '1100000000008';
      const digitEnds = '12345678-4c75-4994-8945-880ab07c5123';
      for (final input in [
        'abc$id', '${id}abc', 'deadbeef$id', 'scan_${id}abc.pdf',
        '$id$reportedUuid', '$reportedUuid$id', '$id$digitEnds', '$digitEnds$id',
      ]) {
        final out = redactForLog({'note': input});
        expect(out.contains(id), isFalse, reason: input);
        if (input.contains(reportedUuid)) expect(out.contains(reportedUuid), isTrue);
        if (input.contains(digitEnds)) expect(out.contains(digitEnds), isTrue);
      }
    });

    test('14- and 15-digit runs are masked', () {
      for (final run in ['11000000000081', '110000000000812']) {
        expect(redactForLog({'n': 'x $run y'}).contains('1100000000008'), isFalse);
      }
    });

    test('a national ID beside a UUID is masked, the UUID kept', () {
      final out = redactForLog({'note': '1101700999998 $reportedUuid'});
      expect(out.contains('1101700999998'), isFalse);
      expect(out.contains('11*********98'), isTrue);
      expect(out.contains(reportedUuid), isTrue);
    });

    test('a national ID glued to hex letters is still masked', () {
      final out = redactForLog({'note': 'fee1101700999998abc'});
      expect(out.contains('1101700999998'), isFalse);
    });
  });

  group('redactForLog — equals main, with UUIDs shielded (round 3)', () {
    // Oracle: main's mask (\d{13} anywhere) run with every canonical UUID
    // swapped out for a digit-free sentinel, then swapped back.
    final uuidShape = RegExp(
        r'[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}');
    String mainMask(String s) => s.replaceAllMapped(RegExp(r'\d{13}'), (m) {
          final d = m.group(0)!;
          return '${d.substring(0, 2)}*********${d.substring(11)}';
        });
    String oracle(String s) {
      final uuids = <String>[];
      final swapped = s.replaceAllMapped(uuidShape, (m) {
        uuids.add(m.group(0)!);
        return '\u{F0000}${'\u{F0010}' * uuids.length}\u{F0001}';
      });
      return mainMask(swapped).replaceAllMapped(
          RegExp('\u{F0000}((?:\u{F0010})+)\u{F0001}', unicode: true),
          (m) => uuids[m.group(1)!.runes.length - 1]);
    }

    int seed = 0xC0FFEE;
    int next() {
      seed ^= (seed << 13) & 0xFFFFFFFF;
      seed ^= seed >> 17;
      seed ^= (seed << 5) & 0xFFFFFFFF;
      return seed;
    }

    String hex(int n) {
      final b = StringBuffer();
      for (var i = 0; i < n; i++) {
        b.write('0123456789abcdef'[next() & 15]);
      }
      return b.toString();
    }

    String digits(int n) {
      final b = StringBuffer('${1 + next() % 9}');
      for (var i = 1; i < n; i++) {
        b.write(next() % 10);
      }
      return b.toString();
    }

    String uuid() {
      final h = (next() % 3 == 0 ? digits(1) : hex(1)) + hex(31);
      final u = '${h.substring(0, 8)}-${h.substring(8, 12)}-4${h.substring(13, 16)}-'
          'a${h.substring(17, 20)}-${h.substring(20)}';
      return next() & 1 == 1 ? u : u.toUpperCase();
    }

    String piece() {
      switch (next() % 7) {
        case 0:
        case 1:
          return uuid();
        case 2:
          return digits(13);
        case 3:
          return hex(32);
        case 4:
          return 'scan_${digits(13)}${hex(3)}.pdf';
        case 5:
          return digits(1 + next() % 20);
        default:
          return 'abc';
      }
    }

    test('10000 fixed-seed inputs: output equals the shielded main mask', () {
      const glues = ['', '', ' ', '-', '/', '_'];
      var diffs = 0;
      String? first;
      for (var i = 0; i < 10000; i++) {
        var s = piece();
        for (var k = 0; k <= next() % 3; k++) {
          s += glues[next() % glues.length] + piece();
        }
        if (redactForLog({'n': s}) != jsonEncode({'n': oracle(s)})) {
          diffs++;
          first ??= s;
        }
      }
      expect(diffs, 0, reason: first);
    });

    test('an ID glued after a UUID that ends in digits: ID masked, UUID kept', () {
      const u = '12345678-4c75-4994-8945-880ab07c5123';
      final out = redactForLog({'n': '${u}1100000000008'});
      expect(out.contains(u), isTrue);
      expect(out.contains('1100000000008'), isFalse);
    });
  });

  group('redactForLog — robustness', () {
    test('nested lists + primitives handled', () {
      final out = redactForLog({
        'plots': [
          {'id': 'p1', 'idCard': '1101700999998'}
        ],
        'count': 2,
        'ok': true,
      });
      expect(out.contains('1101700999998'), isFalse);
      expect(out.contains('"count":2'), isTrue);
    });

    test('null and non-encodable inputs never throw', () {
      expect(redactForLog(null), 'null');
      expect(redactForLog(Object()), isA<String>()); // falls back, no throw
    });
  });
}
