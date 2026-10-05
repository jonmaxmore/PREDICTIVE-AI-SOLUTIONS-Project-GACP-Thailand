import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../../core/theme/app_theme.dart';
import '../../auth/providers/auth_provider.dart';

/// Provider Dashboard Screen
/// Role-based dashboard for REVIEWER_AUDITOR, SCHEDULER, ACCOUNTANT, ADMIN
class PROVIDERDashboardScreen extends ConsumerStatefulWidget {
  const PROVIDERDashboardScreen({super.key});

  @override
  ConsumerState<PROVIDERDashboardScreen> createState() =>
      _PROVIDERDashboardScreenState();
}

class _PROVIDERDashboardScreenState extends ConsumerState<PROVIDERDashboardScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Role labels
  static const Map<String, Map<String, dynamic>> roleLabels = {
    'REVIEWER_AUDITOR': {
      'label': 'ผู้ตรวจเอกสาร/ตรวจประเมิน',
      'icon': LucideIcons.clipboardCheck
    },
    'SCHEDULER': {'label': 'เจ้าหน้าที่จัดคิว', 'icon': LucideIcons.calendar},
    'ACCOUNTANT': {'label': 'พนักงานบัญชี', 'icon': LucideIcons.wallet},
    'ADMIN': {'label': 'ผู้ดูแลระบบ', 'icon': LucideIcons.settings},
    'SUPER_ADMIN': {'label': 'ผู้ดูแลสูงสุด', 'icon': LucideIcons.shield},
  };

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final user = authState.user;
    final role = user?.role ?? 'REVIEWER_AUDITOR';
    final roleInfo = roleLabels[role] ?? roleLabels['REVIEWER_AUDITOR']!;

    return Scaffold(
      backgroundColor: AppTheme.bgLight,
      appBar: AppBar(
        title: const Text('แดชบอร์ดเจ้าหน้าที่'),
        backgroundColor: AppTheme.primary,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(LucideIcons.bell),
            onPressed: () {},
          ),
          IconButton(
            icon: const Icon(LucideIcons.logOut),
            onPressed: _handleLogout,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: Colors.white,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          tabs: const [
            Tab(icon: Icon(LucideIcons.fileText), text: 'งานตรวจเอกสาร'),
            Tab(icon: Icon(LucideIcons.clipboardCheck), text: 'งานตรวจประเมิน'),
          ],
        ),
      ),
      body: Column(
        children: [
          // User Info Header
          Container(
            padding: const EdgeInsets.all(16),
            color: AppTheme.primary.withValues(alpha: 0.1),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: AppTheme.primary,
                  child:
                      Icon(roleInfo['icon'] as IconData, color: Colors.white),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${user?.firstName ?? ''} ${user?.lastName ?? ''}'
                                .trim()
                                .isEmpty
                            ? 'เจ้าหน้าที่'
                            : '${user?.firstName ?? ''} ${user?.lastName ?? ''}',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      Text(
                        roleInfo['label'] as String,
                        style: TextStyle(
                          color: Colors.grey[600],
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.primary,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    role,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Tab Content
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildDocumentTab(),
                _buildAuditTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDocumentTab() {
    // Mock pending documents
    final pendingDocs = [
      {
        'id': 'REQ-2567-0012',
        'name': 'นายสมชาย ใจดี',
        'plant': 'กัญชา',
        'count': 1,
        'wait': '2 ชั่วโมง'
      },
      {
        'id': 'REQ-2567-0015',
        'name': 'บริษัท สมุนไพรไทย จำกัด',
        'plant': 'กระท่อม',
        'count': 2,
        'wait': '1 วัน'
      },
      {
        'id': 'REQ-2567-0018',
        'name': 'วิสาหกิจชุมชนบ้านป่า',
        'plant': 'ขมิ้นชัน',
        'count': 3,
        'wait': '2 วัน'
      },
    ];

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: pendingDocs.length,
      itemBuilder: (context, index) {
        final doc = pendingDocs[index];
        final count = doc['count'] as int;

        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () {
              // TODO: Navigate to document review
            },
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        doc['id'] as String,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppTheme.primary,
                        ),
                      ),
                      _getSubmissionBadge(count),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    doc['name'] as String,
                    style: const TextStyle(fontWeight: FontWeight.w500),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(LucideIcons.sprout,
                          size: 14, color: Colors.grey[600]),
                      const SizedBox(width: 4),
                      Text(doc['plant'] as String,
                          style: TextStyle(color: Colors.grey[600])),
                      const Spacer(),
                      Icon(LucideIcons.clock,
                          size: 14, color: Colors.grey[500]),
                      const SizedBox(width: 4),
                      Text(doc['wait'] as String,
                          style:
                              TextStyle(color: Colors.grey[500], fontSize: 12)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {},
                          icon: const Icon(LucideIcons.eye, size: 16),
                          label: const Text('ดูรายละเอียด'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppTheme.primary,
                            side: BorderSide(color: AppTheme.primary),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: () {},
                          icon: const Icon(LucideIcons.checkCircle, size: 16),
                          label: const Text('ตรวจสอบ'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.primary,
                            foregroundColor: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _getSubmissionBadge(int count) {
    if (count == 1) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: Colors.green.shade100,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text('ครั้งแรก',
            style: TextStyle(
                fontSize: 10,
                color: Colors.green.shade700,
                fontWeight: FontWeight.bold)),
      );
    } else if (count == 2) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: Colors.amber.shade100,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text('แก้ไขรอบ 1',
            style: TextStyle(
                fontSize: 10,
                color: Colors.amber.shade700,
                fontWeight: FontWeight.bold)),
      );
    } else {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: Colors.red.shade100,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text('แก้ไขรอบ 2',
            style: TextStyle(
                fontSize: 10,
                color: Colors.red.shade700,
                fontWeight: FontWeight.bold)),
      );
    }
  }

  Widget _buildAuditTab() {
    // Mock pending audits
    final pendingAudits = [
      {
        'id': 'REQ-2567-0010',
        'name': 'นายวิชัย สมบูรณ์',
        'plant': 'ขิง',
        'status': 'WAITING_SCHEDULE',
        'wait': '3 วัน'
      },
      {
        'id': 'REQ-2567-0008',
        'name': 'กลุ่มเกษตรอินทรีย์',
        'plant': 'กระชายดำ',
        'status': 'SCHEDULED',
        'wait': '5 ธ.ค. 10:00'
      },
      {
        'id': 'REQ-2567-0005',
        'name': 'นางมะลิ ใจงาม',
        'plant': 'ไพล',
        'status': 'WAITING_RESULT',
        'wait': 'เลยกำหนด'
      },
    ];

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: pendingAudits.length,
      itemBuilder: (context, index) {
        final audit = pendingAudits[index];

        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () {},
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        audit['id'] as String,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppTheme.primary,
                        ),
                      ),
                      _getAuditStatusBadge(audit['status'] as String),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    audit['name'] as String,
                    style: const TextStyle(fontWeight: FontWeight.w500),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(LucideIcons.sprout,
                          size: 14, color: Colors.grey[600]),
                      const SizedBox(width: 4),
                      Text(audit['plant'] as String,
                          style: TextStyle(color: Colors.grey[600])),
                      const Spacer(),
                      Icon(LucideIcons.clock,
                          size: 14, color: Colors.grey[500]),
                      const SizedBox(width: 4),
                      Text(
                        audit['wait'] as String,
                        style: TextStyle(
                          color: (audit['wait'] as String).contains('เลยกำหนด')
                              ? Colors.red
                              : Colors.grey[500],
                          fontSize: 12,
                          fontWeight:
                              (audit['wait'] as String).contains('เลยกำหนด')
                                  ? FontWeight.bold
                                  : FontWeight.normal,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _getAuditStatusBadge(String status) {
    Color color;
    String label;

    switch (status) {
      case 'WAITING_SCHEDULE':
        color = Colors.blue;
        label = 'รอจัดคิว';
        break;
      case 'SCHEDULED':
        color = Colors.purple;
        label = 'นัดหมายแล้ว';
        break;
      case 'WAITING_RESULT':
        color = Colors.orange;
        label = 'รอผล';
        break;
      default:
        color = Colors.grey;
        label = status;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 10, color: color, fontWeight: FontWeight.bold)),
    );
  }

  void _handleLogout() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ออกจากระบบ'),
        content: const Text('คุณต้องการออกจากระบบหรือไม่?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('ยกเลิก'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              ref.read(authProvider.notifier).logout();
              context.go('/login');
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child:
                const Text('ออกจากระบบ', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }
}
