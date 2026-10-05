import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// Admin KPI Screen
/// หน้า KPI Dashboard - matches /admin/kpi
class AdminKpiScreen extends StatelessWidget {
  const AdminKpiScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bgGray,
      appBar: AppBar(
        title: const Text('รายงาน KPI'),
        backgroundColor: Colors.deepPurple,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.download),
            onPressed: () {},
            tooltip: 'ส่งออก PDF',
          ),
          IconButton(
            icon: const Icon(Icons.share),
            onPressed: () {},
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Period selector
            Card(
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const Icon(Icons.calendar_month, color: Colors.deepPurple),
                    const SizedBox(width: 12),
                    const Text('ช่วงเวลา:',
                        style: TextStyle(fontWeight: FontWeight.w500)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: 'q4_2024',
                        decoration: const InputDecoration(
                          border: OutlineInputBorder(),
                          contentPadding:
                              EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        ),
                        items: const [
                          DropdownMenuItem(
                              value: 'q4_2024', child: Text('Q4/2567')),
                          DropdownMenuItem(
                              value: 'q3_2024', child: Text('Q3/2567')),
                          DropdownMenuItem(
                              value: 'q2_2024', child: Text('Q2/2567')),
                        ],
                        onChanged: (v) {},
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // KPI Cards
            _buildKpiCard(
              'อัตราการอนุมัติ',
              '78%',
              'เป้าหมาย: 75%',
              Icons.verified,
              Colors.green,
              0.78,
            ),
            _buildKpiCard(
              'ระยะเวลาดำเนินการเฉลี่ย',
              '12 วัน',
              'เป้าหมาย: 15 วัน',
              Icons.timer,
              Colors.blue,
              0.80,
            ),
            _buildKpiCard(
              'ความพึงพอใจ',
              '4.5/5',
              'เป้าหมาย: 4.0',
              Icons.star,
              Colors.orange,
              0.90,
            ),
            _buildKpiCard(
              'อัตราการต่ออายุ',
              '65%',
              'เป้าหมาย: 60%',
              Icons.autorenew,
              Colors.purple,
              0.85,
            ),
            const SizedBox(height: 24),

            // Performance table
            const Text(
              'ประสิทธิภาพรายบุคคล',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            Card(
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
              child: Column(
                children: [
                  _buildPROVIDERPerformanceRow(
                      'อรุณ ตรวจสอบ', 'ผู้ตรวจสอบ', 45, 0.92),
                  const Divider(height: 1),
                  _buildPROVIDERPerformanceRow(
                      'วิชัย จัดตาราง', 'ผู้จัดตาราง', 38, 0.88),
                  const Divider(height: 1),
                  _buildPROVIDERPerformanceRow('มาลี บัญชี', 'บัญชี', 52, 0.95),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildKpiCard(
    String title,
    String value,
    String target,
    IconData icon,
    Color color,
    double progress,
  ) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: color.withAlpha(26),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, color: color),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: const TextStyle(fontWeight: FontWeight.w500)),
                      Text(target,
                          style: TextStyle(
                              color: Colors.grey.shade600, fontSize: 12)),
                    ],
                  ),
                ),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: progress,
              backgroundColor: Colors.grey.shade200,
              valueColor: AlwaysStoppedAnimation(color),
              minHeight: 8,
              borderRadius: BorderRadius.circular(4),
            ),
            const SizedBox(height: 4),
            Text(
              progress >= 1.0
                  ? 'บรรลุเป้าหมาย'
                  : '${(progress * 100).toInt()}% ของเป้าหมาย',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPROVIDERPerformanceRow(
      String name, String role, int tasks, double score) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: Colors.deepPurple.shade100,
            child: Text(name[0],
                style: TextStyle(color: Colors.deepPurple.shade700)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(role,
                    style:
                        TextStyle(color: Colors.grey.shade600, fontSize: 12)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('$tasks งาน',
                  style: const TextStyle(fontWeight: FontWeight.w500)),
              Row(
                children: [
                  const Icon(Icons.star, size: 14, color: Colors.amber),
                  const SizedBox(width: 4),
                  Text(
                    '${(score * 100).toInt()}%',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}
