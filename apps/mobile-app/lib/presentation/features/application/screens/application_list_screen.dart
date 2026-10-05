import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../domain/entities/application_entity.dart';
import '../providers/application_provider.dart';

class ApplicationListScreen extends ConsumerStatefulWidget {
  const ApplicationListScreen({super.key});

  @override
  ConsumerState<ApplicationListScreen> createState() =>
      _ApplicationListScreenState();
}

class _ApplicationListScreenState extends ConsumerState<ApplicationListScreen> {
  // Thai display labels for raw serviceType enum values (do not change the enum).
  static const _serviceTypeLabels = {
    'NEW': 'ขอใหม่',
    'RENEW': 'ต่ออายุ',
    'RENEWAL': 'ต่ออายุ',
    'AMENDMENT': 'แก้ไขข้อมูล',
    'REPLACEMENT': 'ขอใบแทน',
  };

  static String _serviceTypeLabel(String value) =>
      _serviceTypeLabels[value.toUpperCase()] ?? value;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(applicationProvider.notifier).fetchMyApplications();
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(applicationProvider);
    final applications = state.myApplications;

    return Scaffold(
      appBar: AppBar(
        title: const Text('คำขอของฉัน'),
        actions: [
          IconButton(
            icon: const Icon(LucideIcons.refreshCw),
            onPressed: () =>
                ref.read(applicationProvider.notifier).fetchMyApplications(),
          ),
          const SizedBox(width: 16),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/applications/create/step0'),
        icon: const Icon(LucideIcons.plus),
        label: const Text('ยื่นคำขอใหม่'),
        backgroundColor: AppTheme.primary,
        foregroundColor: Colors.white,
      ),
      body: state.isLoading
          ? const Center(child: CircularProgressIndicator())
          : state.error != null
              ? Center(
                  child: Text(
                      '${state.error} กรุณาลองใหม่อีกครั้ง'))
              : applications.isEmpty
                  ? _buildEmptyState()
                  : LayoutBuilder(
                      builder: (context, constraints) {
                        if (constraints.maxWidth > 800) {
                          return _buildDesktopTable(applications);
                        } else {
                          return _buildMobileList(applications);
                        }
                      },
                    ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(LucideIcons.fileSpreadsheet, size: 64, color: Colors.grey[300]),
          const SizedBox(height: 16),
          Text(
            'ยังไม่มีคำขอ',
            style: TextStyle(fontSize: 18, color: Colors.grey[600]),
          ),
          const SizedBox(height: 8),
          ElevatedButton(
            onPressed: () => context.push('/applications/create/step0'),
            child: const Text('เริ่มยื่นคำขอแรกของคุณ'),
          ),
        ],
      ),
    );
  }

  Widget _buildMobileList(List<ApplicationEntity> applications) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: applications.length,
      itemBuilder: (context, index) {
        final app = applications[index];
        return _buildApplicationCard(app);
      },
    );
  }

  Widget _buildApplicationCard(ApplicationEntity app) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      elevation: 2,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _handleCardTap(app),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header Row: Status + Date
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildStatusBadge(app.status),
                  Text(
                    DateFormat('dd MMM yyyy').format(app.createdAt),
                    style: TextStyle(color: Colors.grey[500], fontSize: 12),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Application number (real /applications/my field)
              Text(
                app.applicationNumber.isNotEmpty
                    ? app.applicationNumber
                    : 'คำขอ (ยังไม่มีเลขที่)',
                style:
                    const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),

              // Plant + service type
              Row(
                children: [
                  const Icon(LucideIcons.sprout, size: 14, color: Colors.green),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      [
                        if (app.plantName.isNotEmpty) app.plantName,
                        if (app.serviceType.isNotEmpty)
                          _serviceTypeLabel(app.serviceType),
                      ].join(' • '),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),

              // Phase 3.6: Digital License
              if (app.status == 'APPROVED') ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                      color: Colors.amber.shade50,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.amber.shade200)),
                  child: const Row(children: [
                    Icon(LucideIcons.award, color: Colors.amber),
                    SizedBox(width: 8),
                    Expanded(
                        child: Text(
                            'ใบรับรอง: PT09-66/0001\n(แตะเพื่อดูใบรับรอง)',
                            style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: Colors.brown)))
                  ]),
                )
              ],

              // Action Button if Action Needed — REAL workflow states
              // (PENDING_DOC_FEE = งวดที่ 1 due, PENDING_AUDIT_FEE = งวดที่ 2).
              // Those two are the ONLY payable states: the slip states that used
              // to be payable as well (so a rejected slip could be re-uploaded)
              // retired with the slip flow on 2026-09-11.
              if (_needsPayment(app.status)) ...[
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => _goToPayment(app.id, app.status),
                    icon: const Icon(LucideIcons.creditCard, size: 16),
                    label: const Text('ชำระเงิน (Pay)'),
                    style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.orange,
                        foregroundColor: Colors.white),
                  ),
                )
              ] else if (app.status == 'REVISION_REQUESTED') ...[
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => context.push(
                        '/applications/create/step1?id=${app.id}'), // Assume edit flow
                    icon: const Icon(LucideIcons.edit, size: 16),
                    label: const Text('แก้ไขคำขอ'),
                    style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.amber[700],
                        foregroundColor: Colors.white),
                  ),
                )
              ]
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDesktopTable(List<ApplicationEntity> applications) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Card(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: DataTable(
            showCheckboxColumn: false,
            columns: const [
              DataColumn(label: Text('สถานประกอบการ')),
              DataColumn(label: Text('ประเภท')),
              DataColumn(label: Text('พืช')),
              DataColumn(label: Text('วันที่')),
              DataColumn(label: Text('สถานะ')),
              DataColumn(label: Text('การดำเนินการ')),
            ],
            rows: applications.map((app) {
              return DataRow(
                onSelectChanged: (_) => _handleCardTap(app),
                cells: [
                  DataCell(Text(app.applicationNumber,
                      style: const TextStyle(fontWeight: FontWeight.bold))),
                  DataCell(Text(_serviceTypeLabel(app.serviceType))),
                  DataCell(Text(app.plantName)),
                  DataCell(
                      Text(DateFormat('dd MMM yyyy').format(app.createdAt))),
                  DataCell(_buildStatusBadge(app.status)),
                  DataCell(_needsPayment(app.status)
                      ? ElevatedButton(
                          onPressed: () => _goToPayment(app.id, app.status),
                          child: const Text('ชำระเงิน'),
                        )
                      : IconButton(
                          icon: const Icon(LucideIcons.chevronRight),
                          onPressed: () => _handleCardTap(app),
                        )),
                ],
              );
            }).toList(),
          ),
        ),
      ),
    );
  }

  Widget _buildStatusBadge(String status) {
    Color color;
    // Real backend workflow states (workflow-transition-service, 20 states).
    switch (status.toUpperCase()) {
      case 'APPROVED':
      case 'CERTIFIED':
      case 'DOC_FEE_PAID':
      case 'AUDIT_FEE_PAID':
      case 'AUDIT_PASSED':
        color = Colors.green;
        break;
      case 'REJECTED':
      case 'EXPIRED':
        color = Colors.red;
        break;
      case 'PENDING_DOC_FEE':
      case 'PENDING_AUDIT_FEE':
        color = Colors.orange;
        break;
      case 'SUBMITTED':
      case 'ASSIGNED_FOR_REVIEW':
      case 'DOC_APPROVED':
      case 'AUDIT_CONFIRMED':
        color = Colors.blue;
        break;
      case 'DRAFT':
      case 'REGISTERED':
        color = Colors.grey;
        break;
      case 'REVISION_REQUESTED':
      case 'CAR_PENDING':
      case 'CAR_REVIEWING':
        color = Colors.deepOrange;
        break;
      default:
        color = Colors.blue;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        status.toUpperCase().replaceAll('_', ' '),
        style:
            TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 10),
      ),
    );
  }

  /// Payment is actionable in the two PENDING fee states, and nowhere else.
  /// Must stay in step with HealthStageProgress._payable.
  static bool _needsPayment(String status) {
    const payable = {
      'PENDING_DOC_FEE',
      'PENDING_AUDIT_FEE',
    };
    return payable.contains(status.toUpperCase());
  }

  void _handleCardTap(ApplicationEntity app) {
    if (_needsPayment(app.status)) {
      _goToPayment(app.id, app.status);
    } else if (app.status == 'REVISION_REQUESTED') {
      context.push('/applications/create/step1?id=${app.id}');
    }
    // Other states: stay on the list — /applications/:id/status is NOT a
    // registered route (tapping it previously landed on GoRouter's error
    // page). A real detail/tracking screen is M4 scope.
  }

  static bool _isPhase2(String status) {
    final s = status.toUpperCase();
    return s == 'PENDING_AUDIT_FEE';
  }

  void _goToPayment(String appId, [String status = '']) {
    context.go(_isPhase2(status)
        ? '/applications/$appId/pay2'
        : '/applications/$appId/pay1');
  }
}
