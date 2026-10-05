import 'package:flutter/material.dart';

/// GACP App Theme System
/// Unified design tokens matching Next.js web app
/// Supports Light and Dark modes

class AppTheme {
  // Primary Colors - Green Theme (matching Next.js)
  static const Color primaryGreen = Color(0xFF16A34A);
  static const Color primaryGreenLight = Color(0xFF22C55E);
  static const Color primaryGreenDark = Color(0xFF15803D);

  // Background Colors
  static const Color bgLight = Color(0xFFF5F7FA); // Light gray background
  static const Color bgGray = Color(0xFFF5F5F5); // Neutral gray background

  // Account Type Colors
  static const Color accountIndividual =
      Color(0xFF2E7D32); // Individual - green
  static const Color accountJuristic = Color(0xFF1565C0); // Juristic - blue
  static const Color accountCommunity = Color(0xFF7B1FA2); // Community - purple

  // Info/Blue Colors
  static const Color infoBlue = Color(0xFF2563EB); // Primary blue
  static const Color infoBlueDark = Color(0xFF1E40AF); // Dark blue
  static const Color PROVIDERBlueDark = Color(0xFF0D47A1); // Provider dark blue

  // Success Gradient Colors
  static const Color successLight = Color(0xFFE8F5E9); // Light green bg
  static const Color successTeal = Color(0xFFB2DFDB); // Teal accent

  // Dark Mode Colors
  static const Color darkBg = Color(0xFF0F172A); // Slate 900 - dark background
  static const Color darkGreenAccent =
      Color(0xFF10B981); // Emerald 500 - dark active
  static const Color darkGreenLight =
      Color(0xFF34D399); // Emerald 400 - dark gradient
  static const Color darkInactive =
      Color(0xFF64748B); // Slate 500 - dark inactive
  static const Color lightInactive = Color(0xFF8A8A8A); // Light inactive

  // Text Colors
  static const Color textMuted = Color(0xFF64748B); // Slate 500
  static const Color textEmerald = Color(0xFF047857); // Emerald 700

  // Status Colors
  static const Color statusDraft = Color(0xFF8A8A8A);
  static const Color statusPending = Color(0xFFF59E0B);
  static const Color statusSubmitted = Color(0xFF3B82F6);
  static const Color statusRevision = Color(0xFFEF4444);
  static const Color statusAudit = Color(0xFF8B5CF6);
  static const Color statusScheduled = Color(0xFF06B6D4);
  static const Color statusCertified = Color(0xFF16A34A);

  // Legacy alias for backward compatibility
  static const Color primary = primaryGreen;
  static const Color primaryLight = primaryGreenLight;
  static const Color secondary = Color(0xFFD97706);
  static const Color background = Color(0xFFF8FAF9);
  static const Color surface = Colors.white;
  static const Color error = Color(0xFFEF4444);
  static const Color textMain = Color(0xFF1A1A1A);
  static const Color textSub = Color(0xFF5A5A5A);

  // Light Theme
  static ThemeData get light => lightTheme;

  static ThemeData lightTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    fontFamily: 'Kanit',
    colorScheme: const ColorScheme.light(
      primary: primaryGreen,
      secondary: primaryGreenLight,
      surface: Color(0xFFFFFFFF),
      error: Color(0xFFEF4444),
    ),
    scaffoldBackgroundColor: const Color(0xFFF8FAF9),
    appBarTheme: const AppBarTheme(
      backgroundColor: Color(0xFFFFFFFF),
      foregroundColor: Color(0xFF1A1A1A),
      elevation: 0,
      centerTitle: true,
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.black.withValues(alpha: 0.08)),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          fontFamily: 'Kanit',
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: primaryGreen,
        side: const BorderSide(color: primaryGreen, width: 1.5),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          fontFamily: 'Kanit',
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.grey.shade50,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: Colors.grey.shade200),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: primaryGreen, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFEF4444)),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      labelStyle: TextStyle(color: Colors.grey.shade600),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: Colors.white,
      selectedItemColor: primaryGreen,
      unselectedItemColor: Color(0xFF8A8A8A),
      type: BottomNavigationBarType.fixed,
      elevation: 8,
    ),
    textTheme: const TextTheme(
      headlineLarge: TextStyle(
        fontSize: 28,
        fontWeight: FontWeight.w500,
        color: Color(0xFF1A1A1A),
        letterSpacing: -0.01,
      ),
      headlineMedium: TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.w500,
        color: Color(0xFF1A1A1A),
      ),
      titleLarge: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: Color(0xFF1A1A1A),
      ),
      titleMedium: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w500,
        color: Color(0xFF1A1A1A),
      ),
      bodyLarge: TextStyle(
        fontSize: 15,
        color: Color(0xFF5A5A5A),
      ),
      bodyMedium: TextStyle(
        fontSize: 14,
        color: Color(0xFF5A5A5A),
      ),
      bodySmall: TextStyle(
        fontSize: 12,
        color: Color(0xFF8A8A8A),
      ),
      labelLarge: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: primaryGreen,
      ),
    ),
  );

  // Dark Theme
  static ThemeData darkTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    fontFamily: 'Kanit',
    colorScheme: const ColorScheme.dark(
      primary: Color(0xFF10B981),
      secondary: Color(0xFF34D399),
      surface: Color(0xFF0F172A),
      error: Color(0xFFEF4444),
    ),
    scaffoldBackgroundColor: const Color(0xFF0A0F1C),
    appBarTheme: const AppBarTheme(
      backgroundColor: Color(0xFF0F172A),
      foregroundColor: Color(0xFFF8FAFC),
      elevation: 0,
      centerTitle: true,
    ),
    cardTheme: CardThemeData(
      color: const Color(0xFF0F172A).withValues(alpha: 0.6),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFF10B981),
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          fontFamily: 'Kanit',
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: const Color(0xFF10B981),
        side: const BorderSide(color: Color(0xFF10B981), width: 1.5),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          fontFamily: 'Kanit',
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFF1E293B),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFF10B981), width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFEF4444)),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      labelStyle: const TextStyle(color: Color(0xFF94A3B8)),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: Color(0xFF0F172A),
      selectedItemColor: Color(0xFF10B981),
      unselectedItemColor: Color(0xFF64748B),
      type: BottomNavigationBarType.fixed,
      elevation: 0,
    ),
    textTheme: const TextTheme(
      headlineLarge: TextStyle(
        fontSize: 28,
        fontWeight: FontWeight.w500,
        color: Color(0xFFF8FAFC),
        letterSpacing: -0.01,
      ),
      headlineMedium: TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.w500,
        color: Color(0xFFF8FAFC),
      ),
      titleLarge: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: Color(0xFFF8FAFC),
      ),
      titleMedium: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w500,
        color: Color(0xFFF8FAFC),
      ),
      bodyLarge: TextStyle(
        fontSize: 15,
        color: Color(0xFF94A3B8),
      ),
      bodyMedium: TextStyle(
        fontSize: 14,
        color: Color(0xFF94A3B8),
      ),
      bodySmall: TextStyle(
        fontSize: 12,
        color: Color(0xFF64748B),
      ),
      labelLarge: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: Color(0xFF10B981),
      ),
    ),
  );
}

/// Design Tokens - Convenience getters for use in widgets
class DesignTokens {
  static _LightTokens of(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? const _DarkTokens()
        : const _LightTokens();
  }
}

class _LightTokens {
  const _LightTokens();

  Color get bg => const Color(0xFFF8FAF9);
  Color get bgCard => const Color(0xFFFFFFFF);
  Color get bgCardHover => const Color(0xFFF1F5F3);
  Color get surface => const Color(0xFFFFFFFF);
  Color get border => Colors.black.withValues(alpha: 0.08);
  Color get borderHover => Colors.black.withValues(alpha: 0.15);
  Color get text => const Color(0xFF1A1A1A);
  Color get textSecondary => const Color(0xFF5A5A5A);
  Color get textMuted => const Color(0xFF8A8A8A);
  Color get accent => const Color(0xFF16A34A);
  Color get accentLight => const Color(0xFF22C55E);
  Color get accentBg => const Color(0xFF16A34A).withValues(alpha: 0.08);
  Color get iconBg => const Color(0xFFE5F9E7);
  Color get iconColor => const Color(0xFF16A34A);
}

class _DarkTokens extends _LightTokens {
  const _DarkTokens();

  @override
  Color get bg => const Color(0xFF0A0F1C);
  @override
  Color get bgCard => const Color(0xFF0F172A).withValues(alpha: 0.6);
  @override
  Color get bgCardHover => const Color(0xFF0F172A).withValues(alpha: 0.8);
  @override
  Color get surface => const Color(0xFF0F172A);
  @override
  Color get border => Colors.white.withValues(alpha: 0.08);
  @override
  Color get borderHover => Colors.white.withValues(alpha: 0.15);
  @override
  Color get text => const Color(0xFFF8FAFC);
  @override
  Color get textSecondary => const Color(0xFF94A3B8);
  @override
  Color get textMuted => const Color(0xFF64748B);
  @override
  Color get accent => const Color(0xFF10B981);
  @override
  Color get accentLight => const Color(0xFF34D399);
  @override
  Color get accentBg => const Color(0xFF10B981).withValues(alpha: 0.15);
  @override
  Color get iconBg => const Color(0xFF10B981).withValues(alpha: 0.15);
  @override
  Color get iconColor => const Color(0xFF34D399);
}
