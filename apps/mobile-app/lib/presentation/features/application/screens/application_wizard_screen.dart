import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

class ApplicationWizardScreen extends StatelessWidget {
  final Widget child;
  final GoRouterState state;

  const ApplicationWizardScreen(
      {super.key, required this.child, required this.state});

  @override
  Widget build(BuildContext context) {
    final currentStep = _getCurrentStep(state.uri.toString());

    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: const Text('ยื่นคำขอใบรับรอง GACP',
            style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
        centerTitle: true,
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.x, color: Colors.black),
          onPressed: () => context.go('/applications'),
        ),
      ),
      body: Column(
        children: [
          _buildProgressHeader(currentStep),
          const Divider(height: 1),
          Expanded(child: child),
        ],
      ),
    );
  }

  // 12 steps: 0-11 (matching PC wizard)
  int _getCurrentStep(String path) {
    if (path.contains('/step0')) return 0;
    if (path.contains('/step1')) return 1;
    if (path.contains('/step2')) return 2;
    if (path.contains('/step3')) return 3;
    if (path.contains('/step4')) return 4;
    if (path.contains('/step5')) return 5;
    if (path.contains('/step6')) return 6;
    if (path.contains('/step7')) return 7;
    if (path.contains('/step8')) return 8;
    if (path.contains('/step9')) return 9;
    if (path.contains('/step10')) return 10;
    if (path.contains('/step11')) return 11;
    return 0;
  }

  Widget _buildProgressHeader(int currentStep) {
    // 12 steps matching PC wizard flow
    final steps = [
      {'icon': LucideIcons.leaf, 'label': 'พืช'}, // 0
      {'icon': LucideIcons.clipboardList, 'label': 'มาตรฐาน'}, // 1
      {'icon': LucideIcons.fileEdit, 'label': 'ประเภท'}, // 2
      {'icon': LucideIcons.target, 'label': 'การรับรอง'}, // 3 NEW
      {'icon': LucideIcons.shield, 'label': 'PDPA'}, // 4
      {'icon': LucideIcons.user, 'label': 'ผู้ยื่น'}, // 5
      {'icon': LucideIcons.sprout, 'label': 'การผลิต'}, // 6
      {'icon': LucideIcons.mapPin, 'label': 'สถานที่'}, // 7
      {'icon': LucideIcons.fileText, 'label': 'เอกสาร'}, // 8
      {'icon': LucideIcons.search, 'label': 'ตรวจสอบ'}, // 9
      {'icon': LucideIcons.creditCard, 'label': 'ชำระเงิน'}, // 10
      {'icon': LucideIcons.checkCircle, 'label': 'ส่งคำขอ'}, // 11
    ];

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: List.generate(steps.length, (index) {
            final isCompleted = index < currentStep;
            final isCurrent = index == currentStep;
            final iconData = steps[index]['icon'] as IconData;

            return Container(
              width: 58,
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isCurrent
                          ? Colors.green.withAlpha(38)
                          : isCompleted
                              ? Colors.green
                              : Colors.grey[200],
                      border: Border.all(
                          color: isCurrent || isCompleted
                              ? Colors.green
                              : Colors.grey[300]!,
                          width: 2),
                    ),
                    child: Center(
                      child: Icon(
                        isCompleted ? LucideIcons.check : iconData,
                        size: 14,
                        color: isCompleted
                            ? Colors.white
                            : isCurrent
                                ? Colors.green
                                : Colors.grey[400],
                      ),
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    steps[index]['label'] as String,
                    style: TextStyle(
                      fontSize: 8,
                      fontWeight:
                          isCurrent ? FontWeight.bold : FontWeight.normal,
                      color: isCurrent || isCompleted
                          ? Colors.green
                          : Colors.grey[500],
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            );
          }),
        ),
      ),
    );
  }
}
