import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class ApplicationWizardShell extends StatelessWidget {
  final Widget child;
  final GoRouterState state;

  const ApplicationWizardShell(
      {super.key, required this.child, required this.state});

  @override
  Widget build(BuildContext context) {
    // Determine current step from URL
    int currentStep = 0;
    final path = state.uri.toString();

    // Simple path matching
    // Wizard steps, in the order the shell renders them:
    //   0 Start (form details)   1 Applicant        2 Objective & area
    //   3 Product                4 Standard         5 Documents
    //   6 Review
    if (path.contains('/start')) {
      currentStep = 0;
    } else if (path.contains('/applicant-info')) {
      currentStep = 1;
    } else if (path.contains('/objective')) {
      currentStep = 2;
    } else if (path.contains('/product')) {
      currentStep = 3;
    } else if (path.contains('/standard')) {
      currentStep = 4;
    } else if (path.contains('/documents')) {
      currentStep = 5;
    } else if (path.contains('/review')) {
      currentStep = 6;
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('ยื่นคำขอรับรอง (GACP)'),
        centerTitle: true,
        elevation: 0,
        backgroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.black),
          onPressed: () {
            // Confirm dialog?
            context.go('/applications');
          },
        ),
      ),
      body: Column(
        children: [
          // Progress Bar
          LinearProgressIndicator(
            value: (currentStep + 1) / 7,
            backgroundColor: Colors.grey[200],
            valueColor: const AlwaysStoppedAnimation<Color>(Colors.green),
            minHeight: 6,
          ),
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('ขั้นตอนที่ ${currentStep + 1} จาก 7',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, color: Colors.green)),
                Text(_getStepTitle(currentStep),
                    style: const TextStyle(color: Colors.grey, fontSize: 13)),
              ],
            ),
          ),
          const Divider(height: 1),
          // Child content (The Steps)
          Expanded(child: child),
        ],
      ),
    );
  }

  String _getStepTitle(int step) {
    const titles = [
      'เลือกแบบฟอร์ม', // 0
      'ข้อมูลผู้ขอ', // 1
      'สถานที่ & พื้นที่', // 2
      'ข้อมูลการผลิต', // 3
      'มาตรฐาน GACP', // 4
      'เอกสารแนบ', // 5
      'ตรวจสอบ & ยืนยัน' // 6
    ];
    if (step < 0 || step >= titles.length) return '';
    return titles[step];
  }
}
