import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../presentation/navigation/app_shell.dart';
import '../../presentation/features/establishment/screens/establishment_list_screen.dart';
import '../../presentation/features/establishment/screens/establishment_form_screen.dart';
import '../../presentation/features/dashboard/screens/dashboard_screen.dart';
// Removed: admin and auditor imports (HEALTH_USER-only app)
import '../../presentation/features/auth/screens/login_screen.dart';
import '../../presentation/features/auth/screens/registration_screen.dart';

import '../../presentation/features/application/screens/notification_screen.dart';
import '../../presentation/features/application/screens/service_selection_screen.dart';
import '../../presentation/features/application/screens/guidelines_screen.dart';
// Removed: auditor imports (HEALTH_USER-only app)

import '../../presentation/features/auth/providers/auth_provider.dart';
import '../../presentation/features/application/screens/application_list_screen.dart';

import '../../presentation/features/application/screens/payment_screen.dart';
// Removed: auditor imports (HEALTH_USER-only app)
import '../../presentation/features/application/screens/application_wizard_screen.dart';
import '../../presentation/features/application/screens/wizard_steps/step_0_intro.dart';
import '../../presentation/features/application/screens/wizard_steps/step_1_standards.dart';
import '../../presentation/features/application/screens/wizard_steps/step_2_request_type.dart';
import '../../presentation/features/application/screens/wizard_steps/step_3_terms.dart';
import '../../presentation/features/application/screens/wizard_steps/step_4_application_data.dart';
import '../../presentation/features/application/screens/wizard_steps/step_5_security.dart';
import '../../presentation/features/application/screens/wizard_steps/step_6_production.dart';
import '../../presentation/features/application/screens/wizard_steps/step_7_documents.dart';
import '../../presentation/features/application/screens/wizard_steps/step_8_review.dart';

// New Feature Screens - Synced with Web
import '../../presentation/features/profile/profile_screen.dart';
import '../../presentation/features/tracking/tracking_screen.dart';
import '../../presentation/features/certificates/certificates_screen.dart';
import '../../presentation/features/documents/documents_screen.dart';

// Removed: Provider/staff shell + screens — HEALTH_USER-only app; the staff
// portal is web-only by design. (These imports pointed at deleted files and
// broke the build after the provider→staff rename.)

final _rootNavigatorKey = GlobalKey<NavigatorState>();
final _shellNavigatorKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  final authNotifier = ref.watch(authProvider.notifier);

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/dashboard',
    refreshListenable: GoRouterRefreshStream(authNotifier.stream),
    redirect: (context, state) {
      final isLoggedIn = ref.read(authProvider).isAuthenticated;
      final path = state.fullPath ?? '';

      // Allow login and all register paths without auth. There is no password
      // reset page: nothing is sent by email or SMS (operator 2026-09-16).
      final isAuthPage = path == '/login' || path.startsWith('/register');

      if (!isLoggedIn && !isAuthPage) {
        return '/login';
      }

      if (isLoggedIn && isAuthPage) {
        return '/dashboard';
      }

      return null;
    },
    routes: [
      // Authentication Routes (Outside Shell)
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),

      // Registration Routes - Each step has its own path
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegistrationScreen(initialStep: 0),
      ),
      GoRoute(
        path: '/register/account-type',
        builder: (context, state) => const RegistrationScreen(initialStep: 0),
      ),
      GoRoute(
        path: '/register/identifier',
        builder: (context, state) => const RegistrationScreen(initialStep: 1),
      ),
      GoRoute(
        path: '/register/personal-info',
        builder: (context, state) => const RegistrationScreen(initialStep: 2),
      ),
      GoRoute(
        path: '/register/password',
        builder: (context, state) => const RegistrationScreen(initialStep: 3),
      ),

      // Removed: Provider ShellRoute — HEALTH_USER-only app; the staff portal
      // (reviewer/auditor/accounting/scheduler/admin) is web-only by design.

      // App Shell (HEALTH_USER Routes Only)
      ShellRoute(
        navigatorKey: _shellNavigatorKey,
        builder: (context, state, child) {
          return AppShell(child: child);
        },
        routes: [
          // HEALTH_USER Dashboard
          GoRoute(
            path: '/dashboard',
            builder: (context, state) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/notifications',
            builder: (context, state) => const NotificationScreen(),
          ),
          GoRoute(
            path: '/applications',
            builder: (context, state) => const ApplicationListScreen(),
            routes: [
              GoRoute(
                path: 'new',
                builder: (context, state) => const ServiceSelectionScreen(),
              ),
              // Composite Wizard Route-Based
              ShellRoute(
                builder: (context, state, child) {
                  return ApplicationWizardScreen(state: state, child: child);
                },
                routes: [
                  GoRoute(
                    path: 'create/step0',
                    builder: (context, state) => const Step0PlantSelection(),
                  ),
                  GoRoute(
                    path: 'create/step1',
                    builder: (context, state) => const Step1Standards(),
                  ),
                  GoRoute(
                    path: 'create/step2',
                    builder: (context, state) => const Step2RequestType(),
                  ),
                  GoRoute(
                    path: 'create/step3',
                    builder: (context, state) => const Step3Terms(),
                  ),
                  GoRoute(
                    path: 'create/step4',
                    builder: (context, state) => const Step4ApplicationData(),
                  ),
                  GoRoute(
                    path: 'create/step5',
                    builder: (context, state) => const Step5Security(),
                  ),
                  GoRoute(
                    path: 'create/step6',
                    builder: (context, state) => const Step6Production(),
                  ),
                  GoRoute(
                    path: 'create/step7',
                    builder: (context, state) => const Step7Documents(),
                  ),
                  GoRoute(
                    path: 'create/step8',
                    builder: (context, state) => const Step8Review(),
                  ),
                ],
              ),
              GoRoute(
                path: 'guidelines',
                builder: (context, state) => GuidelinesScreen(
                    requestType: (state.extra as String?) ?? 'NEW'),
              ),
              GoRoute(
                path: ':id/pay1',
                builder: (context, state) {
                  final id = state.pathParameters['id']!;
                  return PaymentScreen(applicationId: id);
                },
              ),
              GoRoute(
                path: ':id/pay2',
                builder: (context, state) {
                  final id = state.pathParameters['id']!;
                  return PaymentScreen(applicationId: id, phase: 'PHASE_2');
                },
              ),
            ],
          ),
          // Establishments (HEALTH_USER feature)
          GoRoute(
            path: '/establishments',
            builder: (context, state) => const EstablishmentListScreen(),
            routes: [
              GoRoute(
                path: 'new',
                builder: (context, state) => const EstablishmentFormScreen(),
              ),
            ],
          ),
          // Profile & Settings
          GoRoute(
            path: '/profile',
            builder: (context, state) => const ProfileScreen(),
          ),
          GoRoute(
            path: '/certificates',
            builder: (context, state) => const CertificatesScreen(),
          ),
          GoRoute(
            path: '/documents',
            builder: (context, state) => const DocumentsScreen(),
          ),
          GoRoute(
            path: '/tracking',
            builder: (context, state) => const TrackingScreen(),
          ),
          GoRoute(
            path: '/payments',
            builder: (context, state) => const PaymentScreen(applicationId: ''),
          ),
        ],
      ),
      // Removed: Auditor Shell and routes (HEALTH_USER-only app)
    ],
  );
});

class GoRouterRefreshStream extends ChangeNotifier {
  GoRouterRefreshStream(Stream<dynamic> stream) {
    notifyListeners();
    _subscription = stream.asBroadcastStream().listen(
          (dynamic _) => notifyListeners(),
        );
  }

  late final StreamSubscription<dynamic> _subscription;

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
