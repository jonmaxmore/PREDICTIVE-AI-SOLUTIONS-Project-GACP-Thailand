import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;

@widgetbook.UseCase(name: 'Default', type: ServiceSelectionScreen)
Widget serviceSelectionScreenUseCase(BuildContext context) {
  return const ServiceSelectionScreen();
}

class ServiceSelectionScreen extends StatefulWidget {
  const ServiceSelectionScreen({super.key});

  @override
  State<ServiceSelectionScreen> createState() => _ServiceSelectionScreenState();
}

class _ServiceSelectionScreenState extends State<ServiceSelectionScreen> {
  String? _selectedService;

  final List<Map<String, dynamic>> _services = [
    {
      'id': 'NEW',
      'title':
          'ขอรับใบรับรองแหล่งผลิต (ปลูก) เก็บเกี่ยวที่ดีและแปรรูป (กรณีรายใหม่)',
      'description': 'สำหรับผู้ที่ต้องการขอการรับรองครั้งแรก',
      'icon': LucideIcons.filePlus,
      'color': Colors.green,
    },
    {
      'id': 'RENEW',
      'title': 'ขอต่ออายุใบรับรอง',
      'description': 'สำหรับผู้ที่ใบรับรองใกล้หมดอายุ',
      'icon': LucideIcons.refreshCw,
      'color': Colors.blue,
    },
    {
      'id': 'SUBSTITUTE',
      'title': 'ขอรับใบแทนใบรับรอง',
      'description': 'กรณีใบรับรองสูญหายหรือชำรุด',
      'icon': LucideIcons.files,
      'color': Colors.orange,
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ประเภทคำขอใบรับรอง'), // Updated Title
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Added Header Text
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.blue.shade200),
                ),
                child: const Text(
                  'โปรดลงทะเบียนเพื่อขอรับการตรวจประเมินใบรับรองแหล่งผลิต (ปลูก) เก็บเกี่ยวที่ดีและแปรรูปของพืชกัญชา Thailand Cannabis GACP',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: Colors.blue,
                    height: 1.5,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: _services.length,
                itemBuilder: (context, index) {
                  final service = _services[index];
                  final isSelected = _selectedService == service['id'];

                  return GestureDetector(
                    onTap: () {
                      setState(() {
                        _selectedService = service['id'];
                      });
                    },
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: isSelected
                              ? service['color']
                              : Colors.grey.withValues(alpha: 0.2),
                          width: isSelected ? 2 : 1,
                        ),
                        boxShadow: [
                          if (isSelected)
                            BoxShadow(
                              color:
                                  (service['color'] as Color).withValues(alpha: 0.2),
                              blurRadius: 8,
                              offset: const Offset(0, 4),
                            ),
                        ],
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color:
                                  (service['color'] as Color).withValues(alpha: 0.1),
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              service['icon'],
                              color: service['color'],
                              size: 28,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  service['title'],
                                  style: TextStyle(
                                    fontSize:
                                        16, // Adjusted slightly for long text
                                    fontWeight: FontWeight.bold,
                                    color: isSelected
                                        ? service['color']
                                        : Colors.black87,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  service['description'],
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: Colors.grey[600],
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (isSelected)
                            Icon(LucideIcons.checkCircle,
                                color: service['color'], size: 24)
                          else
                            Icon(LucideIcons.circle,
                                color: Colors.grey[300], size: 24),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _selectedService == null
                      ? null
                      : () {
                          // Navigate to Guidelines first, or direct to Wizard based on flow
                          // Current flow: Guidelines -> Wizard
                          context.push('/applications/guidelines',
                              extra: _selectedService);
                        },
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const Text('ดำเนินการต่อ',
                      style: TextStyle(fontSize: 16)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
