/// GACP Platform — Map Configuration
///
/// SINGLE SOURCE OF TRUTH for the map tile source the mobile app draws with.
///
/// Why this exists
/// ───────────────
/// A tile request encodes the area being viewed (`{z}/{x}/{y}`), so whoever
/// serves the tiles learns roughly where a Thai farm is — together with the
/// citizen's IP — every time an applicant pins a plot location. Both map
/// screens used to point straight at `tile.openstreetmap.org`, which meant
/// that disclosure happened on every use, to a server outside the country.
///
/// The rule is **fail closed, not fail abroad**: there is deliberately NO
/// built-in default. Whoever builds the app names a tile source they control:
///
///   flutter build apk --dart-define=MAP_TILE_URL=https://tiles.gacpth.com/{z}/{x}/{y}.png
///   flutter build apk --dart-define=MAP_TILE_ATTRIBUTION='กรมการแพทย์แผนไทยและการแพทย์ทางเลือก'
///
/// With nothing configured the map screens say so plainly and keep coordinate
/// entry working, rather than quietly rendering a map from a foreign server.
///
/// This mirrors the web app's `lib/config/map-tiles.ts` — the two platforms
/// must not disagree about where farm locations may be sent.
class MapConfig {
  static const String _tileUrl =
      String.fromEnvironment('MAP_TILE_URL', defaultValue: '');

  static const String _attribution =
      String.fromEnvironment('MAP_TILE_ATTRIBUTION', defaultValue: '');

  /// A usable tile template must address a tile: zoom, column and row.
  static const List<String> _requiredTokens = ['{z}', '{x}', '{y}'];

  /// The configured tile template, or null when no in-country source is set.
  ///
  /// Returns null for unset, blank, or a value that is not a tile template —
  /// a typo'd URL would otherwise render an empty grey map with no
  /// explanation of why.
  static String? get tileUrl {
    final url = _tileUrl.trim();
    if (url.isEmpty) return null;
    for (final token in _requiredTokens) {
      if (!url.contains(token)) return null;
    }
    return url;
  }

  /// Credit line the configured tile source requires. Empty when unset.
  static String get attribution => _attribution.trim();

  /// Whether a map can be drawn at all.
  static bool get isConfigured => tileUrl != null;
}
