import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../presentation/features/auth/providers/auth_provider.dart';

/// LifecycleManager
/// Wraps the entire application to listen for OS lifecycle events.
///
/// Goal: Prevent "Zombie State" by re-validating the session when the app resumes.
class LifecycleManager extends ConsumerStatefulWidget {
  final Widget child;

  const LifecycleManager({super.key, required this.child});

  @override
  ConsumerState<LifecycleManager> createState() => _LifecycleManagerState();
}

class _LifecycleManagerState extends ConsumerState<LifecycleManager>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);

    debugPrint('🔄 App Lifecycle Changed: $state');

    switch (state) {
      case AppLifecycleState.resumed:
        _handleAppResumed();
        break;
      case AppLifecycleState.paused:
        _handleAppPaused();
        break;
      case AppLifecycleState.detached:
        _handleAppDetached();
        break;
      case AppLifecycleState.inactive:
        // App is in transition (e.g. notification shade, incoming call)
        break;
      // In Flutter 3.13+, hidden is added.
      // case AppLifecycleState.hidden:
      default:
        break;
    }
  }

  /// Triggered when the app comes to the foreground (from background).
  /// Critical for: Auto-Refresh, Token Validation.
  Future<void> _handleAppResumed() async {
    debugPrint('⚡ App Resumed: Checking Vital Signs...');

    // 1. Validate Session
    // If we are supposed to be logged in, verify the token.
    // Riverpod's authProvider usually holds the User state.
    // Calling `checkAuthStatus` will hit the secure storage or API to verify.
    try {
      await ref.read(authProvider.notifier).checkAuthStatus();
      debugPrint('✅ Vital Signs Stable: Auth Status Verified.');
    } catch (e) {
      debugPrint('❌ Vital Signs Critical: Auth Verification Failed ($e)');
      // In a real scenario, this might trigger a logout if 401.
    }

    // 2. Future: Refresh other critical data (e.g., Notifications, Config)
  }

  /// Triggered when the app goes to the background.
  /// Critical for: Saving State, Security (Blur screen).
  void _handleAppPaused() {
    debugPrint('💤 App Paused: Securing State...');
    // Future: Save Drafts or Clear Clipboard
  }

  void _handleAppDetached() {
    debugPrint('💀 App Detached: Cleaning up...');
  }

  @override
  Widget build(BuildContext context) {
    return widget.child;
  }
}
