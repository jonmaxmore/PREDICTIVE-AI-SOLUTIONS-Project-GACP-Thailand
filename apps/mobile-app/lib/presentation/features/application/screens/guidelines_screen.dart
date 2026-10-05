import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import '../../../../core/theme/app_theme.dart';

@widgetbook.UseCase(name: 'Default', type: GuidelinesScreen)
Widget guidelinesScreenUseCase(BuildContext context) {
  return const GuidelinesScreen(requestType: 'NEW');
}

class GuidelinesScreen extends StatefulWidget {
  final String requestType;
  const GuidelinesScreen({super.key, required this.requestType});

  @override
  State<GuidelinesScreen> createState() => _GuidelinesScreenState();
}

class _GuidelinesScreenState extends State<GuidelinesScreen> {
  bool _isAccepted = false;
  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ข้อกำหนดและหลักเกณฑ์ (GACP)'),
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              controller: _scrollController,
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'หลักเกณฑ์การรับรองมาตรฐานการปลูกและการเก็บเกี่ยวที่ดี\nของพืชกัญชาทางการแพทย์ในประเทศไทย',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    '(Thailand guidelines on Good agricultural and collection practices (GACP) For medical plants)',
                    style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: Colors.grey),
                    textAlign: TextAlign.center,
                  ),
                  const Divider(height: 32),
                  _buildSection('1. ขอบข่าย (Scope)',
                      'หลักเกณฑ์และข้อกำหนดสำหรับการตรวจประเมินและให้การรับรองตามมาตรฐานการปลูกและการเก็บเกี่ยวที่ดีของพืชกัญชาทางการแพทย์ในประเทศไทย'),
                  _buildSection('2. ข้อกำหนด (Requirements)',
                      'ข้อกำหนดที่ระบุในมาตรฐานนี้เป็น "ข้อกำหนดหลัก (Major Requirement)" ที่ต้องปฏิบัติ หากบกพร่องจะส่งผลกระทบทางตรงหรือรุนแรงต่อคุณภาพ ความปลอดภัยของวัตถุดิบกัญชา'),
                  _buildSection('3. การบันทึกข้อมูล (Record Keeping)',
                      '- ต้องมีการบันทึกกิจกรรมทุกขั้นตอนการผลิต\n- บันทึกปัจจัยการผลิต แหล่งที่มา\n- บันทึกสภาพแวดล้อมที่มีผลต่อคุณภาพ\n- เก็บรักษาบันทึกอย่างน้อย 2 ปี'),
                  _buildSection('4. อุปกรณ์ (Equipment)',
                      '- อุปกรณ์และภาชนะบรรจุต้องสะอาด ไม่ก่อให้เกิดการปนเปื้อน\n- เครื่องมือต้องได้รับการดูแลรักษาและสอบเทียบ (Calibration)\n- มีตารางแผนการบำรุงรักษาอย่างชัดเจน'),
                  _buildSection('5. พื้นที่ปลูก (Site)',
                      '- ต้องไม่มีความเสี่ยงจากการปนเปื้อนโลหะหนักหรือสารเคมีตกค้าง\n- ต้องมีการเก็บตัวอย่างดินและน้ำเพื่อตรวจวิเคราะห์ก่อนการเพาะปลูก'),
                  _buildSection('6. น้ำ (Water)',
                      '- มีวิธีการให้น้ำที่เหมาะสม\n- ไม่อนุญาตให้ใช้น้ำเสียที่ไม่ผ่านการบำบัดในกระบวนการผลิต'),
                  _buildSection('7. ปุ๋ย (Fertilizer)',
                      '- ใช้ปุ๋ยที่ขึ้นทะเบียนถูกต้องตามกฎหมาย\n- ห้ามใช้ปุ๋ยจากมูลมนุษย์\n- มีการจัดเก็บปุ๋ยแยกเป็นสัดส่วน'),
                  _buildSection('8. เมล็ดพันธุ์ (Seeds)',
                      '- เมล็ดพันธุ์ต้องมีคุณภาพ ปราศจากศัตรูพืช\n- สามารถตรวจสอบย้อนกลับแหล่งที่มาได้'),
                  _buildSection('9. การเพาะปลูก (Cultivation)',
                      '- มีมาตรการควบคุมการผลิตทุกขั้นตอนเพื่อความปลอดภัย\n- ใช้ระบบการจัดการศัตรูพืชแบบผสมผสาน (IPM)\n- ห้ามใช้สารเคมีอันตรายทางการเกษตรที่ห้ามผลิต/นำเข้า'),
                  _buildSection('10. การเก็บเกี่ยว (Harvesting)',
                      '- เก็บเกี่ยวในระยะที่เหมาะสม เพื่อให้ได้สารสำคัญสูงสุด\n- ภาชนะบรรจุและอุปกรณ์ต้องสะอาด\n- ป้องกันการปนเปื้อนจากดินและสิ่งเจือปน'),
                  _buildSection(
                      '11. กระบวนการแปรรูปเบื้องต้น (Primary process)',
                      '- ต้องรีบขนย้ายผลผลิตเข้าสู่สถานที่แปรรูป/ทำแห้งทันทีหลังเก็บเกี่ยว\n- กระบวนการลดความชื้นต้องป้องกันเชื้อราและการเสื่อมคุณภาพ\n- มีการคัดแยกสิ่งปลอมปนอย่างมีประสิทธิภาพ'),
                  _buildSection('12. สถานที่แปรรูป/อาคาร (Building)',
                      '- สถานที่ต้องสะอาด ปราศจากกลิ่นควันและสัตว์พาหะ\n- แยกบริเวณการผลิตเป็นสัดส่วน (รับวัตถุดิบ, แปรรูป, บรรจุ)\n- มีอ่างล้างมือและห้องเปลี่ยนชุดที่ถูกสุขลักษณะ\n- ระบบแสงสว่างและการระบายอากาศเพียงพอ'),
                  _buildSection(
                      '13. การบรรจุและการติดฉลาก (Packaging and labelling)',
                      '- ภาชนะบรรจุต้องสะอาด แข็งแรง และทำจากวัสดุที่ปลอดภัย (Food/Medical Grade)\n- ป้องกันแสง ความชื้น และการปนเปื้อน\n- ฉลากระบุชัดเจน: ชื่อพืช, แหล่งผลิต, วันที่ผลิต, น้ำหนัก'),
                  _buildSection(
                      '14. การจัดเก็บและการขนย้าย (Storage and distribution)',
                      '- ยานพาหนะขนส่งต้องสะอาดและป้องกันการปนเปื้อน\n- ห้องเก็บรักษาต้องควบคุมอุณหภูมิและความชื้นสัมพันธ์\n- มีมาตรการป้องกันสัตว์พาหะในสถานที่เก็บ'),
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.yellow[50],
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                          color: Colors.orange.withValues(alpha: 0.5)),
                    ),
                    child: const Row(
                      children: [
                        Icon(LucideIcons.alertTriangle, color: Colors.orange),
                        SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'โปรดอ่านให้ครบถ้วน เลื่อนลงจนสุดเพื่อยอมรับ',
                            style: TextStyle(
                                fontSize: 12, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 48), // Bottom padding
                ],
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.05),
                  blurRadius: 10,
                  offset: const Offset(0, -5),
                )
              ],
            ),
            child: SafeArea(
              child: Column(
                children: [
                  CheckboxListTile(
                    value: _isAccepted,
                    onChanged: (value) {
                      setState(() {
                        _isAccepted = value ?? false;
                      });
                    },
                    title: const Text(
                      'ข้าพเจ้าได้อ่านและยอมรับหลักเกณฑ์และข้อกำหนดการรับรองมาตรฐาน GACP',
                      style: TextStyle(fontSize: 14),
                    ),
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: EdgeInsets.zero,
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _isAccepted
                          ? () {
                              context.go('/applications/create/step0',
                                  extra: widget.requestType);
                            }
                          : null,
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                      child: const Text('ยอมรับและดำเนินการต่อ'),
                    ),
                  ),
                ],
              ),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildSection(String title, String content) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: AppTheme.primaryGreen),
          ),
          const SizedBox(height: 8),
          Text(
            content,
            style: const TextStyle(fontSize: 14, height: 1.5),
          ),
        ],
      ),
    );
  }
}
