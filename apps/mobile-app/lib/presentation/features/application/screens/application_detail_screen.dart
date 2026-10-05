import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// 🍎 Application Detail Screen
/// หน้าดูรายละเอียดคำขอ - matches /applications/[id]
class ApplicationDetailScreen extends StatefulWidget {
  final String applicationId;

  const ApplicationDetailScreen({
    super.key,
    required this.applicationId,
  });

  @override
  State<ApplicationDetailScreen> createState() =>
      _ApplicationDetailScreenState();
}

class _ApplicationDetailScreenState extends State<ApplicationDetailScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _application;

  @override
  void initState() {
    super.initState();
    _fetchApplication();
  }

  Future<void> _fetchApplication() async {
    // TODO: Fetch from API
    await Future.delayed(const Duration(seconds: 1));
    setState(() {
      _isLoading = false;
      _application = {
        'id': widget.applicationId,
        'applicationNumber': 'GACP-2024-0001',
        'status': 'under_review',
        'serviceType': 'new',
        'submittedAt': '2024-01-15',
        'farmName': 'สวนกัญชาสุขใจ',
        'plantType': 'กัญชา',
        'cultivationArea': 500,
      };
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bgGray,
      appBar: AppBar(
        title: const Text('รายละเอียดคำขอ'),
        backgroundColor: AppTheme.primaryGreen,
        foregroundColor: Colors.white,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _application == null
              ? const Center(child: Text('ไม่พบข้อมูล'))
              : _buildContent(),
    );
  }

  Widget _buildContent() {
    final app = _application!;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Card
          Card(
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: _getStatusColor(app['status']).withAlpha(26),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          _getStatusText(app['status']),
                          style: TextStyle(
                            color: _getStatusColor(app['status']),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const Spacer(),
                      Text(
                        app['applicationNumber'],
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  const Divider(),
                  const SizedBox(height: 16),
                  _buildInfoRow(
                      'ประเภทคำขอ', _getServiceTypeText(app['serviceType'])),
                  _buildInfoRow('วันที่ยื่น', app['submittedAt']),
                  _buildInfoRow('ชื่อฟาร์ม', app['farmName']),
                  _buildInfoRow('ชนิดพืช', app['plantType']),
                  _buildInfoRow(
                      'พื้นที่ปลูก', '${app['cultivationArea']} ตร.ม.'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Timeline Card
          Card(
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'ไทม์ไลน์',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 16),
                  _buildTimelineItem('ยื่นคำขอ', '15 ม.ค. 2024', true),
                  _buildTimelineItem('ตรวจสอบเอกสาร', '16 ม.ค. 2024', true),
                  _buildTimelineItem('รอนัดหมาย', 'กำลังดำเนินการ', false),
                  _buildTimelineItem('ตรวจประเมิน', '-', false),
                  _buildTimelineItem('อนุมัติ', '-', false),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Actions
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.description),
                  label: const Text('ดูเอกสาร'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.chat),
                  label: const Text('ติดต่อเจ้าหน้าที่'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryGreen,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.grey.shade600)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  Widget _buildTimelineItem(String title, String date, bool completed) {
    return Row(
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: completed ? AppTheme.primaryGreen : Colors.grey.shade300,
            shape: BoxShape.circle,
          ),
          child: completed
              ? const Icon(Icons.check, color: Colors.white, size: 16)
              : null,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(title,
              style: TextStyle(
                color: completed ? Colors.black : Colors.grey,
              )),
        ),
        Text(date,
            style: TextStyle(
              color: Colors.grey.shade600,
              fontSize: 12,
            )),
      ],
    );
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'draft':
        return Colors.grey;
      case 'submitted':
        return Colors.blue;
      case 'under_review':
        return Colors.orange;
      case 'approved':
        return Colors.green;
      case 'rejected':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  String _getStatusText(String status) {
    switch (status) {
      case 'draft':
        return 'ร่าง';
      case 'submitted':
        return 'ส่งแล้ว';
      case 'under_review':
        return 'กำลังตรวจสอบ';
      case 'approved':
        return 'อนุมัติแล้ว';
      case 'rejected':
        return 'ถูกปฏิเสธ';
      default:
        return status;
    }
  }

  String _getServiceTypeText(String type) {
    switch (type) {
      case 'new':
        return 'ขอใหม่';
      case 'renewal':
        return 'ต่ออายุ';
      case 'amendment':
        return 'แก้ไข';
      case 'replacement':
        return 'ใบแทน';
      default:
        return type;
    }
  }
}
