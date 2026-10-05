import 'package:flutter/material.dart';
import '../../presentation/features/application/providers/form_state_provider.dart';
import 'plant_strategy.dart';

class GeneralStrategy implements PlantStrategy {
  @override
  String get id => 'GEN';
  @override
  String get name => 'General Plant (พืชทั่วไป)';
  @override
  PlantGroup get group => PlantGroup.general;
  @override
  bool get requiresStrictLicense => false;

  // --- Step 4: License Section (Optional for General Plants) ---
  @override
  List<Widget> buildLicenseSectionWidgets(
      BuildContext context, ApplicationFormNotifier notifier, dynamic state) {
    // Group B: Show optional GAP/Organic history instead
    return [
      CheckboxListTile(
        title: const Text('มีประวัติการรับรอง GAP/Organic'),
        value: state.hasGapHistory ?? false,
        onChanged: (v) => notifier.updateField('hasGapHistory', v),
      ),
      if (state.hasGapHistory == true) ...[
        const SizedBox(height: 16),
        TextFormField(
          decoration: const InputDecoration(
            labelText: 'เลขที่ใบรับรอง GAP',
            border: OutlineInputBorder(),
          ),
          initialValue: state.gapCertificateNumber,
          onChanged: (v) => notifier.updateField('gapCertificateNumber', v),
        ),
      ],
    ];
  }

  // --- Step 5: Security ---
  @override
  List<SecurityRequirement> getSecurityRequirements() {
    return [
      const SecurityRequirement('มาตรการป้องกันสัตว์ (Animal Barrier)',
          required: true, description: 'ป้องกันสัตว์เข้าทำลายพืช'),
      const SecurityRequirement('การแบ่งโซนพื้นที่ (Zoning)',
          required: true, description: 'แยกพื้นที่เพาะปลูกชัดเจน'),
      const SecurityRequirement('รั้ว (Optional)', required: false),
    ];
  }

  @override
  List<Widget> buildSecurityWidgets(
      BuildContext context, ApplicationFormNotifier notifier, dynamic state) {
    final security = state.securityMeasures;
    return [
      _buildCheckItem(
          'มีมาตรการป้องกันสัตว์ (Animal Barrier)',
          security.hasAnimalBarrier,
          (v) => notifier.updateSecurity(hasAnimalBarrier: v),
          isRequired: true),
      _buildCheckItem('การแบ่งโซนพื้นที่ (Zoning)', security.hasZoning,
          (v) => notifier.updateSecurity(hasZoning: v),
          isRequired: true),
      _buildCheckItem('มีรั้ว (Optional)', security.hasFence,
          (v) => notifier.updateSecurity(hasFence: v),
          isRequired: false),
    ];
  }

  @override
  bool validateSecurity(dynamic securityMeasures) {
    return securityMeasures.hasAnimalBarrier && securityMeasures.hasZoning;
  }

  // --- Step 6: Production ---
  @override
  List<Widget> buildProductionWidgets(
      BuildContext context, ApplicationFormNotifier notifier, dynamic state) {
    return []; // Handled by Step 6 composition
  }

  @override
  List<String> getPlantPartsOptions() {
    return ['Rhizome (เหง้า)', 'Tuber (หัว)', 'Rootlet (รากฝอย)', 'Leaf (ใบ)'];
  }

  @override
  String getYieldLabel() => 'ผลผลิตคาดการณ์ (Fresh Tuber Ton/Kg)';

  @override
  bool get usesTreeUnit => false;

  // --- Step 7: Documents ---
  @override
  List<DocumentRequirement> getDocumentRequirements(String requestType) {
    final docs = <DocumentRequirement>[
      const DocumentRequirement(
          id: 'id_card',
          name: 'ID Card Copy',
          nameTH: 'สำเนาบัตรประชาชน',
          category: 'IDENTITY'),
      const DocumentRequirement(
          id: 'land_ownership',
          name: 'Land Ownership',
          nameTH: 'เอกสารสิทธิ์ที่ดิน',
          category: 'PROPERTY'),
      const DocumentRequirement(
          id: 'location_map',
          name: 'Location Map',
          nameTH: 'แผนที่ตั้งแปลง',
          category: 'PROPERTY'),
      const DocumentRequirement(
          id: 'photos_site',
          name: 'Site Photos',
          nameTH: 'รูปถ่ายแปลง',
          category: 'PROPERTY'),
    ];

    if (requestType == 'RENEW') {
      docs.add(const DocumentRequirement(
          id: 'prev_certificate',
          name: 'Previous Certificate',
          nameTH: 'ใบรับรองฉบับเดิม',
          category: 'LICENSE'));
    }
    return docs;
  }

  @override
  List<String> getRequiredDocuments() {
    return ['land_ownership', 'location_map', 'photos_site'];
  }

  Widget _buildCheckItem(String title, bool value, Function(bool) onChanged,
      {bool isRequired = false}) {
    return CheckboxListTile(
      title: Row(
        children: [
          Expanded(child: Text(title)),
          if (isRequired) const Text(' *', style: TextStyle(color: Colors.red)),
        ],
      ),
      value: value,
      onChanged: (v) => onChanged(v ?? false),
      activeColor: Colors.green,
    );
  }
}
