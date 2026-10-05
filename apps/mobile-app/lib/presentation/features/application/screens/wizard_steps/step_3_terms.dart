import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/form_state_provider.dart';
import 'wizard_common.dart';

class Step3Terms extends ConsumerWidget {
  const Step3Terms({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(applicationFormProvider);
    final notifier = ref.read(applicationFormProvider.notifier);
    final isConsented = state.consentedPDPA;

    return WizardScaffold(
      onBack: () => context.go('/applications/create/step2'),
      onNext: () => context.go('/applications/create/step4'),
      isNextEnabled: isConsented,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('3. ข้อตกลงและนโยบายความเป็นส่วนตัว (Terms & Policy)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          const SizedBox(height: 20),
          const Expanded(
            child: SingleChildScrollView(
              child: Column(
                children: [
                  _TermsSection(
                    title: '1. เงื่อนไขการขอรับรอง (Certification Conditions)',
                    content:
                        'ข้าพเจ้ายินยอมให้เจ้าหน้าที่เข้าตรวจสอบพื้นที่ สถานที่ผลิต และเอกสารที่เกี่ยวข้องได้ตลอดเวลา และรับทราบว่าจะต้องจัดทำบันทึกข้อมูลการผลิตอย่างต่อเนื่อง',
                  ),
                  SizedBox(height: 16),
                  _TermsSection(
                    title: '2. นโยบายข้อมูลส่วนบุคคล (PDPA/Data Consent)',
                    content:
                        'ข้าพเจ้ายินยอมให้เปิดเผยข้อมูลแก่หน่วยงานที่เกี่ยวข้องเพื่อประโยชน์ในการพิจารณาใบรับรอง และยินยอมให้เผยแพร่ข้อมูลสถานะใบรับรองต่อสาธารณะเพื่อการตรวจสอบ',
                  ),
                  SizedBox(height: 16),
                  _TermsSection(
                    title: '3. คำรับรองของผู้ยื่นคำขอ (Self Declaration)',
                    content:
                        'ข้าพเจ้าขอรับรองว่าพื้นที่ปลูกถูกต้องตามกฎหมาย ไม่รุกล้ำพื้นที่ป่า และข้อมูลที่กรอกทั้งหมดเป็นความจริง หากพบว่าเป็นเท็จ ข้าพเจ้ายินยอมให้ยกเลิกใบรับรองทันที',
                  ),
                ],
              ),
            ),
          ),
          const Divider(),
          CheckboxListTile(
            value: isConsented,
            onChanged: (v) => notifier.consentPDPA(v ?? false),
            title: const Text(
                'ข้าพเจ้ายอมรับเงื่อนไขและยินยอมตามนโยบายข้างต้น (I agree to all terms)'),
            activeColor: Colors.green,
            controlAffinity: ListTileControlAffinity.leading,
          ),
        ],
      ),
    );
  }
}

class _TermsSection extends StatelessWidget {
  final String title;
  final String content;
  const _TermsSection({required this.title, required this.content});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(12),
          width: double.infinity,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.grey[200]!),
          ),
          child: Text(content, style: const TextStyle(fontSize: 14)),
        ),
      ],
    );
  }
}
