import 'package:flutter/material.dart';

class ReplacementInfoSection extends StatelessWidget {
  final String? selectedReason;
  final ValueChanged<String?> onReasonChanged;
  final TextEditingController otherReasonController;
  final TextEditingController oldCertController;

  const ReplacementInfoSection({
    super.key,
    required this.selectedReason,
    required this.onReasonChanged,
    required this.otherReasonController,
    required this.oldCertController,
  });

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      initiallyExpanded: true,
      childrenPadding: const EdgeInsets.symmetric(horizontal: 16),
      title: const Text(
        '0. ข้อมูลการขอใบแทน (Replacement Info)',
        style: TextStyle(fontWeight: FontWeight.bold),
      ),
      children: [
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          initialValue: selectedReason,
          decoration: const InputDecoration(
            labelText: 'เหตุผลในการขอใบแทน (Reason)',
            border: OutlineInputBorder(),
          ),
          items: const [
            DropdownMenuItem(value: 'LOST', child: Text('สูญหาย (Lost)')),
            DropdownMenuItem(
                value: 'DAMAGED',
                child: Text('ชำรุด/ลบเลือน (Damaged/Illegible)')),
            DropdownMenuItem(value: 'OTHER', child: Text('อื่น ๆ (Other)')),
          ],
          onChanged: onReasonChanged,
        ),
        const SizedBox(height: 12),
        if (selectedReason == 'OTHER')
          TextFormField(
            controller: otherReasonController,
            decoration: const InputDecoration(
              labelText: 'ระบุเหตุผล (Other Reason)',
              border: OutlineInputBorder(),
            ),
          ),
        if (selectedReason == 'OTHER') const SizedBox(height: 12),
        TextFormField(
          controller: oldCertController,
          decoration: const InputDecoration(
            labelText: 'เลขที่ใบรับรองเดิม (Original Certificate No.)',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        if (selectedReason == 'LOST')
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.amber.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.amber),
            ),
            child: const Row(
              children: [
                Icon(Icons.info, color: Colors.amber),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                      'กรุณาแนบใบแจ้งความในขั้นตอนถัดไป (Please attach Police Report in next step)'),
                ),
              ],
            ),
          ),
        if (selectedReason == 'DAMAGED')
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.blue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.blue),
            ),
            child: const Row(
              children: [
                Icon(Icons.info, color: Colors.blue),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                      'กรุณาส่งคืนใบรับรองเดิม (Please return the original certificate)'),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
