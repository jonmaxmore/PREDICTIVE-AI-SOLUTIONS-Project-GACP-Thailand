import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../../core/theme/app_theme.dart';

/// Provider Management Screen for ADMIN role
class PROVIDERManagementScreen extends StatelessWidget {
  const PROVIDERManagementScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('จัดการเจ้าหน้าที่'),
        backgroundColor: AppTheme.primary,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(LucideIcons.userPlus),
            onPressed: () {},
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Role Filter
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildFilterChip('ทั้งหมด', true),
                _buildFilterChip('ผู้ตรวจ', false),
                _buildFilterChip('ผู้จัดตาราง', false),
                _buildFilterChip('บัญชี', false),
                _buildFilterChip('ผู้ดูแล', false),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Provider List
          ...List.generate(6, (i) => _buildPROVIDERItem(i)),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, bool isSelected) {
    return Container(
      margin: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (_) {},
        selectedColor: AppTheme.primary.withValues(alpha: 0.2),
        checkmarkColor: AppTheme.primary,
      ),
    );
  }

  Widget _buildPROVIDERItem(int index) {
    final names = [
      'สมชาย ใจดี',
      'มาลี สดใส',
      'วิชัย สมบูรณ์',
      'สุภา อ่อนโยน',
      'ธนา มั่งมี',
      'ปรีชา เฉลียว'
    ];
    final roles = [
      'REVIEWER_AUDITOR',
      'SCHEDULER',
      'ACCOUNTANT',
      'REVIEWER_AUDITOR',
      'ADMIN',
      'SCHEDULER'
    ];
    final roleColors = {
      'REVIEWER_AUDITOR': Colors.blue,
      'SCHEDULER': Colors.purple,
      'ACCOUNTANT': Colors.green,
      'ADMIN': Colors.orange,
    };

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: AppTheme.primary.withValues(alpha: 0.1),
          child: Text(names[index][0],
              style: const TextStyle(fontWeight: FontWeight.bold)),
        ),
        title: Text(names[index]),
        subtitle: Container(
          margin: const EdgeInsets.only(top: 4),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: (roleColors[roles[index]] ?? Colors.grey)
                      .withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  roles[index],
                  style: TextStyle(
                      fontSize: 10,
                      color: roleColors[roles[index]] ?? Colors.grey),
                ),
              ),
            ],
          ),
        ),
        trailing: PopupMenuButton(
          itemBuilder: (context) => [
            const PopupMenuItem(value: 'edit', child: Text('แก้ไข')),
            const PopupMenuItem(value: 'disable', child: Text('ระงับ')),
          ],
        ),
      ),
    );
  }
}
