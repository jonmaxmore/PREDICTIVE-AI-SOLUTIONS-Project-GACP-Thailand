import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// 🍎 Renewal Application Screen
/// หน้าต่ออายุใบรับรอง - matches /applications/renewal
class RenewalApplicationScreen extends StatefulWidget {
  const RenewalApplicationScreen({super.key});

  @override
  State<RenewalApplicationScreen> createState() =>
      _RenewalApplicationScreenState();
}

class _RenewalApplicationScreenState extends State<RenewalApplicationScreen> {
  int _currentStep = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bgGray,
      appBar: AppBar(
        title: const Text('ต่ออายุใบรับรอง'),
        backgroundColor: AppTheme.primaryGreen,
        foregroundColor: Colors.white,
      ),
      body: Stepper(
        currentStep: _currentStep,
        onStepContinue: () {
          if (_currentStep < 3) {
            setState(() => _currentStep++);
          } else {
            _submitRenewal();
          }
        },
        onStepCancel: () {
          if (_currentStep > 0) {
            setState(() => _currentStep--);
          }
        },
        controlsBuilder: (context, details) {
          return Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: details.onStepContinue,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primaryGreen,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                    ),
                    child: Text(_currentStep == 3 ? 'ยื่นคำขอ' : 'ถัดไป'),
                  ),
                ),
                if (_currentStep > 0) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: details.onStepCancel,
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                      ),
                      child: const Text('ย้อนกลับ'),
                    ),
                  ),
                ],
              ],
            ),
          );
        },
        steps: [
          Step(
            title: const Text('ข้อมูลใบรับรองเดิม'),
            content: _buildStep1(),
            isActive: _currentStep >= 0,
            state: _currentStep > 0 ? StepState.complete : StepState.indexed,
          ),
          Step(
            title: const Text('ข้อมูลปัจจุบัน'),
            content: _buildStep2(),
            isActive: _currentStep >= 1,
            state: _currentStep > 1 ? StepState.complete : StepState.indexed,
          ),
          Step(
            title: const Text('เอกสารประกอบ'),
            content: _buildStep3(),
            isActive: _currentStep >= 2,
            state: _currentStep > 2 ? StepState.complete : StepState.indexed,
          ),
          Step(
            title: const Text('ยืนยันข้อมูล'),
            content: _buildStep4(),
            isActive: _currentStep >= 3,
            state: StepState.indexed,
          ),
        ],
      ),
    );
  }

  Widget _buildStep1() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('เลขที่ใบรับรอง',
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            TextFormField(
              decoration: InputDecoration(
                hintText: 'กรุณากรอกเลขที่ใบรับรอง',
                border:
                    OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
            const SizedBox(height: 16),
            const Text('วันที่หมดอายุ',
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            TextFormField(
              decoration: InputDecoration(
                hintText: 'วัน/เดือน/ปี',
                suffixIcon: const Icon(Icons.calendar_today),
                border:
                    OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStep2() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('ข้อมูลมีการเปลี่ยนแปลงหรือไม่?',
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            ListTile(
              title: const Text('ไม่มีการเปลี่ยนแปลง'),
              leading: Radio(value: 0, groupValue: 0, onChanged: (v) {}),
            ),
            ListTile(
              title: const Text('มีการเปลี่ยนแปลง'),
              leading: Radio(value: 1, groupValue: 0, onChanged: (v) {}),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStep3() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            _buildDocumentUpload('สำเนาใบรับรองเดิม', Icons.file_copy),
            const SizedBox(height: 12),
            _buildDocumentUpload('รูปถ่ายแปลงปลูกปัจจุบัน', Icons.camera_alt),
            const SizedBox(height: 12),
            _buildDocumentUpload('บันทึกการผลิต', Icons.note_alt),
          ],
        ),
      ),
    );
  }

  Widget _buildDocumentUpload(String title, IconData icon) {
    return OutlinedButton.icon(
      onPressed: () {},
      icon: Icon(icon),
      label: Text(title),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.all(16),
        minimumSize: const Size(double.infinity, 60),
      ),
    );
  }

  Widget _buildStep4() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('สรุปข้อมูล',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            _buildSummaryRow('ประเภทคำขอ', 'ต่ออายุใบรับรอง'),
            _buildSummaryRow('เลขที่ใบรับรองเดิม', 'GACP-2023-0001'),
            _buildSummaryRow('วันที่หมดอายุ', '31 มี.ค. 2024'),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.orange.shade50,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: Colors.orange.shade700),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'กรุณาตรวจสอบข้อมูลให้ถูกต้องก่อนยื่นคำขอ',
                      style: TextStyle(color: Colors.orange.shade700),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.grey.shade600)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  void _submitRenewal() {
    // TODO: Submit to API
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('ยื่นคำขอต่ออายุสำเร็จ')),
    );
    Navigator.pop(context);
  }
}
