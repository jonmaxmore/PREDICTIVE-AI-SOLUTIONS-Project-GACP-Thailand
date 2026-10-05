import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/form_state_provider.dart';
import 'wizard_common.dart';

class Step1Standards extends ConsumerWidget {
  const Step1Standards({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(applicationFormProvider);
    final notifier = ref.read(applicationFormProvider.notifier);
    final isAccepted = state.acceptedStandards;

    return WizardScaffold(
      onBack: () => context.go('/applications/create/step0'),
      onNext: () => context.go('/applications/create/step2'),
      isNextEnabled: isAccepted,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('1. เกณฑ์มาตรฐาน (GACP Standards)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          const Text('โปรดอ่านและยอมรับข้อกำหนด 14 ข้อ',
              style: TextStyle(color: Colors.grey)),
          const SizedBox(height: 20),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.grey[50],
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.grey[300]!),
              ),
              child: const SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _StandardItem(
                        '1. การประกันคุณภาพ (QA) - ควบคุมทุกขั้นตอนการผลิต'),
                    _StandardItem(
                        '2. สุขลักษณะส่วนบุคคล - ความรู้, การแต่งกาย, ห้ามสูบบุหรี่'),
                    _StandardItem(
                        '3. การบันทึกเอกสาร (Documentation) - SOP, ประวัติการผลิต, ใบรับรอง'),
                    _StandardItem(
                        '4. อุปกรณ์ (Equipment) - สะอาด, สอบเทียบ, ป้องกันปนเปื้อน'),
                    _StandardItem(
                        '5. พื้นที่ปลูก (Site) - ปราศจากโลหะหนัก/สารเคมี'),
                    _StandardItem('6. น้ำ (Water) - วิเคราะห์คุณภาพ, เหมาะสม'),
                    _StandardItem(
                        '7. ปุ๋ย (Fertilizer) - ขึ้นทะเบียน, เหมาะสม, ไม่ใช้สิ่งขับถ่ายคน'),
                    _StandardItem(
                        '8. เมล็ดพันธุ์ (Seeds) - แหล่งที่มาชัดเจน, ปลอดโรค'),
                    _StandardItem(
                        '9. การเพาะปลูก (Cultivation) - เกษตรเชิงอนุรักษ์, IPM'),
                    _StandardItem(
                        '10. การเก็บเกี่ยว (Harvest) - ระยะเวลาเหมาะสม, สะอาด'),
                    _StandardItem(
                        '11. แปรรูปเบื้องต้น (Primary Process) - ควบคุมอุณหภูมิ/ความชื้น'),
                    _StandardItem(
                        '12. สถานที่เก็บเกี่ยว (Building) - แข็งแรง, สะอาด, แยกโซน'),
                    _StandardItem(
                        '13. การบรรจุ (Packaging) - Food Grade, ฉลากชัดเจน'),
                    _StandardItem('14. การจัดเก็บ/ขนส่ง - ควบคุมสภาพแวดล้อม'),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          CheckboxListTile(
            value: isAccepted,
            onChanged: (v) => notifier.acceptStandards(v ?? false),
            title: const Text(
                'ข้าพเจ้าได้อ่านและเข้าใจเกณฑ์มาตรฐานทั้ง 14 ข้อ (I accept the standards)'),
            controlAffinity: ListTileControlAffinity.leading,
            activeColor: Colors.green,
            contentPadding: EdgeInsets.zero,
          ),
        ],
      ),
    );
  }
}

class _StandardItem extends StatelessWidget {
  final String text;
  const _StandardItem(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.check_circle_outline, size: 18, color: Colors.green),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 14))),
        ],
      ),
    );
  }
}
