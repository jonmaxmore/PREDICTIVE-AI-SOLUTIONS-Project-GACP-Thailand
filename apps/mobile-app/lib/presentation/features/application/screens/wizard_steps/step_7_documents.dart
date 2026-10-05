import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../providers/form_state_provider.dart';
import '../../models/gacp_application_models.dart';
import '../../services/application_service.dart';
import 'wizard_common.dart';

class Step7Documents extends ConsumerWidget {
  const Step7Documents({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(applicationFormProvider);

    // Adaptive Logic: Generate Required Docs
    final plantId = state.plantId;
    final plantConfig = plantConfigs[plantId] ?? plantConfigs.values.first;
    final isGroupA = plantConfig.group == PlantGroup.highControl;
    final isReplacement = state.type == ServiceType.replacement;

    final docList = _generateDocList(state, isGroupA, isReplacement);

    return WizardScaffold(
      title: '7. เอกสารแนบ (Document Uploads)',
      onBack: () {
        if (isReplacement) {
          context.go('/applications/create/step4'); // Back to Reason Form
        } else {
          context.go('/applications/create/step6');
        }
      },
      onNext: () {
        // Honest gate: every slot the UI labels "* จำเป็น (Required)" must have
        // an upload. (Backend minimum is >=1 doc, but showing required slots
        // and then not enforcing them lies to the user.)
        final missing = docList
            .where((d) =>
                d.isRequired &&
                !state.documents.any((u) => u.type == d.label))
            .toList();
        if (missing.isEmpty) {
          context.go('/applications/create/step8');
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
                content: Text(
                    'ยังขาดเอกสารจำเป็น ${missing.length} รายการ: ${missing.first.label}${missing.length > 1 ? ' และอื่น ๆ' : ''}')),
          );
        }
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('รายการเอกสารที่ต้องใช้ (Generated Document List)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          Text(
              isReplacement
                  ? 'เอกสารสำหรับขอใบแทน (Replacement Docs)'
                  : 'ระบบวิเคราะห์เอกสารที่จำเป็นตามข้อมูลที่กรอก',
              style: const TextStyle(color: Colors.grey)),
          const SizedBox(height: 12),

          // Document Helper Info - Deep Links
          if (!isReplacement) _buildDocumentHelperInfo(),

          const SizedBox(height: 16),
          // NOTE: WizardScaffold wraps steps in SingleChildScrollView>Column
          // (unbounded height) — Expanded/ListView here throws RenderFlex
          // "non-zero flex but unbounded constraints" (proven by
          // test/widget/wizard_steps_render_test.dart). Render as a plain
          // Column: the list is ~10 items, no recycling needed.
          ...docList.map((doc) => _UploadItem(
                key: ValueKey('upload-${doc.label}'),
                title: doc.label,
                isRequired: doc.isRequired,
                slotId: doc.label,
              )),
        ],
      ),
    );
  }

  /// Document Helper Info - Links to external agencies
  Widget _buildDocumentHelperInfo() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.blue.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(LucideIcons.info, color: Colors.blue.shade700, size: 20),
              const SizedBox(width: 8),
              Text(
                'เอกสารที่ต้องขอจากหน่วยงานภายนอก',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Colors.blue.shade800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _buildExternalDocLink(
            'ผลตรวจประวัติอาชญากรรม',
            'ขอออนไลน์ที่ criminal.police.go.th',
            '100 บาท | ใช้เวลา 5-7 วัน',
            'https://criminal.police.go.th',
          ),
          const SizedBox(height: 8),
          _buildExternalDocLink(
            'หนังสือรับรองนิติบุคคล',
            'กรมพัฒนาธุรกิจการค้า',
            '~100 บาท | ใช้เวลา 1-2 วัน',
            'https://www.dbd.go.th',
          ),
        ],
      ),
    );
  }

  Widget _buildExternalDocLink(
      String title, String agency, String info, String url) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 13)),
                Text(agency,
                    style:
                        TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                Text(info,
                    style:
                        TextStyle(fontSize: 11, color: Colors.green.shade700)),
              ],
            ),
          ),
          IconButton(
            icon: Icon(LucideIcons.externalLink,
                size: 18, color: Colors.blue.shade600),
            onPressed: () {
              // In production: launch URL using url_launcher package
              // launchUrl(Uri.parse(url));
            },
            tooltip: 'เปิดเว็บไซต์',
          ),
        ],
      ),
    );
  }

  List<DocRequirement> _generateDocList(
      GACPApplication state, bool isGroupA, bool isReplacement) {
    final list = <DocRequirement>[];

    // CASE: REPLACEMENT
    if (isReplacement) {
      if (state.replacementReason?.reason == 'Lost') {
        list.add(DocRequirement('สำเนาใบแจ้งความ (Police Report Copy)', true));
      } else {
        list.add(DocRequirement(
            'รูปถ่ายใบรับรองที่ชำรุด (Photo of Damaged Cert)', true));
      }
      list.add(DocRequirement('สำเนาบัตรประชาชน (ID Card Copy)', true));
      return list;
    }

    // CASE: NEW / RENEWAL
    // 1. Mandatory (All) - Core Identity Documents
    list.add(DocRequirement('สำเนาบัตรประชาชน (ID Card Copy)', true));
    list.add(DocRequirement('สำเนาทะเบียนบ้าน (House Registration)', true));
    list.add(
        DocRequirement('ผลตรวจประวัติอาชญากรรม (Criminal Record Check)', true));
    list.add(DocRequirement('เอกสารสิทธิ์ที่ดิน (Land Title Deed)', true));

    // 1.5 Granular Photo Slots - Smart Photo Collection
    list.add(DocRequirement(
        'รูปถ่ายภายนอก ด้านหน้า (Exterior Front Photo)', true));
    list.add(DocRequirement('รูปถ่ายภายใน (Interior Photo)', true));
    list.add(DocRequirement('รูปถ่ายคลังเก็บ (Storage Area Photo)', true));
    list.add(
        DocRequirement('รูปถ่ายป้าย (Signage Photo)', false)); // Optional

    list.add(DocRequirement('แผนที่การเดินทาง (Map)', true));
    list.add(
        DocRequirement('ผลวิเคราะห์คุณภาพดิน/น้ำ (Soil/Water Analysis)', true));

    // 2. Land Ownership Conditional - Smart Logic
    final landOwnership = state.location.landOwnership;
    if (landOwnership == 'Rent') {
      list.add(DocRequirement('สัญญาเช่าที่ดิน (Lease Agreement)', true));
    } else if (landOwnership == 'Consent') {
      list.add(DocRequirement(
          'หนังสือยินยอมให้ใช้ที่ดิน (Land Consent Letter)', true));
    }
    // If 'Own' - no additional docs needed for land

    // 3. Applicant Type Conditional - Smart Logic
    final applicantType = state.profile.applicantType;
    if (applicantType == 'Juristic') {
      list.add(DocRequirement(
          'หนังสือรับรองนิติบุคคล (Company Registration)', true));
    } else if (applicantType == 'Community') {
      list.add(DocRequirement(
          'หนังสือจดทะเบียนวิสาหกิจชุมชน (Community Enterprise Cert)',
          true));
    } else if (applicantType == 'Cooperative') {
      list.add(DocRequirement(
          'หนังสือสำคัญสหกรณ์การเกษตร (Agricultural Cooperative Cert)',
          true));
    }

    // 4. Group Specific
    if (isGroupA) {
      // License Docs based on Status
      if (state.licenseInfo?.plantingStatus == 'Notify') {
        list.add(DocRequirement('ใบรับจดแจ้ง (Notification Receipt)', true));
      } else {
        list.add(DocRequirement('ใบอนุญาต (License Copy)', true));
      }

      // Security
      if (state.securityMeasures.hasCCTV) {
        list.add(DocRequirement('ผังการติดตั้งกล้องวงจรปิด (CCTV Plan)', true));
      }
    } else {
      // Group B
      list.add(DocRequirement('ใบรับรอง GAP (ถ้ามี)', false));
      // Tuber Check
      final hasTuber = state.production.plantParts
          .any((p) => p.contains('Tuber') || p.contains('หัว'));
      if (hasTuber) {
        list.add(DocRequirement(
            'ผลวิเคราะห์สารหนู (Arsenic Test Requirement)', true));
      }
    }

    // 5. Sourcing
    if (state.production.sourceType == 'Buy') {
      list.add(
          DocRequirement('ใบเสร็จรับเงินค่าเมล็ดพันธุ์ (Seed Receipt)', true));
    } else if (state.production.sourceType == 'Import') {
      list.add(DocRequirement('ใบอนุญาตนำเข้า (Import License)', true));
    }

    return list;
  }
}

class DocRequirement {
  final String label;
  final bool isRequired;
  DocRequirement(this.label, this.isRequired);
}

class _UploadItem extends ConsumerStatefulWidget {
  final String title;
  final bool isRequired;
  final String slotId;

  const _UploadItem({
    super.key,
    required this.title,
    required this.isRequired,
    required this.slotId,
  });

  @override
  ConsumerState<_UploadItem> createState() => _UploadItemState();
}

class _UploadItemState extends ConsumerState<_UploadItem> {
  bool _uploading = false;
  String? _error;

  Future<void> _pickAndUpload() async {
    // Capture BEFORE any await: ref must not be touched after dispose, but the
    // form notifier is a root provider that outlives this row — a successful
    // upload must still be recorded even if the user navigated away mid-flight.
    final service = ref.read(applicationSubmitServiceProvider);
    final notifier = ref.read(applicationFormProvider.notifier);

    setState(() => _error = null);
    try {
      final result = await FilePicker.platform.pickFiles(
        withData: true, // load bytes (works cross-platform incl. web/android)
        type: FileType.custom,
        allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
      );
      if (result == null || result.files.isEmpty) return; // user cancelled
      final file = result.files.first;
      final bytes = file.bytes;
      if (bytes == null) {
        if (mounted) {
          setState(() => _error = 'อ่านไฟล์ไม่ได้ (cannot read file)');
        }
        return;
      }
      if (!mounted) return; // picker returned after navigation — abort quietly
      setState(() => _uploading = true);
      final res = await service.uploadDraftDocument(
        bytes: bytes,
        filename: file.name,
        slotId: widget.slotId,
      );
      // Record into shared state even if this row is no longer mounted.
      notifier.upsertDocument(res.doc);
      if (res.applicationId.isNotEmpty) {
        notifier.setApplicationId(res.applicationId);
      }
    } on SubmitException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = 'อัปโหลดไม่สำเร็จ (upload failed)');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Reflect uploaded state from the shared form store (by slot).
    final docs = ref.watch(applicationFormProvider).documents;
    UploadedDocRef? uploaded;
    for (final d in docs) {
      if (d.type == widget.slotId) {
        uploaded = d;
        break;
      }
    }
    final isUploaded = uploaded != null;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Icon(
          isUploaded ? LucideIcons.checkCircle : LucideIcons.fileUp,
          color: isUploaded ? Colors.green : Colors.grey,
        ),
        title: Text(widget.title),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
                widget.isRequired
                    ? '* จำเป็น (Required)'
                    : 'ไม่บังคับ (Optional)',
                style: TextStyle(
                    color: widget.isRequired ? Colors.red : Colors.grey)),
            if (isUploaded)
              Text(uploaded.name,
                  style: const TextStyle(color: Colors.green, fontSize: 12),
                  overflow: TextOverflow.ellipsis),
            if (_error != null)
              Text(_error!,
                  style: const TextStyle(color: Colors.red, fontSize: 12)),
          ],
        ),
        trailing: _uploading
            ? const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2))
            : IconButton(
                icon: Icon(isUploaded ? Icons.refresh : Icons.upload_file),
                onPressed: _pickAndUpload,
                color: isUploaded ? Colors.green : Colors.blue,
              ),
      ),
    );
  }
}
