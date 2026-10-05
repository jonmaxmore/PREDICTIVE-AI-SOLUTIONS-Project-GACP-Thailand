import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../features/auth/providers/auth_provider.dart';
import '../features/establishment/providers/establishment_provider.dart';
import '../../core/theme/app_theme.dart';

/// App Shell - Navigation aligned with Next.js Web App
/// 6-item navigation: หน้าหลัก, คำขอ, ใบรับรอง, ติดตาม, การเงิน, โปรไฟล์

class AppShell extends ConsumerWidget {
  final Widget child;

  const AppShell({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Auto-Fetch Data when Authenticated
    ref.listen(authProvider, (previous, next) {
      if ((previous?.isAuthenticated == false || previous == null) &&
          next.isAuthenticated) {
        ref.read(establishmentProvider.notifier).loadEstablishments();
      }
    });

    final screenWidth = MediaQuery.of(context).size.width;
    final isDesktop = screenWidth >= 900;

    if (isDesktop) {
      return _DesktopShell(child: child);
    }
    return _MobileShell(child: child);
  }
}

// Navigation items matching Next.js
class _NavItem {
  final IconData icon;
  final String label;
  final String path;

  const _NavItem({required this.icon, required this.label, required this.path});
}

const _navItems = [
  _NavItem(icon: LucideIcons.home, label: 'หน้าหลัก', path: '/dashboard'),
  _NavItem(icon: LucideIcons.fileText, label: 'คำขอ', path: '/applications'),
  _NavItem(icon: LucideIcons.award, label: 'ใบรับรอง', path: '/certificates'),
  _NavItem(icon: LucideIcons.compass, label: 'ติดตาม', path: '/tracking'),
  _NavItem(icon: LucideIcons.creditCard, label: 'การเงิน', path: '/payments'),
  _NavItem(icon: LucideIcons.user, label: 'โปรไฟล์', path: '/profile'),
];

class _MobileShell extends StatelessWidget {
  final Widget child;
  const _MobileShell({required this.child});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Scaffold(
      body: child,
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: isDark ? AppTheme.darkBg : Colors.white,
          border: Border(
            top: BorderSide(
              color: isDark
                  ? Colors.white.withValues(alpha: 0.08)
                  : Colors.black.withValues(alpha: 0.08),
            ),
          ),
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: _navItems.map((item) {
                final isActive = _isActive(context, item.path);
                return _NavButton(
                  item: item,
                  isActive: isActive,
                  isDark: isDark,
                  onTap: () => context.go(item.path),
                );
              }).toList(),
            ),
          ),
        ),
      ),
    );
  }

  bool _isActive(BuildContext context, String path) {
    final location = GoRouterState.of(context).uri.toString();
    if (path == '/dashboard') return location == '/dashboard';
    return location.startsWith(path);
  }
}

class _NavButton extends StatelessWidget {
  final _NavItem item;
  final bool isActive;
  final bool isDark;
  final VoidCallback onTap;

  const _NavButton({
    required this.item,
    required this.isActive,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final activeColor =
        isDark ? AppTheme.darkGreenAccent : AppTheme.primaryGreen;
    final inactiveColor =
        isDark ? AppTheme.darkInactive : AppTheme.lightInactive;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              item.icon,
              size: 22,
              color: isActive ? activeColor : inactiveColor,
            ),
            const SizedBox(height: 4),
            Text(
              item.label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                color: isActive ? activeColor : inactiveColor,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DesktopShell extends StatelessWidget {
  final Widget child;
  const _DesktopShell({required this.child});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final activeColor =
        isDark ? AppTheme.darkGreenAccent : AppTheme.primaryGreen;

    return Scaffold(
      body: Row(
        children: [
          // Sidebar (72px like Next.js)
          Container(
            width: 72,
            decoration: BoxDecoration(
              color: isDark ? AppTheme.darkBg : Colors.white,
              border: Border(
                right: BorderSide(
                  color: isDark
                      ? Colors.white.withValues(alpha: 0.08)
                      : Colors.black.withValues(alpha: 0.08),
                ),
              ),
            ),
            child: Column(
              children: [
                // Logo
                const SizedBox(height: 20),
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        activeColor,
                        isDark
                            ? AppTheme.darkGreenLight
                            : AppTheme.primaryGreenLight,
                      ],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Center(
                    child: Text(
                      'G',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 32),

                // Nav Items
                Expanded(
                  child: Column(
                    children: _navItems.map((item) {
                      final isActive = _isActive(context, item.path);
                      return _SidebarItem(
                        item: item,
                        isActive: isActive,
                        isDark: isDark,
                        onTap: () => context.go(item.path),
                      );
                    }).toList(),
                  ),
                ),
              ],
            ),
          ),

          // Content
          Expanded(child: child),
        ],
      ),
    );
  }

  bool _isActive(BuildContext context, String path) {
    final location = GoRouterState.of(context).uri.toString();
    if (path == '/dashboard') return location == '/dashboard';
    return location.startsWith(path);
  }
}

class _SidebarItem extends StatelessWidget {
  final _NavItem item;
  final bool isActive;
  final bool isDark;
  final VoidCallback onTap;

  const _SidebarItem({
    required this.item,
    required this.isActive,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final activeColor =
        isDark ? AppTheme.darkGreenAccent : AppTheme.primaryGreen;
    final inactiveColor =
        isDark ? AppTheme.darkInactive : AppTheme.lightInactive;

    return InkWell(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Stack(
          children: [
            // Active indicator
            if (isActive)
              Positioned(
                left: 0,
                top: 6,
                bottom: 6,
                child: Container(
                  width: 3,
                  decoration: BoxDecoration(
                    color: activeColor,
                    borderRadius: const BorderRadius.only(
                      topRight: Radius.circular(3),
                      bottomRight: Radius.circular(3),
                    ),
                  ),
                ),
              ),
            // Icon and label
            Column(
              children: [
                Icon(
                  item.icon,
                  size: 22,
                  color: isActive ? activeColor : inactiveColor,
                ),
                const SizedBox(height: 4),
                Text(
                  item.label,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                    color: isActive ? activeColor : inactiveColor,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
