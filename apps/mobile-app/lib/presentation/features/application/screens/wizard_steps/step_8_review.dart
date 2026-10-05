import 'package:mobile_app/domain/fee_service_catalogue.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../providers/form_state_provider.dart';
import '../../models/gacp_application_models.dart';
import '../../services/application_service.dart';
import 'wizard_common.dart';

// Thai display labels for raw stored values shown on the review summary
// (mirror the Thai labels used on the input steps; display only).
const _reviewValueLabels = {
  'NEWAPPLICATION': 'ขอใหม่',
  'RENEWAL': 'ต่ออายุ',
  'REPLACEMENT': 'ขอใบแทน',
  'Lost': 'สูญหาย',
  'Damaged': 'ชำรุด',
  'Notify': 'จดแจ้ง',
  'Permission': 'ขออนุญาต',
  'Self': 'เก็บเมล็ด/หัวพันธุ์เอง',
  'Buy': 'ซื้อจากผู้มีใบอนุญาต',
  'Import': 'นำเข้า',
  'Manual': 'เก็บด้วยมือ',
  'Machine': 'ใช้เครื่องจักร',
  'Sun Dry': 'ตากแดดบนแคร่',
  'Hot Air Oven': 'ตู้อบความร้อน',
  'Solar Dome': 'โรงเรือนพลังงานแสงอาทิตย์',
};

String _reviewLabel(String? value) =>
    value == null ? '-' : (_reviewValueLabels[value] ?? value);

String _yesNo(bool value) => value ? 'มี' : 'ไม่มี';

class Step8Review extends ConsumerStatefulWidget {
  const Step8Review({super.key});

  @override
  ConsumerState<Step8Review> createState() => _Step8ReviewState();
}

class _Step8ReviewState extends ConsumerState<Step8Review> {
  bool _confirmed = false;
  bool _submitting = false;
  // Latches true after a successful submit: keeps the button disabled even if
  // the success dialog is dismissed via Android back (double-submit guard).
  bool _submitted = false;

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(applicationFormProvider);
    final plantId = state.plantId;
    final plantConfig = plantConfigs[plantId];
    final isGroupA = plantConfig?.group == PlantGroup.highControl;

    return WizardScaffold(
      title: '8. ตรวจสอบและยืนยัน (Review & Submit)',
      nextLabel: 'ส่งคำขอ (Submit)',
      isNextEnabled: _confirmed && !_submitting && !_submitted,
      onBack: _submitting ? null : () => context.go('/applications/create/step7'),
      onNext: () => _submit(context),
      child: Column(
        children: [
          const WizardSectionTitle(
              title: 'สรุปข้อมูลใบสมัคร (Application Summary)'),
          _buildSummaryCard('1. ประเภทคำขอ (Service)',
              '${_reviewLabel(state.type?.name.toUpperCase())} - ${plantConfig?.nameTH}'),
          if (state.type == ServiceType.replacement)
            _buildSummaryCard('เหตุผล (Reason)',
                '${_reviewLabel(state.replacementReason?.reason)} - ${state.replacementReason?.policeReportNo}'),
          _buildSummaryCard('2. ผู้ยื่น (Applicant)',
              '${state.profile.name} (${state.profile.applicantType})\nผู้รับผิดชอบ: ${state.profile.responsibleName}'),
          _buildSummaryCard('3. สถานที่ (Site)',
              '${state.location.name}\n${state.location.address}\n${state.location.province}'),
          if (isGroupA)
            _buildSummaryCard('4. ใบอนุญาต (License)',
                '${_reviewLabel(state.licenseInfo?.plantingStatus)} - ${state.licenseInfo?.notifyNumber ?? state.licenseInfo?.licenseNumber}'),
          _buildSummaryCard('5. ความปลอดภัย (Security)',
              'รั้ว: ${_yesNo(state.securityMeasures.hasFence)}\nกล้องวงจรปิด: ${_yesNo(state.securityMeasures.hasCCTV)}\nการแบ่งโซน: ${_yesNo(state.securityMeasures.hasZoning)}'),
          if (state.type != ServiceType.replacement) ...[
            _buildSummaryCard('6. การผลิต (Production)',
                "ส่วนของพืช: ${state.production.plantParts.join(', ')}\nแหล่งที่มา: ${_reviewLabel(state.production.sourceType)}\nผลผลิตโดยประมาณ: ${state.production.estimatedYield}"),
            _buildSummaryCard('6.2 หลังเก็บเกี่ยว (Post-Harvest)',
                'การเก็บเกี่ยว: ${_reviewLabel(state.production.postHarvest.harvestMethod)}\nการลดความชื้น: ${_reviewLabel(state.production.postHarvest.dryingMethod)}\nการเก็บรักษา: ${state.production.postHarvest.storage}'),
          ],
          _buildSummaryCard('7. เอกสารแนบ (Documents)',
              '${state.documents.length} ไฟล์'),
          const SizedBox(height: 24),

          // Pre-submission Checklist - Smart Check
          _buildPreSubmissionChecklist(state),

          const SizedBox(height: 16),
          const Divider(),
          const SizedBox(height: 8),
          Row(children: [
            Checkbox(
              value: _confirmed,
              onChanged: _submitting
                  ? null
                  : (v) => setState(() => _confirmed = v ?? false),
            ),
            const Expanded(
                child: Text(
                    'ข้าพเจ้าขอรับรองว่าข้อมูลข้างต้นถูกต้องและเป็นความจริง (I confirm the information above is correct)'))
          ]),
          if (_submitting)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2)),
                  SizedBox(width: 12),
                  Text('กำลังส่งคำขอ... (Submitting)'),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _submit(BuildContext context) async {
    if (!_confirmed || _submitting || _submitted) return;
    setState(() => _submitting = true);
    final messenger = ScaffoldMessenger.of(context);
    // Capture before awaits — notifier outlives this screen.
    final notifier = ref.read(applicationFormProvider.notifier);
    final service = ref.read(applicationSubmitServiceProvider);
    try {
      final app = ref.read(applicationFormProvider);
      final result = await service.prepareAndSubmit(app);
      // Success: latch + WIPE the form so the next application starts clean
      // (otherwise app #2 inherits app #1's documents/ids — review finding).
      notifier.resetForm();
      if (!mounted) return;
      setState(() => _submitted = true);
      await _showResultDialog(result);
    } on SubmitException catch (e) {
      if (!mounted) return;
      await _showErrorDialog(e);
    } catch (e) {
      debugPrint('Submit error: $e');
      messenger.showSnackBar(
        const SnackBar(
            content:
                Text('ไม่สามารถส่งคำขอได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _showResultDialog(SubmitResult result) {
    final payNext = result.nextRequiredAction == 'PAY_PHASE_1';
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      // barrierDismissible only blocks barrier taps — PopScope also blocks the
      // Android system back button from dismissing the success dialog.
      builder: (ctx) => PopScope(
        canPop: false,
        child: _buildResultDialog(ctx, result, payNext),
      ),
    );
  }

  Widget _buildResultDialog(
      BuildContext ctx, SubmitResult result, bool payNext) {
    return AlertDialog(
        title: Row(
          children: const [
            Icon(LucideIcons.checkCircle2, color: Colors.green),
            SizedBox(width: 8),
            Expanded(child: Text('ส่งคำขอสำเร็จ')),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('เลขที่คำขอ (No.): ${result.applicationNumber}'),
            const SizedBox(height: 6),
            Text('สถานะ (Status): ${result.status}'),
            const SizedBox(height: 12),
            if (payNext)
              const Text(
                'ขั้นตอนถัดไป: ชำระ${FeeServiceCatalogue.phase1Name}',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              context.go('/applications');
            },
            child: const Text('ไปยังรายการคำขอ (My Applications)'),
          ),
          if (payNext)
            FilledButton(
              onPressed: () {
                Navigator.pop(ctx);
                context.go('/applications/${result.applicationId}/pay1');
              },
              child: const Text('ไปชำระเงิน (Pay Now)'),
            ),
        ]);
  }

  Future<void> _showErrorDialog(SubmitException e) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Row(
          children: const [
            Icon(LucideIcons.alertTriangle, color: Colors.red),
            SizedBox(width: 8),
            Expanded(child: Text('ส่งคำขอไม่สำเร็จ')),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(e.message),
            if (e.missingFields.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Text('ข้อมูลที่ยังไม่ครบ (Missing):',
                  style: TextStyle(fontWeight: FontWeight.bold)),
              ...e.missingFields.take(12).map((f) => Text('• $f',
                  style: const TextStyle(fontSize: 12))),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('ตกลง (OK)'),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryCard(String title, String content) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: ListTile(
        title: Text(title,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
        subtitle: Text(content,
            style: const TextStyle(fontSize: 14, color: Colors.black87)),
      ),
    );
  }

  /// Pre-submission Checklist - Smart Validation Before Submit
  Widget _buildPreSubmissionChecklist(GACPApplication state) {
    final checks = <_CheckItem>[];

    checks.add(_CheckItem(
      'วัตถุประสงค์การขอรับรอง (Purpose)',
      state.certificationPurposes.isNotEmpty,
      'กรุณาเลือกวัตถุประสงค์อย่างน้อยหนึ่งข้อใน Step 2',
    ));

    final profileOk =
        state.profile.name.isNotEmpty && state.profile.idCard.isNotEmpty;
    checks.add(_CheckItem(
      'ข้อมูลผู้ยื่น (Applicant Info)',
      profileOk,
      'กรุณากรอกชื่อและเลขบัตรประชาชน',
    ));

    final landOk = state.location.landOwnership.isNotEmpty;
    checks.add(_CheckItem(
      'กรรมสิทธิ์ที่ดิน (Land Ownership)',
      landOk,
      'กรุณาระบุสถานะการครอบครองที่ดินใน Step 5',
    ));

    final locationOk = state.location.name.isNotEmpty &&
        state.location.province.isNotEmpty;
    checks.add(_CheckItem(
      'สถานที่ปลูก (Site Location)',
      locationOk,
      'กรุณากรอกชื่อสถานที่และจังหวัด',
    ));

    if (state.type != ServiceType.replacement) {
      final prodOk = state.production.plantParts.isNotEmpty;
      checks.add(_CheckItem(
        'แผนการผลิต (Production Plan)',
        prodOk,
        'กรุณาเลือกส่วนของพืชที่ใช้ใน Step 6',
      ));
    }

    final docsOk = state.documents.isNotEmpty;
    checks.add(_CheckItem(
      'เอกสารแนบ (Documents)',
      docsOk,
      'กรุณาแนบเอกสารอย่างน้อย 1 ไฟล์ใน Step 7',
    ));

    final allOk = checks.every((c) => c.isOk);
    final failedCount = checks.where((c) => !c.isOk).length;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: allOk ? Colors.green.shade50 : Colors.amber.shade50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: allOk ? Colors.green.shade200 : Colors.amber.shade300,
          width: 2,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                allOk ? LucideIcons.checkCircle2 : LucideIcons.alertTriangle,
                color: allOk ? Colors.green : Colors.amber.shade700,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  allOk
                      ? 'พร้อมส่งคำขอ (Ready to Submit)'
                      : 'กรุณาตรวจสอบ $failedCount รายการ',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    color: allOk ? Colors.green.shade800 : Colors.amber.shade900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...checks.map((c) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Icon(
                      c.isOk ? LucideIcons.checkCircle : LucideIcons.circle,
                      size: 18,
                      color: c.isOk ? Colors.green : Colors.grey,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            c.label,
                            style: TextStyle(
                              color: c.isOk
                                  ? Colors.green.shade700
                                  : Colors.grey.shade700,
                              fontWeight:
                                  c.isOk ? FontWeight.normal : FontWeight.w500,
                            ),
                          ),
                          if (!c.isOk)
                            Text(
                              c.hint,
                              style: TextStyle(
                                fontSize: 12,
                                color: Colors.amber.shade800,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              )),
        ],
      ),
    );
  }
}

/// Helper class for pre-submission check items
class _CheckItem {
  final String label;
  final bool isOk;
  final String hint;

  _CheckItem(this.label, this.isOk, this.hint);
}
