import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../../core/theme/app_theme.dart';

/// Audit List Screen for REVIEWER_AUDITOR
class AuditListScreen extends StatelessWidget {
  const AuditListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ตรวจประเมิน'),
        backgroundColor: AppTheme.primary,
        foregroundColor: Colors.white,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildInfoCard(
            icon: LucideIcons.calendar,
            title: 'นัดหมายวันนี้',
            count: 2,
            color: Colors.purple,
          ),
          const SizedBox(height: 12),
          _buildInfoCard(
            icon: LucideIcons.mapPin,
            title: 'รออนุมัติสถานที่',
            count: 4,
            color: Colors.blue,
          ),
          const SizedBox(height: 12),
          _buildInfoCard(
            icon: LucideIcons.fileCheck,
            title: 'รอสรุปผล',
            count: 3,
            color: Colors.orange,
          ),
          const SizedBox(height: 24),
          const Text('การตรวจที่กำลังจะถึง',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 12),
          ...List.generate(3, (i) => _buildAuditItem(i)),
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

  Widget _buildAuditItem(int index) {
    final dates = ['16 ธ.ค. 10:00', '18 ธ.ค. 14:00', '20 ธ.ค. 09:00'];
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: Colors.green,
          child: Icon(LucideIcons.mapPin, color: Colors.white, size: 18),
        ),
        title: Text('แปลง ${index + 1} - นายสมชาย'),
        subtitle: Text(dates[index]),
        trailing: ElevatedButton(
          onPressed: () {},
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTheme.primary,
            foregroundColor: Colors.white,
          ),
          child: const Text('นำทาง'),
        ),
      ),
    );
  }
}
