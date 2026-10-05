import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers/core_providers.dart';
import 'certificate_model.dart';

/// Certificates Screen — wired to the REAL backend (M4b).
///
/// GET /certificates/my (authenticateHealth) via the shared [dioClientProvider].
/// The old implementation called /v2/certificates (guaranteed 404 on the
/// real API) and silently fell back to demo certificates on ANY error — the
/// user could never tell. Errors now render an explicit error state + retry.
class CertificatesScreen extends ConsumerStatefulWidget {
  const CertificatesScreen({super.key});

  @override
  ConsumerState<CertificatesScreen> createState() => _CertificatesScreenState();
}

class _CertificatesScreenState extends ConsumerState<CertificatesScreen> {
  bool _isLoading = true;
  String? _error;
  List<CertificateRow> _certificates = [];

  @override
  void initState() {
    super.initState();
    _loadCertificates();
  }

  Future<void> _loadCertificates() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final dio = ref.read(dioClientProvider);
      final response = await dio.get('/certificates/my');
      final body = response.data;
      if (response.statusCode == 200 &&
          body is Map &&
          body['success'] == true) {
        final List<dynamic> data = (body['data'] as List<dynamic>?) ?? [];
        setState(() {
          _certificates = data
              .whereType<Map>()
              .map((c) => CertificateRow.fromJson(Map<String, dynamic>.from(c)))
              .toList();
          _isLoading = false;
        });
      } else {
        setState(() {
          _error = 'โหลดใบรับรองไม่สำเร็จ (${response.statusCode})';
          _isLoading = false;
        });
      }
    } on DioException catch (e) {
      setState(() {
        _error = e.error?.toString() ??
            'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่';
        _isLoading = false;
      });
    } catch (e) {
      debugPrint('Certificates load error: $e');
      setState(() {
        _error = 'ไม่สามารถโหลดใบรับรองได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
        _isLoading = false;
      });
    }
  }

  Future<void> _downloadCertificate(CertificateRow cert) async {
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(
      const SnackBar(content: Text('กำลังดาวน์โหลดใบรับรอง...')),
    );
    try {
      final dio = ref.read(dioClientProvider);
      final response = await dio.get(
        '/certificates/${cert.id}/download',
        options: Options(responseType: ResponseType.bytes),
      );
      if (response.statusCode != 200 || response.data == null) {
        messenger.showSnackBar(
          SnackBar(
              content:
                  Text('ดาวน์โหลดไม่สำเร็จ (${response.statusCode})')),
        );
        return;
      }
      final bytes = Uint8List.fromList(List<int>.from(response.data as List));
      final fileName = cert.certificateNumber.isNotEmpty
          ? 'GACP-Certificate-${cert.certificateNumber}.pdf'
          : 'GACP-Certificate.pdf';
      // On mobile, saveFile REQUIRES the bytes param and writes the file
      // itself; returns null when the user cancels the picker.
      final savedPath = await FilePicker.platform.saveFile(
        dialogTitle: 'บันทึกใบรับรอง',
        fileName: fileName,
        type: FileType.custom,
        allowedExtensions: const ['pdf'],
        bytes: bytes,
      );
      if (savedPath != null) {
        messenger.showSnackBar(
          const SnackBar(content: Text('บันทึกใบรับรองเรียบร้อยแล้ว')),
        );
      }
    } on DioException catch (e) {
      messenger.showSnackBar(
        SnackBar(
            content: Text(
                'ดาวน์โหลดไม่สำเร็จ: ${e.error ?? 'เชื่อมต่อไม่ได้'}')),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('ดาวน์โหลดไม่สำเร็จ: $e')),
      );
    }
  }

  void _showQrDialog(CertificateRow cert) {
    // qrCode from the API is the PUBLIC VERIFY URL string
    // (https://gacpth.com/verify/<certificateNumber>).
    final url = cert.qrCode;
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('ตรวจสอบใบรับรอง'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'เปิดลิงก์นี้เพื่อตรวจสอบความถูกต้องของใบรับรอง:',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            Container(
              width: double.maxFinite,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.grey.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: SelectableText(
                url.isNotEmpty ? url : 'ไม่พบลิงก์ตรวจสอบ',
                style: const TextStyle(fontSize: 13, fontFamily: 'monospace'),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('ปิด'),
          ),
          if (url.isNotEmpty)
            FilledButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: url));
                if (dialogContext.mounted) {
                  Navigator.of(dialogContext).pop();
                }
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('คัดลอกลิงก์แล้ว')),
                  );
                }
              },
              icon: const Icon(Icons.copy, size: 18),
              label: const Text('คัดลอกลิงก์'),
            ),
        ],
      ),
    );
  }

  String _formatDate(DateTime? date) {
    if (date == null) return '-';
    return '${date.day}/${date.month}/${date.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ใบรับรอง GACP'),
        elevation: 0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildErrorState()
              : _certificates.isEmpty
                  ? _buildEmptyState()
                  : RefreshIndicator(
                      onRefresh: _loadCertificates,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _certificates.length,
                        itemBuilder: (context, index) =>
                            _buildCertificateCard(_certificates[index]),
                      ),
                    ),
    );
  }

  Widget _buildCertificateCard(CertificateRow cert) {
    Color statusColor;
    String statusText;
    IconData statusIcon;

    if (cert.isExpired) {
      statusColor = Colors.red;
      statusText = 'หมดอายุ';
      statusIcon = Icons.cancel_outlined;
    } else if (cert.isExpiringSoon) {
      statusColor = Colors.orange;
      statusText = 'ใกล้หมดอายุ';
      statusIcon = Icons.warning_amber_outlined;
    } else {
      statusColor = Colors.green;
      statusText = 'ใช้งานได้';
      statusIcon = Icons.check_circle_outline;
    }

    final daysRemaining = cert.daysRemaining;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.withValues(alpha: 0.2)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Theme.of(context).primaryColor.withValues(alpha: 0.05),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(16),
                topRight: Radius.circular(16),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color:
                        Theme.of(context).primaryColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    Icons.verified,
                    color: Theme.of(context).primaryColor,
                    size: 28,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        cert.certificateNumber,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        cert.siteName,
                        style: TextStyle(fontSize: 13, color: Colors.grey[600]),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(100),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(statusIcon, size: 14, color: statusColor),
                      const SizedBox(width: 4),
                      Text(
                        statusText,
                        style: TextStyle(
                            fontSize: 12,
                            color: statusColor,
                            fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Details
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                _buildDetailRow('ชนิดพืช',
                    cert.plantType.isNotEmpty ? cert.plantType : '-'),
                _buildDetailRow('วันที่ออก', _formatDate(cert.issuedDate)),
                _buildDetailRow('วันหมดอายุ', _formatDate(cert.expiryDate)),
                _buildDetailRow(
                  'อายุคงเหลือ',
                  cert.isExpired
                      ? 'หมดอายุแล้ว'
                      : daysRemaining != null
                          ? '$daysRemaining วัน'
                          : '-',
                  valueColor: cert.isExpired
                      ? Colors.red
                      : (cert.isExpiringSoon ? Colors.orange : null),
                ),
              ],
            ),
          ),

          // Actions
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            decoration: BoxDecoration(
              border: Border(
                  top: BorderSide(color: Colors.grey.withValues(alpha: 0.1))),
            ),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _downloadCertificate(cert),
                    icon: const Icon(Icons.download),
                    label: const Text('ดาวน์โหลด'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => _showQrDialog(cert),
                    icon: const Icon(Icons.qr_code),
                    label: const Text('QR Code'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontSize: 13, color: Colors.grey[600])),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: valueColor,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
            const SizedBox(height: 16),
            const Text(
              'โหลดใบรับรองไม่สำเร็จ',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            Text(
              _error ?? '',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: Colors.grey[600]),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _loadCertificates,
              icon: const Icon(Icons.refresh),
              label: const Text('ลองใหม่'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: Theme.of(context).primaryColor.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Icon(
              Icons.card_membership,
              size: 40,
              color: Theme.of(context).primaryColor,
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'ยังไม่มีใบรับรอง',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 8),
          Text(
            'เมื่อคำขอได้รับการอนุมัติ ใบรับรองจะแสดงที่นี่',
            style: TextStyle(fontSize: 14, color: Colors.grey[500]),
          ),
        ],
      ),
    );
  }
}
