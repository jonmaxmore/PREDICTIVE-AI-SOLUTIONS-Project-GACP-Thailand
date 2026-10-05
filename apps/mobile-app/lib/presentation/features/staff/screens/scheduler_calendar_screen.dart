import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../../core/theme/app_theme.dart';

/// Scheduler Calendar Screen for SCHEDULER role
class SchedulerCalendarScreen extends StatelessWidget {
  const SchedulerCalendarScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('จัดตารางนัดหมาย'),
        backgroundColor: AppTheme.primary,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(LucideIcons.plus),
            onPressed: () {},
          ),
        ],
      ),
      body: Column(
        children: [
          // Calendar Header
          Container(
            padding: const EdgeInsets.all(16),
            color: Colors.grey[100],
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                IconButton(
                    icon: const Icon(LucideIcons.chevronLeft),
                    onPressed: () {}),
                const Text('ธันวาคม 2567',
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                IconButton(
                    icon: const Icon(LucideIcons.chevronRight),
                    onPressed: () {}),
              ],
            ),
          ),

          // Stats Row
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                _buildStatBox('รอจัดคิว', 8, Colors.orange),
                const SizedBox(width: 12),
                _buildStatBox('นัดแล้ว', 15, Colors.green),
                const SizedBox(width: 12),
                _buildStatBox('วันนี้', 2, Colors.blue),
              ],
            ),
          ),

          const Divider(),

          // Pending Appointments
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('รอจัดคิว',
                    style:
                        TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                TextButton(onPressed: () {}, child: const Text('ดูทั้งหมด')),
              ],
            ),
          ),

          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: 5,
              itemBuilder: (context, index) => _buildPendingItem(index),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatBox(String label, int count, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Column(
          children: [
            Text(
              count.toString(),
              style: TextStyle(
                  fontSize: 24, fontWeight: FontWeight.bold, color: color),
            ),
            Text(label, style: TextStyle(fontSize: 12, color: color)),
          ],
        ),
      ),
    );
  }

  Widget _buildPendingItem(int index) {
    final provinces = ['เชียงใหม่', 'เชียงราย', 'ลำปาง', 'พะเยา', 'น่าน'];
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: Colors.orange.withValues(alpha: 0.1),
              child:
                  const Icon(LucideIcons.clock, color: Colors.orange, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('REQ-2567-00${20 + index}',
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                  Text('จังหวัด ${provinces[index]}',
                      style: TextStyle(color: Colors.grey[600], fontSize: 12)),
                ],
              ),
            ),
            ElevatedButton.icon(
              onPressed: () {},
              icon: const Icon(LucideIcons.calendar, size: 16),
              label: const Text('นัด'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
