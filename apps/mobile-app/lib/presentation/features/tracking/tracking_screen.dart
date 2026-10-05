import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../domain/entities/application_entity.dart';
import '../../../domain/health_dashboard_stage.dart';
import '../application/providers/application_provider.dart';

/// Tracking Screen — wired to the REAL backend (M4b).
///
/// The old implementation called /v2/applications/tracking (guaranteed 404)
/// and assigned `_demoTracking` even on HTTP 200 ("For now use demo") — it
/// was mock regardless of what the backend said. It now renders one progress
/// timeline per application from GET /applications/my (`dashboardStage` +
/// `status` via [applicationProvider]); tapping an application in a payable
/// status routes to the real payment screen (pay1 / pay2).
class TrackingScreen extends ConsumerStatefulWidget {
  const TrackingScreen({super.key});

  @override
  ConsumerState<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends ConsumerState<TrackingScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
        () => ref.read(applicationProvider.notifier).fetchMyApplications());
  }

  Future<void> _refresh() =>
      ref.read(applicationProvider.notifier).fetchMyApplications();

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(applicationProvider);

    Widget body;
    if (state.isLoading && state.myApplications.isEmpty) {
      body = const Center(child: CircularProgressIndicator());
    } else if (state.error != null && state.myApplications.isEmpty) {
      body = _buildErrorState(state.error!);
    } else if (state.myApplications.isEmpty) {
      body = _buildEmptyState();
    } else {
      // Newest application first — same "latest on top" order users expect.
      final apps = [...state.myApplications]
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      body = RefreshIndicator(
        onRefresh: _refresh,
        child: ListView.builder(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          itemCount: apps.length,
          itemBuilder: (context, index) => _buildApplicationSection(apps[index]),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('ติดตามสถานะ'),
        elevation: 0,
      ),
      body: body,
    );
  }

  // ── Per-application section: header card + progress + timeline ──

  Widget _buildApplicationSection(ApplicationEntity app) {
    // round 5: a renewal has its own timeline (one renewal payment step).
    final stepIndex = HealthStageProgress.stepIndexFor(app.dashboardStage,
        isRenewal: app.isRenewal);
    final isComplete = HealthStageProgress.isComplete(app.dashboardStage) ||
        app.hasCertificate;
    // Terminal (REJECTED / EXPIRED / CANCEL_EXPIRED). stepIndex is -1 for
    // these — they are off the timeline, not at the start of it.
    final isClosed = HealthStageProgress.isClosed(app.dashboardStage);
    final payable = HealthStageProgress.isPayable(app.status);

    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildApplicationCard(app, payable),
          const SizedBox(height: 16),
          _buildProgressSection(stepIndex, isComplete, isClosed, app.isRenewal),
          const SizedBox(height: 16),
          _buildTimeline(app, stepIndex, isComplete, payable),
        ],
      ),
    );
  }

  Widget _buildApplicationCard(ApplicationEntity app, bool payable) {
    final title = app.applicationNumber.isNotEmpty
        ? app.applicationNumber
        : 'คำขอ (ยังไม่มีเลขที่)';
    final subtitle = app.plantName.isNotEmpty ? app.plantName : app.serviceType;

    return InkWell(
      onTap: payable
          ? () =>
              context.push(HealthStageProgress.payRoute(app.id, app.status))
          : null,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              Theme.of(context).primaryColor,
              Theme.of(context).primaryColor.withValues(alpha: 0.8),
            ],
          ),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.article, color: Colors.white),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                      if (subtitle.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          subtitle,
                          style: TextStyle(
                            fontSize: 13,
                            color: Colors.white.withValues(alpha: 0.8),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(100),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.schedule,
                          size: 16, color: Colors.white.withValues(alpha: 0.9)),
                      const SizedBox(width: 8),
                      Text(
                        HealthStageProgress.thaiLabelFor(app.dashboardStage,
                            isRenewal: app.isRenewal),
                        style: TextStyle(
                          fontSize: 13,
                          color: Colors.white.withValues(alpha: 0.9),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                if (payable) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(100),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.payments,
                            size: 16, color: Theme.of(context).primaryColor),
                        const SizedBox(width: 6),
                        Text(
                          'ชำระเงิน',
                          style: TextStyle(
                            fontSize: 13,
                            color: Theme.of(context).primaryColor,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressSection(
      int stepIndex, bool isComplete, bool isClosed, bool isRenewal) {
    final total =
        HealthStageProgress.trackingStepsFor(isRenewal: isRenewal).length;
    // A closed file has no position on the ladder. Feeding the -1 straight
    // through produced "-1/7 ขั้นตอน" and a negative progress value.
    final completed =
        isClosed ? 0 : (isComplete ? total : (stepIndex < 0 ? 0 : stepIndex));
    final progress = total == 0 ? 0.0 : completed / total;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'ความคืบหน้า',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              ),
              Text(
                isClosed ? 'คำขอปิดแล้ว' : '$completed/$total ขั้นตอน',
                style: TextStyle(fontSize: 14, color: Colors.grey[600]),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 10,
              backgroundColor: Colors.grey.withValues(alpha: 0.2),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            isClosed
                ? 'คำขอนี้ปิดแล้ว สามารถยื่นคำขอใหม่ได้'
                : '${(progress * 100).toInt()}% เสร็จสิ้น',
            style: TextStyle(
              fontSize: 13,
              color: Theme.of(context).primaryColor,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTimeline(
      ApplicationEntity app, int stepIndex, bool isComplete, bool payable) {
    final steps = HealthStageProgress.trackingStepsFor(isRenewal: app.isRenewal);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'ขั้นตอนการดำเนินการ',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 20),
          ...List.generate(steps.length, (index) {
            final isLast = index == steps.length - 1;
            final completed = isComplete || index < stepIndex;
            final current = !isComplete && index == stepIndex;
            String? note;
            if (current) {
              // `payable` is true only in the two pending-fee states now, so it
              // can be asked first: the slip re-upload case that used to need
              // an earlier, differently-worded branch no longer exists.
              if (payable) {
                note = 'แตะการ์ดด้านบนเพื่อไปหน้าชำระเงิน';
              } else if (app.dashboardStage.toUpperCase() ==
                  'REVISION_REQUIRED') {
                note = 'มีเอกสารต้องแก้ไข โปรดแก้ไขภายใน 5 วันทำการ';
              }
            }
            return _buildTimelineItem(
              title: steps[index].title,
              description: steps[index].description,
              completed: completed,
              current: current,
              note: note,
              isLast: isLast,
            );
          }),
        ],
      ),
    );
  }

  Widget _buildTimelineItem({
    required String title,
    required String description,
    required bool completed,
    required bool current,
    required bool isLast,
    String? note,
  }) {
    final Color color;
    final IconData icon;
    if (completed) {
      color = Colors.green;
      icon = Icons.check_circle;
    } else if (current) {
      color = Theme.of(context).primaryColor;
      icon = Icons.radio_button_checked;
    } else {
      color = Colors.grey;
      icon = Icons.radio_button_unchecked;
    }
    final pending = !completed && !current;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Timeline indicator
          Column(
            children: [
              Icon(icon, color: color, size: 24),
              if (!isLast)
                Expanded(
                  child: Container(
                    width: 2,
                    color: completed
                        ? Colors.green.withValues(alpha: 0.3)
                        : Colors.grey.withValues(alpha: 0.2),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 16),

          // Content
          Expanded(
            child: Container(
              margin: EdgeInsets.only(bottom: isLast ? 0 : 24),
              padding: current ? const EdgeInsets.all(16) : EdgeInsets.zero,
              decoration: current
                  ? BoxDecoration(
                      color: Theme.of(context)
                          .primaryColor
                          .withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                          color: Theme.of(context)
                              .primaryColor
                              .withValues(alpha: 0.2)),
                    )
                  : null,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: pending ? Colors.grey : null,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    description,
                    style: TextStyle(
                      fontSize: 13,
                      color: pending ? Colors.grey[400] : Colors.grey[600],
                    ),
                  ),
                  if (note != null) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.orange.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.info_outline,
                              size: 16, color: Colors.orange),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              note,
                              style: const TextStyle(
                                  fontSize: 12, color: Colors.orange),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState(String error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
            const SizedBox(height: 16),
            const Text(
              'โหลดสถานะคำขอไม่สำเร็จ',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            Text(
              error,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: Colors.grey[600]),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _refresh,
              icon: const Icon(Icons.refresh),
              label: const Text('ลองใหม่'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: Theme.of(context).primaryColor.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Icon(
              Icons.explore,
              size: 40,
              color: Theme.of(context).primaryColor,
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'ยังไม่มีคำขอที่ติดตามได้',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 8),
          Text(
            'ยื่นคำขอรับรองเพื่อติดตามสถานะ',
            style: TextStyle(fontSize: 14, color: Colors.grey[500]),
          ),
        ],
      ),
    );
  }
}
