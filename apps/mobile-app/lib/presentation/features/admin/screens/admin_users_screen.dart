import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// 🍎 Admin Users Screen
/// หน้าจัดการผู้ใช้ - matches /admin/users
class AdminUsersScreen extends StatefulWidget {
  const AdminUsersScreen({super.key});

  @override
  State<AdminUsersScreen> createState() => _AdminUsersScreenState();
}

class _AdminUsersScreenState extends State<AdminUsersScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _searchQuery = '';

  final List<Map<String, dynamic>> _Applicants = [
    {
      'id': '1',
      'name': 'สมชาย ใจดี',
      'idCard': '1234567890123',
      'status': 'active',
      'farms': 2
    },
    {
      'id': '2',
      'name': 'สมหญิง รักษ์ไร่',
      'idCard': '2345678901234',
      'status': 'active',
      'farms': 1
    },
    {
      'id': '3',
      'name': 'สมศักดิ์ ปลูกพืช',
      'idCard': '3456789012345',
      'status': 'suspended',
      'farms': 3
    },
  ];

  final List<Map<String, dynamic>> _PROVIDER = [
    {
      'id': '1',
      'name': 'อรุณ ตรวจสอบ',
      'email': 'reviewer@gacp.go.th',
      'role': 'REVIEWER',
      'status': 'active'
    },
    {
      'id': '2',
      'name': 'วิชัย จัดตาราง',
      'email': 'dispatcher@gacp.go.th',
      'role': 'DISPATCHER',
      'status': 'active'
    },
    {
      'id': '3',
      'name': 'มาลี บัญชี',
      'email': 'accountant@gacp.go.th',
      'role': 'ACCOUNTANT',
      'status': 'active'
    },
  ];

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
    return Scaffold(
      backgroundColor: AppTheme.bgGray,
      appBar: AppBar(
        title: const Text('จัดการผู้ใช้'),
        backgroundColor: Colors.deepPurple,
        foregroundColor: Colors.white,
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: Colors.white,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white60,
          tabs: const [
            Tab(icon: Icon(Icons.agriculture), text: 'เกษตรกร'),
            Tab(icon: Icon(Icons.badge), text: 'เจ้าหน้าที่'),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        backgroundColor: Colors.deepPurple,
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: Column(
        children: [
          // Search bar
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              onChanged: (v) => setState(() => _searchQuery = v),
              decoration: InputDecoration(
                hintText: 'ค้นหา...',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          // Tab content
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildApplicantList(),
                _buildPROVIDERList(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildApplicantList() {
    final filtered = _Applicants
        .where(
            (f) => f['name'].toLowerCase().contains(_searchQuery.toLowerCase()))
        .toList();

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: filtered.length,
      itemBuilder: (context, index) {
        final Applicant = filtered[index];
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: Colors.green.shade100,
              child: Text(Applicant['name'][0],
                  style: TextStyle(color: Colors.green.shade700)),
            ),
            title: Text(Applicant['name'],
                style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle:
                Text('บัตร: ${Applicant['idCard']} • ฟาร์ม: ${Applicant['farms']}'),
            trailing: _buildStatusChip(Applicant['status']),
            onTap: () {},
          ),
        );
      },
    );
  }

  Widget _buildPROVIDERList() {
    final filtered = _PROVIDER
        .where(
            (s) => s['name'].toLowerCase().contains(_searchQuery.toLowerCase()))
        .toList();

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: filtered.length,
      itemBuilder: (context, index) {
        final provider = filtered[index];
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: Colors.blue.shade100,
              child: Text(provider['name'][0],
                  style: TextStyle(color: Colors.blue.shade700)),
            ),
            title: Text(provider['name'],
                style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle:
                Text('${provider['email']} • ${_getRoleLabel(provider['role'])}'),
            trailing: _buildStatusChip(provider['status']),
            onTap: () {},
          ),
        );
      },
    );
  }

  Widget _buildStatusChip(String status) {
    final isActive = status == 'active';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: isActive ? Colors.green.shade50 : Colors.red.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        isActive ? 'ใช้งาน' : 'ระงับ',
        style: TextStyle(
          color: isActive ? Colors.green.shade700 : Colors.red.shade700,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  String _getRoleLabel(String role) {
    switch (role) {
      case 'REVIEWER':
        return 'ผู้ตรวจสอบ';
      case 'SCHEDULER':
        return 'ผู้จัดตาราง';
      case 'ACCOUNTANT':
        return 'บัญชี';
      case 'ADMIN':
        return 'ผู้ดูแล';
      default:
        return role;
    }
  }
}
