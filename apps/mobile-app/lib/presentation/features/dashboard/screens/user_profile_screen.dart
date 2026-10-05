import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:intl/intl.dart';

// Providers
import '../../auth/providers/auth_provider.dart';
import '../../establishment/providers/establishment_provider.dart';
import '../../application/providers/application_provider.dart';

// Thai display labels for raw status values shown in history rows (display only).
const _historyStatusLabels = {
  'Active': 'ใช้งานอยู่',
  'ACTIVE': 'ใช้งานอยู่',
  'INACTIVE': 'ไม่ได้ใช้งาน',
  'Pending': 'รอตรวจประเมิน',
  'CERTIFIED': 'ได้รับการรับรอง',
  'DRAFT': 'ฉบับร่าง',
  'SUBMITTED': 'ส่งคำขอแล้ว',
  'APPROVED': 'อนุมัติแล้ว',
  'REJECTED': 'ไม่ผ่านการพิจารณา',
  'EXPIRED': 'หมดอายุ',
};

String _historyStatusLabel(String status) =>
    _historyStatusLabels[status] ?? status;

@widgetbook.UseCase(name: 'User Profile', type: UserProfileScreen)
Widget userProfileUseCase(BuildContext context) {
  return const UserProfileScreen();
}

class UserProfileScreen extends ConsumerStatefulWidget {
  const UserProfileScreen({super.key});

  @override
  ConsumerState<UserProfileScreen> createState() => _UserProfileScreenState();
}

class _UserProfileScreenState extends ConsumerState<UserProfileScreen> {
  @override
  void initState() {
    super.initState();
    // Fetch Data on Load
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(establishmentProvider.notifier).loadEstablishments();
      ref.read(applicationProvider.notifier).fetchMyApplications();
      ref.read(authProvider.notifier).checkAuthStatus(); // Refresh user data
    });
  }

  @override
  Widget build(BuildContext context) {
    // Watch Providers
    final authState = ref.watch(authProvider);
    final estState = ref.watch(establishmentProvider);
    final appState = ref.watch(applicationProvider);

    final user = authState.user;

    if (authState.isLoading && user == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (user == null) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('กรุณาเข้าสู่ระบบ (Please Login)'),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () {
                  context.go('/login'); // Navigate to Login Screen
                },
                child: const Text('เข้าสู่ระบบ'),
              )
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('ข้อมูลผู้ใช้งาน (Profile)'),
        elevation: 0,
        backgroundColor: Theme.of(context).primaryColor,
        foregroundColor: Colors.white,
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(establishmentProvider.notifier).loadEstablishments();
          await ref.read(applicationProvider.notifier).fetchMyApplications();
          await ref.read(authProvider.notifier).checkAuthStatus();
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: Column(
            children: [
              // Header Profile
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(24, 32, 24, 48),
                decoration: BoxDecoration(
                  color: Theme.of(context).primaryColor,
                  borderRadius: const BorderRadius.only(
                    bottomLeft: Radius.circular(32),
                    bottomRight: Radius.circular(32),
                  ),
                ),
                child: Column(
                  children: [
                    CircleAvatar(
                      radius: 50,
                      backgroundColor: Colors.white,
                      child: CircleAvatar(
                        radius: 46,
                        backgroundImage:
                            const AssetImage('assets/images/user_avatar.png'),
                        child: user.firstName.isEmpty
                            ? Text((user.email ?? 'U')[0].toUpperCase(),
                                style: const TextStyle(fontSize: 32))
                            : null,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      '${user.firstName} ${user.lastName}',
                      style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.white),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 6),
                      decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.3))),
                      child: Text(
                        user.role,
                        style: const TextStyle(
                            color: Colors.white, fontWeight: FontWeight.w600),
                      ),
                    )
                  ],
                ),
              ),

              const SizedBox(height: 24),

              // Info Sections
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Card(
                  elevation: 2,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        if (user.email != null && user.email!.isNotEmpty)
                          _buildProfileItem(
                              LucideIcons.mail, 'อีเมล (Email)', user.email!),
                        if (user.phoneNumber != null) ...[
                          const Divider(),
                          _buildProfileItem(LucideIcons.phone,
                              'เบอร์โทร (Phone)', user.phoneNumber!),
                        ],
                        if (user.address != null) ...[
                          const Divider(),
                          _buildProfileItem(
                              LucideIcons.mapPin,
                              'ที่อยู่ (Address)',
                              '${user.address} ${user.subdistrict ?? ''} ${user.district ?? ''} ${user.province ?? ''} ${user.zipCode ?? ''}'),
                        ],
                        if (user.registeredAt != null) ...[
                          const Divider(),
                          _buildProfileItem(
                              LucideIcons.calendar,
                              'วันที่ลงทะเบียน',
                              DateFormat('dd MMM yyyy')
                                  .format(user.registeredAt!)),
                        ],
                      ],
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Farm History Section
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'แปลงปลูกของฉัน (My Establishments)',
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 16),
                    if (estState.isLoading)
                      const Center(child: CircularProgressIndicator())
                    else if (estState.establishments.isEmpty)
                      _buildEmptyState(
                          'ยังไม่มีแปลงปลูก', 'กดปุ่ม + เพื่อเพิ่มแปลงปลูก')
                    else
                      ...estState.establishments.map((est) => _buildHistoryItem(
                            icon: LucideIcons.sprout,
                            title: est.name,
                            subtitle: est.address,
                            time: _historyStatusLabel(est.status),
                            color: est.status == 'Active'
                                ? Colors.green
                                : Colors.orange,
                          )),
                  ],
                ),
              ),

              const SizedBox(height: 24),

              // Application History Section
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'ประวัติคำขอ (Applications)',
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 16),
                    if (appState.isLoading)
                      const Center(child: CircularProgressIndicator())
                    else if (appState.myApplications.isEmpty)
                      _buildEmptyState(
                          'ยังไม่มีคำขอ', 'คุณสามารถยื่นคำขอรับรองได้')
                    else
                      ...appState.myApplications.map((app) => _buildHistoryItem(
                            icon: LucideIcons.fileCheck,
                            title: 'คำขอ ${app.type}',
                            subtitle: 'ID: ${app.id.substring(0, 8)}...',
                            time: _historyStatusLabel(app.status),
                            color: _getStatusColor(app.status),
                          )),
                  ],
                ),
              ),

              const SizedBox(height: 48),

              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      await ref.read(authProvider.notifier).logout();
                      if (context.mounted) context.go('/login');
                    },
                    icon: const Icon(LucideIcons.logOut, color: Colors.red),
                    label: const Text('ออกจากระบบ (Logout)',
                        style: TextStyle(color: Colors.red)),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.all(16),
                      side: const BorderSide(color: Colors.red),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 48),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState(String title, String subtitle) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.grey[50],
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey[200]!),
      ),
      child: Column(
        children: [
          Icon(LucideIcons.inbox, size: 48, color: Colors.grey[300]),
          const SizedBox(height: 8),
          Text(title,
              style: TextStyle(
                  color: Colors.grey[600], fontWeight: FontWeight.bold)),
          Text(subtitle,
              style: TextStyle(color: Colors.grey[400], fontSize: 12)),
        ],
      ),
    );
  }

  Color _getStatusColor(String status) {
    switch (status.toUpperCase()) {
      case 'APPROVED':
        return Colors.green;
      case 'REJECTED':
        return Colors.red;
      case 'DRAFT':
        return Colors.grey;
      default:
        return Colors.blue;
    }
  }

  Widget _buildProfileItem(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Colors.grey, size: 20),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: TextStyle(fontSize: 12, color: Colors.grey[600])),
                const SizedBox(height: 4),
                Text(value,
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w500)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHistoryItem({
    required IconData icon,
    required String title,
    required String subtitle,
    required String time,
    required Color color,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.shade100),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16)),
                const SizedBox(height: 4),
                Text(subtitle,
                    style: TextStyle(fontSize: 13, color: Colors.grey[600])),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              time,
              style: TextStyle(
                  color: color, fontSize: 11, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }
}
