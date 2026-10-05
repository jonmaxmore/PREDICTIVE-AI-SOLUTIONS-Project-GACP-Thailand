import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// 🍎 Amendment Application Screen
/// หน้าแก้ไขข้อมูลใบรับรอง - matches /applications/amendment
class AmendmentApplicationScreen extends StatefulWidget {
  const AmendmentApplicationScreen({super.key});

  @override
  State<AmendmentApplicationScreen> createState() =>
      _AmendmentApplicationScreenState();
}

class _AmendmentApplicationScreenState
    extends State<AmendmentApplicationScreen> {
  final List<String> _selectedAmendments = [];

  final List<Map<String, dynamic>> _amendmentTypes = [
    {'id': 'name', 'title': 'ชื่อ-นามสกุล', 'icon': Icons.person},
    {'id': 'address', 'title': 'ที่อยู่', 'icon': Icons.location_on},
    {'id': 'area', 'title': 'พื้นที่ปลูก', 'icon': Icons.crop_square},
    {'id': 'plant', 'title': 'ชนิดพืช', 'icon': Icons.local_florist},
    {'id': 'contact', 'title': 'ข้อมูลติดต่อ', 'icon': Icons.phone},
    {'id': 'other', 'title': 'อื่น ๆ', 'icon': Icons.more_horiz},
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bgGray,
      appBar: AppBar(
        title: const Text('แก้ไขข้อมูลใบรับรอง'),
        backgroundColor: AppTheme.primaryGreen,
        foregroundColor: Colors.white,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Certificate info
            Card(
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16)),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppTheme.primaryGreen.withAlpha(26),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(Icons.edit_document,
                              color: AppTheme.primaryGreen),
                        ),
                        const SizedBox(width: 16),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'แก้ไขข้อมูลในใบรับรอง',
                                style: TextStyle(
                                    fontSize: 18, fontWeight: FontWeight.bold),
                              ),
                              Text(
                                'เลือกรายการที่ต้องการแก้ไข',
                                style: TextStyle(color: Colors.grey),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Amendment type selection
            const Text(
              'เลือกประเภทการแก้ไข',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            ..._amendmentTypes.map((type) => _buildAmendmentOption(type)),

            const SizedBox(height: 24),

            // Reason input
            const Text(
              'เหตุผลในการแก้ไข',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            TextFormField(
              maxLines: 4,
              decoration: InputDecoration(
                hintText: 'กรุณาระบุเหตุผลในการขอแก้ไข...',
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Documents
            const Text(
              'เอกสารประกอบ',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.upload_file),
              label: const Text('อัปโหลดเอกสารหลักฐาน'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.all(20),
                minimumSize: const Size(double.infinity, 60),
              ),
            ),
            const SizedBox(height: 32),

            // Submit
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed:
                    _selectedAmendments.isNotEmpty ? _submitAmendment : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryGreen,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child:
                    const Text('ยื่นคำขอแก้ไข', style: TextStyle(fontSize: 16)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAmendmentOption(Map<String, dynamic> type) {
    final isSelected = _selectedAmendments.contains(type['id']);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: isSelected ? AppTheme.primaryGreen : Colors.transparent,
          width: 2,
        ),
      ),
      child: InkWell(
        onTap: () {
          setState(() {
            if (isSelected) {
              _selectedAmendments.remove(type['id']);
            } else {
              _selectedAmendments.add(type['id']);
            }
          });
        },
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(type['icon'],
                  color: isSelected ? AppTheme.primaryGreen : Colors.grey),
              const SizedBox(width: 16),
              Expanded(child: Text(type['title'])),
              Checkbox(
                value: isSelected,
                onChanged: (v) {
                  setState(() {
                    if (v == true) {
                      _selectedAmendments.add(type['id']);
                    } else {
                      _selectedAmendments.remove(type['id']);
                    }
                  });
                },
                activeColor: AppTheme.primaryGreen,
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _submitAmendment() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('ยื่นคำขอแก้ไขสำเร็จ')),
    );
    Navigator.pop(context);
  }
}
