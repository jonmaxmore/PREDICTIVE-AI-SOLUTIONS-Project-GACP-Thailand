import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/form_state_provider.dart';
import '../../../../../domain/certification_purposes.dart';
import '../../models/gacp_application_models.dart';
import 'wizard_common.dart';

class Step2RequestType extends ConsumerWidget {
  const Step2RequestType({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(applicationFormProvider);
    final notifier = ref.read(applicationFormProvider.notifier);

    return WizardScaffold(
      onBack: () => context.go('/applications/create/step1'),
      onNext: () {
        if (state.type == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('กรุณาเลือกประเภทคำขอ')),
          );
        } else if (state.certificationPurposes.isEmpty) {
          // Never defaulted (operator ruling 2026-10-05): the purpose decides which
          // issued ภ.ท. licence is demanded, so the applicant makes the choice.
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
                content:
                    Text('กรุณาเลือกวัตถุประสงค์การขอรับรองอย่างน้อยหนึ่งข้อ')),
          );
        } else {
          context.go('/applications/create/step3');
        }
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('2. ประเภทคำขอ (Request Type)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          const SizedBox(height: 20),
          _TypeOption(
            title: 'คำขอรายใหม่ (New Application)',
            subtitle: 'สำหรับผู้ที่ไม่เคยมีใบรับรอง หรือใบเก่าขาดอายุเกินกำหนด',
            isSelected: state.type == ServiceType.newApplication,
            onTap: () => notifier.setServiceType(ServiceType.newApplication),
          ),
          _TypeOption(
            title: 'ขอต่ออายุใขรับรอง (Renewal)',
            subtitle: 'สำหรับผู้ที่ใบรับรองใกล้หมดอายุ (ยื่นก่อน 90 วัน)',
            isSelected: state.type == ServiceType.renewal,
            onTap: () => notifier.setServiceType(ServiceType.renewal),
          ),
          _TypeOption(
            title: 'ขอใบแทนใบรับรอง (Replacement)',
            subtitle: 'กรณีใบรับรองสูญหาย หรือชำรุด',
            isSelected: state.type == ServiceType.replacement,
            onTap: () => notifier.setServiceType(ServiceType.replacement),
          ),
          const SizedBox(height: 12),
          const Text('วัตถุประสงค์การขอรับรอง (เลือกได้มากกว่าหนึ่งข้อ)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 4),
          const Text(
              'สำหรับกัญชา แต่ละข้อต้องมีใบอนุญาต ภ.ท. ที่ออกให้แล้วรองรับ ระบบจะขอตัวใบอนุญาตในขั้นตอนแนบเอกสาร',
              style: TextStyle(fontSize: 12, color: Colors.grey)),
          const SizedBox(height: 4),
          const Text(
              "ถ้าขายในประเทศ หรือแปรรูป เช่น ตากแห้ง ตัดแต่ง ทำผลิตภัณฑ์ ให้เลือก 'แปรรูปหรือจำหน่ายเพื่อการค้า' เพิ่ม",
              style: TextStyle(fontSize: 12, color: Colors.grey)),
          const SizedBox(height: 12),
          for (final purpose in CertificationPurposes.all)
            _PurposeOption(
              purpose: purpose,
              isSelected: state.certificationPurposes.contains(purpose.code),
              onTap: () => notifier.togglePurpose(purpose.code),
            ),
        ],
      ),
    );
  }
}

class _TypeOption extends StatelessWidget {
  final String title;
  final String subtitle;
  final bool isSelected;
  final VoidCallback onTap;

  const _TypeOption(
      {required this.title,
      required this.subtitle,
      required this.isSelected,
      required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: isSelected ? Colors.green[50] : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: isSelected ? Colors.green : Colors.grey[300]!),
      ),
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Row(
            children: [
              Icon(
                  isSelected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_off,
                  color: isSelected ? Colors.green : Colors.grey),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text(subtitle,
                        style:
                            const TextStyle(fontSize: 12, color: Colors.grey)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PurposeOption extends StatelessWidget {
  final CertificationPurpose purpose;
  final bool isSelected;
  final VoidCallback onTap;

  const _PurposeOption(
      {required this.purpose, required this.isSelected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      key: ValueKey('purpose-${purpose.code}'),
      color: isSelected ? Colors.green[50] : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: isSelected ? Colors.green : Colors.grey[300]!),
      ),
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Row(
            children: [
              Icon(isSelected ? Icons.check_box : Icons.check_box_outline_blank,
                  color: isSelected ? Colors.green : Colors.grey),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(purpose.optionLabel,
                        style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text(purpose.licenceName,
                        style:
                            const TextStyle(fontSize: 12, color: Colors.grey)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
