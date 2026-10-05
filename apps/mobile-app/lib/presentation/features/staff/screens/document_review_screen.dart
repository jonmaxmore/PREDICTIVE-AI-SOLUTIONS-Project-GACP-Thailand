import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../../core/theme/app_theme.dart';

/// Document Review Screen for REVIEWER_AUDITOR
class DocumentReviewScreen extends StatelessWidget {
  const DocumentReviewScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ตรวจเอกสาร'),
        backgroundColor: AppTheme.primary,
        foregroundColor: Colors.white,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildInfoCard(
            icon: LucideIcons.inbox,
            title: 'รอตรวจสอบ',
            count: 12,
            color: Colors.blue,
          ),
          const SizedBox(height: 12),
          _buildInfoCard(
            icon: LucideIcons.clock,
            title: 'รอแก้ไข',
            count: 5,
            color: Colors.orange,
          ),
          const SizedBox(height: 12),
          _buildInfoCard(
            icon: LucideIcons.checkCircle,
            title: 'ผ่านแล้ว',
            count: 48,
            color: Colors.green,
          ),
          const SizedBox(height: 24),
          const Text('งานล่าสุด',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 12),
          ...List.generate(3, (i) => _buildTaskItem(i)),
        ],
      ),
    );
  }

  Widget _buildInfoCard({
    required IconData icon,
    required String title,
    required int count,
    required Color color,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: color.withValues(alpha: 0.1),
              child: Icon(icon, color: color),
            ),
            const SizedBox(width: 16),
            Expanded(
                child: Text(title,
                    style: const TextStyle(fontWeight: FontWeight.w500))),
            Text(
              count.toString(),
              style: TextStyle(
                  fontSize: 24, fontWeight: FontWeight.bold, color: color),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTaskItem(int index) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: AppTheme.primary.withValues(alpha: 0.1),
          child: Text('${index + 1}'),
        ),
        title: Text('REQ-2567-00${10 + index}'),
        subtitle: Text('ส่งเมื่อ ${index + 1} ชั่วโมงก่อน'),
        trailing: const Icon(LucideIcons.chevronRight),
      ),
    );
  }
}
