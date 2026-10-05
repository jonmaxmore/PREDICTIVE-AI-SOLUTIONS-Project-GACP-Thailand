import 'package:flutter/material.dart';
import '../../presentation/features/application/providers/form_state_provider.dart';
import 'plant_strategy.dart';

class CannabisStrategy implements PlantStrategy {
  @override
  String get id => 'CAN';
  @override
  String get name => 'Cannabis (กัญชา)';
  @override
  PlantGroup get group => PlantGroup.highControl;
  @override
  bool get requiresStrictLicense => true;

  // --- Step 4: License Section ---
  @override
  List<Widget> buildLicenseSectionWidgets(
      BuildContext context, ApplicationFormNotifier notifier, dynamic state) {
    return [
      DropdownButtonFormField<String>(
        decoration: const InputDecoration(
          labelText: 'ประเภทใบอนุญาต BhT*',
          border: OutlineInputBorder(),
        ),
        initialValue: state.licenseType,
        items: ['BhT 11', 'BhT 13', 'BhT 16']
            .map((e) => DropdownMenuItem(value: e, child: Text(e)))
            .toList(),
        onChanged: (v) => notifier.updateLicense(licenseType: v),
      ),
      const SizedBox(height: 16),
      TextFormField(
        decoration: const InputDecoration(
          labelText: 'เลขที่ใบอนุญาต*',
          border: OutlineInputBorder(),
        ),
        initialValue: state.licenseNumber,
        onChanged: (v) => notifier.updateLicense(licenseNumber: v),
      ),
      const SizedBox(height: 16),
      TextFormField(
        decoration: const InputDecoration(
          labelText: 'วันหมดอายุใบอนุญาต*',
          border: OutlineInputBorder(),
          suffixIcon: Icon(Icons.calendar_today),
        ),
        initialValue: state.licenseExpiry,
        onChanged: (v) => notifier.updateLicense(licenseExpiry: v),
      ),
    ];
  }

  // --- Step 5: Security ---
  @override
  List<SecurityRequirement> getSecurityRequirements() {
    return [
      const SecurityRequirement('รั้วรอบขอบชิด (Secure Fence)',
          required: true, description: 'ต้องมีรั้วความสูงอย่างน้อย 2 เมตร'),
      const SecurityRequirement('กล้องวงจรปิด (CCTV Medical Grade)',
          required: true, description: 'บันทึก 24/7 เก็บข้อมูล 90 วัน'),
      const SecurityRequirement('ควบคุมการเข้า-ออก (Access Control)',
          required: true, description: 'ระบบ Log การเข้า-ออกพื้นที่'),
      const SecurityRequirement('การแบ่งโซนพื้นที่ (Zoning)', required: false),
    ];
  }

  @override
  List<Widget> buildSecurityWidgets(
      BuildContext context, ApplicationFormNotifier notifier, dynamic state) {
    final security = state.securityMeasures;
    return [
      _buildCheckItem('มีรั้วรอบขอบชิด (Secure Fence)', security.hasFence,
          (v) => notifier.updateSecurity(hasFence: v),
          isRequired: true),
      _buildCheckItem('มีกล้องวงจรปิด (CCTV Medical Grade)', security.hasCCTV,
          (v) => notifier.updateSecurity(hasCCTV: v),
          isRequired: true),
      _buildCheckItem(
          'มีการควบคุมการเข้า-ออก (Access Control)',
          security.hasAccessControl,
          (v) => notifier.updateSecurity(hasAccessControl: v),
          isRequired: true),
      _buildCheckItem('การแบ่งโซนพื้นที่ (Zoning)', security.hasZoning,
          (v) => notifier.updateSecurity(hasZoning: v),
          isRequired: false),
    ];
  }

  @override
  bool validateSecurity(dynamic securityMeasures) {
    return securityMeasures.hasFence &&
        securityMeasures.hasCCTV &&
        securityMeasures.hasAccessControl;
  }

  // --- Step 6: Production ---
  @override
  List<Widget> buildProductionWidgets(
      BuildContext context, ApplicationFormNotifier notifier, dynamic state) {
    return []; // Handled by Step 6 composition
  }

  @override
  List<String> getPlantPartsOptions() {
    return [
      'Inflorescence (ช่อดอกแห้ง)',
      'Fresh Flower (ดอกสด)',
      'Leaf (ใบ)',
      'Seed (เมล็ด)',
      'Stem (ลำต้น)',
      'Root (ราก)'
    ];
  }

  @override
  String getYieldLabel() => 'ผลผลิตคาดการณ์ (Dried Flower Kg)';

  @override
  bool get usesTreeUnit => true;

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
      const DocumentRequirement(
          id: 'medical_license',
          name: 'Medical License (BhT)',
          nameTH: 'ใบอนุญาต BhT',
          category: 'LICENSE'),
      const DocumentRequirement(
          id: 'security_plan',
          name: 'Security Plan',
          nameTH: 'แผนรักษาความปลอดภัย',
          category: 'COMPLIANCE'),
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
    return [
      'land_ownership',
      'location_map',
      'photos_site',
      'medical_license',
      'security_plan'
    ];
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
