import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../auth/providers/auth_provider.dart';
import '../../application/providers/application_provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/theme_provider.dart';
import '../../../../domain/health_dashboard_stage.dart';
import '../dashboard_stats.dart';

/// Dashboard Screen — wired to the REAL backend (M4b).
///
/// The old version hardcoded `totalApplications = 2` etc. Counts are now
/// derived client-side from GET /applications/my via [applicationProvider]
/// (GET /applications/dashboard does NOT exist on the backend), and the
/// status card shows the LATEST application's real number + stage.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  // ต้องเรียงและนับให้ตรงกับ HealthStageProgress._dashboardStep
  // (รอนัด = ขั้นที่ผู้ยื่นจ่ายแล้วแต่ยังไม่มีใครนัดวัน — ก่อนหน้านี้ถูกนับรวมกับ
  // "ตรวจสถานที่" ทำให้จอบอกว่าการตรวจกำลังเกิดขึ้นตั้งแต่เงินเข้า)
  static const _steps = [
    'ยื่นคำขอ',
    'ชำระงวด 1',
    'ตรวจเอกสาร',
    'ชำระงวด 2',
    'รอนัด',
    'ตรวจแปลง',
    'รับรอง'
  ];

  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(applicationProvider.notifier).fetchMyApplications());
  }

  Color _stageColor(String? stage) {
    switch ((stage ?? '').toUpperCase()) {
      case 'CERTIFIED':
      case 'APPROVED':
        return Colors.green;
      case 'REVISION_REQUIRED':
        return Colors.deepOrange;
      case 'PENDING_FEE_PHASE1':
      case 'PENDING_FEE_PHASE2':
        return Colors.orange;
      case 'DRAFT':
        return Colors.grey;
      default:
        return AppTheme.statusSubmitted;
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final appState = ref.watch(applicationProvider);
    final themeNotifier = ref.watch(themeModeProvider.notifier);
    final isDark = ref.watch(themeModeProvider) == ThemeMode.dark;
    final t = DesignTokens.of(context); // Use centralized tokens

    final userName = authState.user?.displayName ?? 'ผู้ใช้';
    final stats = DashboardStats.fromApplications(appState.myApplications);
    final latest = stats.latest;
    final initialLoading =
        appState.isLoading && appState.myApplications.isEmpty;

    return Scaffold(
      backgroundColor: t.bg,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () =>
              ref.read(applicationProvider.notifier).fetchMyApplications(),
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header with Greeting
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 24, 20, 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_getGreeting(),
                              style: TextStyle(
                                  fontSize: 13,
                                  color: t.textMuted,
                                  letterSpacing: 0.05)),
                          const SizedBox(height: 4),
                          Text(userName,
                              style: TextStyle(
                                  fontSize: 26,
                                  fontWeight: FontWeight.w500,
                                  color: t.text,
                                  letterSpacing: -0.01)),
                        ],
                      ),
                      Row(
                        children: [
                          Container(
                            decoration: BoxDecoration(
                                color: t.iconBg,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                    color: t.accent.withValues(alpha: 0.3))),
                            child: IconButton(
                                icon: Icon(
                                    isDark ? LucideIcons.sun : LucideIcons.moon,
                                    color: t.iconColor,
                                    size: 20),
                                onPressed: () => themeNotifier.toggleTheme()),
                          ),
                          const SizedBox(width: 12),
                          ElevatedButton.icon(
                            onPressed: () => context.push('/applications/new'),
                            icon: const Icon(LucideIcons.plus, size: 18),
                            label: const Text('ยื่นคำขอใหม่'),
                            style: ElevatedButton.styleFrom(
                                backgroundColor: t.accent,
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 16, vertical: 12),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12))),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                if (initialLoading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 80),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else ...[
                  if (appState.error != null &&
                      appState.myApplications.isEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                            color: Colors.red.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                                color: Colors.red.withValues(alpha: 0.3))),
                        child: Row(
                          children: [
                            const Icon(Icons.cloud_off,
                                size: 18, color: Colors.red),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'โหลดข้อมูลคำขอไม่สำเร็จ ดึงลงเพื่อลองใหม่',
                                style: TextStyle(
                                    fontSize: 13, color: Colors.red[700]),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                  // Stats Grid (real counts from /applications/my)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: 1.8,
                      children: [
                        _StatCard(
                            icon: LucideIcons.file,
                            label: 'คำขอทั้งหมด',
                            value: stats.total,
                            t: t),
                        _StatCard(
                            icon: LucideIcons.clock,
                            label: 'รอดำเนินการ',
                            value: stats.pending,
                            t: t),
                        _StatCard(
                            icon: LucideIcons.award,
                            label: 'ได้รับรองแล้ว',
                            value: stats.certified,
                            t: t),
                        _StatCard(
                            icon: LucideIcons.alertTriangle,
                            label: 'หมดอายุ',
                            value: stats.expired,
                            t: t),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Current Status Card — latest application, real data
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: latest == null
                        ? Container(
                            padding: const EdgeInsets.all(20),
                            decoration: BoxDecoration(
                                color: t.bgCard,
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: t.border)),
                            child: Row(
                              children: [
                                Icon(LucideIcons.fileText,
                                    size: 20, color: t.textMuted),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    'ยังไม่มีคำขอ เริ่มยื่นคำขอรับรอง GACP ได้เลย',
                                    style: TextStyle(
                                        fontSize: 14, color: t.textMuted),
                                  ),
                                ),
                              ],
                            ),
                          )
                        : Container(
                            padding: const EdgeInsets.all(20),
                            decoration: BoxDecoration(
                                color: t.bgCard,
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: t.border)),
                            child: Row(
                              mainAxisAlignment:
                                  MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text('สถานะปัจจุบัน',
                                            style: TextStyle(
                                                fontSize: 13,
                                                color: t.textMuted,
                                                fontWeight: FontWeight.w500)),
                                        const SizedBox(height: 8),
                                        Text(
                                            latest.applicationNumber.isNotEmpty
                                                ? latest.applicationNumber
                                                : 'ยังไม่มีเลขที่คำขอ',
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                                fontSize: 20,
                                                fontWeight: FontWeight.w500,
                                                color: t.text)),
                                      ]),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 14, vertical: 6),
                                  decoration: BoxDecoration(
                                      color: _stageColor(latest.dashboardStage)
                                          .withValues(alpha: 0.15),
                                      borderRadius: BorderRadius.circular(100),
                                      border: Border.all(
                                          color: _stageColor(
                                                  latest.dashboardStage)
                                              .withValues(alpha: 0.3))),
                                  child: Text(
                                      HealthStageProgress.thaiLabel(
                                          latest.dashboardStage),
                                      style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                          color: _stageColor(
                                              latest.dashboardStage))),
                                ),
                              ],
                            ),
                          ),
                  ),
                  const SizedBox(height: 16),

                  // Step Progress — derived from the latest application's stage
                  if (latest != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: _buildStepProgress(
                          t,
                          HealthStageProgress.dashboardStepForStage(
                              latest.dashboardStage),
                          HealthStageProgress.isComplete(
                                  latest.dashboardStage) ||
                              latest.hasCertificate,
                          HealthStageProgress.isClosed(latest.dashboardStage)),
                    ),
                  if (latest != null) const SizedBox(height: 16),
                ],

                // Quick Links
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                        color: t.bgCard,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: t.border)),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('เมนูด่วน',
                              style: TextStyle(
                                  fontSize: 13,
                                  color: t.textMuted,
                                  fontWeight: FontWeight.w500)),
                          const SizedBox(height: 14),
                          Row(children: [
                            Expanded(
                                child: _QuickLink(
                                    icon: LucideIcons.fileText,
                                    label: 'คำขอของฉัน',
                                    onTap: () => context.push('/applications'),
                                    t: t)),
                            const SizedBox(width: 10),
                            Expanded(
                                child: _QuickLink(
                                    icon: LucideIcons.award,
                                    label: 'ใบรับรอง',
                                    onTap: () => context.push('/certificates'),
                                    t: t)),
                          ]),
                          const SizedBox(height: 10),
                          Row(children: [
                            Expanded(
                                child: _QuickLink(
                                    icon: LucideIcons.compass,
                                    label: 'ติดตามสถานะ',
                                    onTap: () => context.push('/tracking'),
                                    t: t)),
                            const SizedBox(width: 10),
                            Expanded(
                                child: _QuickLink(
                                    icon: LucideIcons.creditCard,
                                    label: 'การชำระเงิน',
                                    onTap: () => context.push('/applications'),
                                    t: t)),
                          ]),
                        ]),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStepProgress(
      dynamic t, int currentStep, bool isComplete, bool isClosed) {
    // isComplete (CERTIFIED) renders every step done; otherwise currentStep
    // is the 1-based active step in the 7-step model. A closed file
    // (REJECTED / EXPIRED / CANCEL_EXPIRED) is off the model entirely and
    // arrives as -1 — drawing it would produce a negative bar.
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
          color: t.bgCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: t.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('ขั้นตอนการดำเนินการ',
            style: TextStyle(
                fontSize: 13, color: t.textMuted, fontWeight: FontWeight.w500)),
        const SizedBox(height: 16),
        ClipRRect(
          borderRadius: BorderRadius.circular(2),
          child: LinearProgressIndicator(
              value: isClosed
                  ? 0.0
                  : (isComplete
                      ? 1.0
                      : (currentStep - 1) / (_steps.length - 1)),
              backgroundColor: t.border,
              valueColor: AlwaysStoppedAnimation(t.accent),
              minHeight: 3),
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: List.generate(_steps.length, (index) {
            final stepNum = index + 1,
                isDone = isComplete || stepNum < currentStep,
                isCurrent = !isComplete && stepNum == currentStep;
            return Expanded(
              child: Column(children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: isDone
                        ? t.accent
                        : isCurrent
                            ? t.accentBg
                            : t.border,
                    borderRadius: BorderRadius.circular(12),
                    border: isCurrent
                        ? Border.all(color: t.accent, width: 2)
                        : null,
                  ),
                  child: Center(
                      child: isDone
                          ? const Icon(LucideIcons.check,
                              color: Colors.white, size: 16)
                          : Text('$stepNum',
                              style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500,
                                  color:
                                      isCurrent ? t.accent : t.textMuted))),
                ),
                const SizedBox(height: 6),
                Text(_steps[index],
                    style: TextStyle(
                        fontSize: 10,
                        color: isCurrent ? t.accent : t.textMuted,
                        fontWeight:
                            isCurrent ? FontWeight.w600 : FontWeight.w400),
                    textAlign: TextAlign.center),
              ]),
            );
          }),
        ),
      ]),
    );
  }

  String _getGreeting() {
    final hour = DateTime.now().hour;
    if (hour >= 5 && hour < 12) return 'สวัสดีตอนเช้า';
    if (hour >= 12 && hour < 17) return 'สวัสดีตอนบ่าย';
    if (hour >= 17 && hour < 21) return 'สวัสดีตอนเย็น';
    return 'สวัสดี';
  }
}

// Stat Card Widget - Uses dynamic token type
class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final int value;
  final dynamic t;
  const _StatCard(
      {required this.icon,
      required this.label,
      required this.value,
      required this.t});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
          color: t.bgCard,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: t.border)),
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Text(label,
                  style: TextStyle(
                      fontSize: 12,
                      color: t.textMuted,
                      fontWeight: FontWeight.w500)),
              Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                      color: t.iconBg,
                      borderRadius: BorderRadius.circular(10),
                      border:
                          Border.all(color: t.accent.withValues(alpha: 0.3))),
                  child: Icon(icon, size: 18, color: t.iconColor)),
            ]),
            Text('$value',
                style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w600,
                    color: t.accent,
                    letterSpacing: -0.02)),
          ]),
    );
  }
}

// Quick Link Widget
class _QuickLink extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final dynamic t;
  const _QuickLink(
      {required this.icon,
      required this.label,
      required this.onTap,
      required this.t});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: t.bg,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: t.border)),
        child: Row(children: [
          Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                  color: t.iconBg,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: t.accent.withValues(alpha: 0.3))),
              child: Icon(icon, size: 16, color: t.iconColor)),
          const SizedBox(width: 10),
          Text(label,
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: t.textSecondary)),
        ]),
      ),
    );
  }
}
