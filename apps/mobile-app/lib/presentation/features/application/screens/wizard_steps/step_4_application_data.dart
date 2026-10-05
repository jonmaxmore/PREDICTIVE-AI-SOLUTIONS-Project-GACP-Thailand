import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/form_state_provider.dart';
import '../../models/gacp_application_models.dart';
import 'wizard_common.dart';

// Thai display labels for raw plot enum/unit values (display only).
const _plotUnitLabels = {
  'Rai': 'ไร่',
  'rai': 'ไร่',
  'Ngan': 'งาน',
  'Sqm': 'ตร.ม.',
  'sqm': 'ตร.ม.',
  'OUTDOOR': 'กลางแจ้ง',
  'INDOOR': 'ในร่ม',
  'GREENHOUSE': 'โรงเรือน',
};

class Step4ApplicationData extends ConsumerStatefulWidget {
  const Step4ApplicationData({super.key});

  @override
  ConsumerState<Step4ApplicationData> createState() =>
      _Step4ApplicationDataState();
}

class _Step4ApplicationDataState extends ConsumerState<Step4ApplicationData>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this)
      // Rebuild so the IndexedStack below tracks the selected tab (we cannot
      // use TabBarView: WizardScaffold's SingleChildScrollView>Column gives
      // unbounded height and Expanded(TabBarView) throws RenderFlex — proven
      // by test/widget/wizard_steps_render_test.dart).
      ..addListener(() {
        if (mounted) setState(() {});
      });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(applicationFormProvider);
    final notifier = ref.read(applicationFormProvider.notifier);

    // Adaptive Logic
    final plantId = state.plantId;
    final plantConfig = plantConfigs[plantId] ?? plantConfigs.values.first;
    final isGroupA = plantConfig.group == PlantGroup.highControl;
    final isReplacement = state.type == ServiceType.replacement;

    return WizardScaffold(
      title: '4. ข้อมูลใบสมัคร (Application Data)',
      onBack: () => context.go('/applications/create/step3'),
      onNext: () {
        if (FormValidator.validateStep4(state, plantConfig)) {
          // If Replacement, skip to Step 7 (Documents)
          if (isReplacement) {
            context.go('/applications/create/step7');
          } else {
            context.go('/applications/create/step5');
          }
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
                content:
                    Text('กรุณากรอกข้อมูลให้ครบถ้วน (Please fill all fields)')),
          );
        }
      },
      child: isReplacement
          ? _ReasonForm(state: state, notifier: notifier)
          : Column(
              children: [
                TabBar(
                  controller: _tabController,
                  labelColor: Colors.green,
                  unselectedLabelColor: Colors.grey,
                  tabs: const [
                    Tab(text: 'A. ผู้ยื่น (Applicant)'),
                    Tab(text: 'B. โครงการ (Project)'),
                  ],
                ),
                const SizedBox(height: 10),
                // IndexedStack keeps BOTH forms alive (field state survives tab
                // switches) and sizes to content — safe under unbounded height.
                IndexedStack(
                  index: _tabController.index,
                  children: [
                    _ApplicantForm(state: state, notifier: notifier),
                    _ProjectForm(
                        state: state, notifier: notifier, isGroupA: isGroupA),
                  ],
                ),
              ],
            ),
    );
  }
}

class _ReasonForm extends StatelessWidget {
  final GACPApplication state;
  final ApplicationFormNotifier notifier;

  const _ReasonForm({required this.state, required this.notifier});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                  color: Colors.orange.shade50,
                  borderRadius: BorderRadius.circular(8)),
              child: const Row(
                children: [
                  Icon(Icons.warning_amber, color: Colors.orange),
                  SizedBox(width: 8),
                  Expanded(
                      child: Text(
                          'แบบฟอร์มขอใบแทน (Replacement Request) - กรุณาระบุสาเหตุ',
                          style: TextStyle(color: Colors.deepOrange))),
                ],
              ),
            ),
            const SizedBox(height: 16),
            _buildReasonRadio('สูญหาย (Lost)', 'Lost'),
            _buildReasonRadio('ชำรุด (Damaged)', 'Damaged'),
            const SizedBox(height: 16),
            if (state.replacementReason?.reason == 'Lost') ...[
              const Text('รายละเอียดการแจ้งความ (Police Report)',
                  style: TextStyle(fontWeight: FontWeight.bold)),
              WizardTextInput(
                  'เลขที่ใบแจ้งความ (Report No.)',
                  state.replacementReason?.policeReportNo ?? '',
                  (v) => notifier.updateReplacementReason(policeReportNo: v)),
              WizardTextInput(
                  'สถานีตำรวจ (Police Station)',
                  state.replacementReason?.policeStation ?? '',
                  (v) => notifier.updateReplacementReason(policeStation: v)),
            ] else ...[
              const Text(
                  'กรุณาเตรียมรูปถ่ายใบที่ชำรุดเพื่ออัปโหลดในขั้นตอนถัดไป (Step 7)',
                  style: TextStyle(color: Colors.grey)),
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildReasonRadio(String label, String value) {
    return RadioListTile<String>(
      title: Text(label),
      value: value,
      groupValue: state.replacementReason?.reason ?? 'Lost',
      onChanged: (v) => notifier.updateReplacementReason(reason: v),
    );
  }
}

class _ApplicantForm extends StatelessWidget {
  final GACPApplication state;
  final ApplicationFormNotifier notifier;

  const _ApplicantForm({required this.state, required this.notifier});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('1. ข้อมูลผู้ยื่น (Applicant Info)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: state.profile.applicantType,
            decoration: const InputDecoration(
                labelText: 'ประเภทผู้ยื่น (Type)',
                border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: 'Individual', child: Text('บุคคลธรรมดา')),
              DropdownMenuItem(
                  value: 'Community', child: Text('วิสาหกิจชุมชน')),
              DropdownMenuItem(value: 'Juristic', child: Text('นิติบุคคล')),
            ],
            onChanged: (v) => notifier.updateProfile(applicantType: v),
          ),
          const SizedBox(height: 12),
          // ValueKeys: without them, flipping the applicant-type branch makes
          // Flutter reuse TextFormField elements positionally and retained
          // text lands in the wrong field.
          if (state.profile.applicantType == 'Individual') ...[
            WizardTextInput('ชื่อ (First Name)', state.profile.firstName,
                (v) => notifier.updateProfile(firstName: v),
                key: const ValueKey('applicant-first-name')),
            WizardTextInput('นามสกุล (Last Name)', state.profile.lastName,
                (v) => notifier.updateProfile(lastName: v),
                key: const ValueKey('applicant-last-name')),
          ] else
            WizardTextInput(
                'ชื่อนิติบุคคล / วิสาหกิจชุมชน (Entity Name)',
                state.profile.name,
                (v) => notifier.updateProfile(name: v),
                key: const ValueKey('applicant-entity-name')),
          WizardTextInput('เลขบัตรปชช. / เลขนิติบุคคล (ID Card / Tax ID)',
              state.profile.idCard, (v) => notifier.updateProfile(idCard: v)),
          WizardTextInput('ที่อยู่ (Address)', state.profile.address,
              (v) => notifier.updateProfile(address: v)),
          WizardTextInput('เบอร์โทรศัพท์ (Mobile)', state.profile.mobile,
              (v) => notifier.updateProfile(mobile: v)),
          const SizedBox(height: 24),
          const Text('2. ผู้รับผิดชอบการผลิต (Responsible Person)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 8),
          WizardTextInput(
              'ชื่อผู้รับผิดชอบ (Responsible Name)',
              state.profile.responsibleName,
              (v) => notifier.updateProfile(responsibleName: v)),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: state.profile.qualification,
            decoration: const InputDecoration(
                labelText: 'คุณสมบัติ (Qualification)',
                border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: 'Thai Med', child: Text('แพทย์แผนไทย')),
              DropdownMenuItem(value: 'Folk Doc', child: Text('หมอพื้นบ้าน')),
              DropdownMenuItem(
                  value: 'Through Training',
                  child: Text('ผ่านการอบรมหลักสูตร')),
            ],
            onChanged: (v) => notifier.updateProfile(qualification: v),
          ),
        ],
      ),
    );
  }
}

class _ProjectForm extends StatelessWidget {
  final GACPApplication state;
  final ApplicationFormNotifier notifier;
  final bool isGroupA;

  const _ProjectForm(
      {required this.state, required this.notifier, required this.isGroupA});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('1. สถานที่ปลูก (Site Location)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 8),
          WizardTextInput('ชื่อสถานที่ (Site Name)', state.location.name,
              (v) => notifier.updateLocation(name: v)),
          WizardTextInput('ที่อยู่สถานที่ (Address)', state.location.address,
              (v) => notifier.updateLocation(address: v)),
          WizardTextInput('จังหวัด (Province)', state.location.province,
              (v) => notifier.updateLocation(province: v)),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('2. แปลงย่อย (Plots)',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              TextButton.icon(
                onPressed: () => _showAddPlotDialog(context, notifier),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('เพิ่มแปลง'),
              ),
            ],
          ),
          if (state.location.plots.isEmpty)
            Container(
              padding: const EdgeInsets.all(16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.grey.shade300),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text('ยังไม่มีรายการแปลงย่อย',
                  style: TextStyle(color: Colors.grey)),
            )
          else
            ...state.location.plots.map((plot) => Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    title: Text(plot.name,
                        style: const TextStyle(fontWeight: FontWeight.bold)),
                    subtitle: Text(
                        '${plot.areaSize} ${_plotUnitLabels[plot.areaUnit] ?? plot.areaUnit} • ${_plotUnitLabels[plot.solarSystem] ?? plot.solarSystem}'),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete, color: Colors.red),
                      onPressed: () {
                        final updated =
                            List<PlotDefinition>.from(state.location.plots)
                              ..removeWhere((p) => p.id == plot.id);
                        notifier.updateLocation(plots: updated);
                      },
                    ),
                  ),
                )),
          if (isGroupA) ...[
            const SizedBox(height: 24),
            const Text('3. ใบอนุญาต (License Info) (เฉพาะกลุ่ม A)',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: Colors.indigo,
                    fontSize: 16)),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: _buildStatusRadio('จดแจ้ง (Notify)', 'Notify')),
                Expanded(
                    child: _buildStatusRadio(
                        'ขออนุญาต (Permission)', 'Permission')),
              ],
            ),
            if (state.licenseInfo?.plantingStatus == 'Notify')
              WizardTextInput(
                  'เลขที่ใบรับจดแจ้ง (Notify No.)',
                  state.licenseInfo?.notifyNumber ?? '',
                  (v) => notifier.updateLicense(notifyNumber: v)),
            if (state.licenseInfo?.plantingStatus == 'Permission') ...[
              WizardTextInput(
                  'เลขใบอนุญาต (License No.)',
                  state.licenseInfo?.licenseNumber ?? '',
                  (v) => notifier.updateLicense(licenseNumber: v)),
              const SizedBox(height: 12),
              const Text('ประเภทใบอนุญาต:',
                  style: TextStyle(fontWeight: FontWeight.bold)),
              // Checkboxes for PT11, PT13, etc. could be added here
              // For now keeping simple
              const Text(
                  'เลือกประเภท พท.11 พท.13 พท.16 (เปิดใช้ในหน้ารายละเอียด)',
                  style: TextStyle(color: Colors.grey)),
            ]
          ] else ...[
            const SizedBox(height: 24),
            const Text('2. มาตรฐานอื่น ๆ (Other Certs) (กลุ่ม B)',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                  border: Border.all(color: Colors.green),
                  borderRadius: BorderRadius.circular(8)),
              child: const Text(
                  'GAP / Organic (ไม่บังคับ แนบได้ในขั้นตอนที่ 7)\nระบบจะแนะนำเอกสารที่ต้องใช้ในขั้นตอนถัดไป',
                  style: TextStyle(color: Colors.green)),
            )
          ]
        ],
      ),
    );
  }

  Widget _buildStatusRadio(String label, String value) {
    return RadioListTile<String>(
      title: Text(label, style: const TextStyle(fontSize: 14)),
      value: value,
      groupValue: state.licenseInfo?.plantingStatus ?? 'Notify',
      onChanged: (v) => notifier.updateLicense(plantingStatus: v),
      contentPadding: EdgeInsets.zero,
    );
  }

  void _showAddPlotDialog(
      BuildContext context, ApplicationFormNotifier notifier) {
    final nameController = TextEditingController();
    final sizeController = TextEditingController();
    String solarSystem = 'OUTDOOR';

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('เพิ่มแปลงย่อย (Add Plot)'),
        content: StatefulBuilder(
          builder: (context, setState) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'ชื่อแปลง'),
              ),
              TextField(
                controller: sizeController,
                decoration: const InputDecoration(labelText: 'ขนาด (ไร่)'),
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                initialValue: solarSystem,
                items: const [
                  DropdownMenuItem(value: 'OUTDOOR', child: Text('กลางแจ้ง')),
                  DropdownMenuItem(value: 'INDOOR', child: Text('ในร่ม')),
                  DropdownMenuItem(
                      value: 'GREENHOUSE', child: Text('โรงเรือน')),
                ],
                onChanged: (v) => setState(() => solarSystem = v!),
                decoration: const InputDecoration(labelText: 'ระบบปลูก'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('ยกเลิก'),
          ),
          ElevatedButton(
            onPressed: () {
              if (nameController.text.isNotEmpty) {
                final newPlot = PlotDefinition(
                  id: DateTime.now().millisecondsSinceEpoch.toString(),
                  name: nameController.text,
                  areaSize: sizeController.text,
                  solarSystem: solarSystem,
                );
                final updated = List<PlotDefinition>.from(state.location.plots)
                  ..add(newPlot);
                notifier.updateLocation(plots: updated);
                Navigator.pop(ctx);
              }
            },
            child: const Text('บันทึก'),
          ),
        ],
      ),
    );
  }
}
