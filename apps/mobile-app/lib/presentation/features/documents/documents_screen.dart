import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers/core_providers.dart';
import 'document_model.dart';

/// Documents Screen — wired to the REAL backend (M4b).
///
/// GET /documents (flattens formData.draftDocuments across the applicant's
/// applications) via the shared [dioClientProvider]. Read-only: uploads
/// happen inside the application wizard (step 7), so the fake upload
/// FAB/menu stubs were removed rather than left as dead snackbars.
///
/// ⚠️ Never use GET /applications/draft-documents for reads — it has
/// find-or-CREATE semantics and would silently create a draft application.
class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key});

  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  bool _isLoading = true;
  String? _error;
  List<DocumentRow> _documents = [];

  @override
  void initState() {
    super.initState();
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final dio = ref.read(dioClientProvider);
      final response = await dio.get('/documents');
      final body = response.data;
      if (response.statusCode == 200 &&
          body is Map &&
          body['success'] == true) {
        final List<dynamic> data = (body['data'] as List<dynamic>?) ?? [];
        setState(() {
          _documents = data
              .whereType<Map>()
              .map((d) => DocumentRow.fromJson(Map<String, dynamic>.from(d)))
              .toList();
          _isLoading = false;
        });
      } else {
        setState(() {
          _error = 'โหลดเอกสารไม่สำเร็จ (${response.statusCode})';
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
      setState(() {
        _error = 'เกิดข้อผิดพลาด: $e';
        _isLoading = false;
      });
    }
  }

  String _formatDate(DateTime? date) {
    if (date == null) return '-';
    return '${date.day}/${date.month}/${date.year}';
  }

  (IconData, Color) _iconFor(DocumentRow doc) {
    switch (doc.kind) {
      case DocumentKind.pdf:
        return (Icons.picture_as_pdf, Colors.red);
      case DocumentKind.image:
        return (Icons.image, Colors.blue);
      case DocumentKind.other:
        return (Icons.insert_drive_file, Colors.grey);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('เอกสาร'),
        elevation: 0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildErrorState()
              : _documents.isEmpty
                  ? _buildEmptyState()
                  : RefreshIndicator(
                      onRefresh: _loadDocuments,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _documents.length,
                        itemBuilder: (context, index) =>
                            _buildDocumentCard(_documents[index]),
                      ),
                    ),
    );
  }

  Widget _buildDocumentCard(DocumentRow doc) {
    final (icon, iconColor) = _iconFor(doc);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.withValues(alpha: 0.2)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: iconColor.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: iconColor),
        ),
        title: Text(
          doc.fileName.isNotEmpty ? doc.fileName : 'ไม่ทราบชื่อไฟล์',
          style: const TextStyle(fontWeight: FontWeight.w500),
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            if (doc.applicationNumber.isNotEmpty)
              Text(
                'คำขอ ${doc.applicationNumber}',
                style: TextStyle(fontSize: 12, color: Colors.grey[600]),
              ),
            const SizedBox(height: 2),
            Text(
              'อัปโหลดเมื่อ ${_formatDate(doc.uploadedAt)}',
              style: TextStyle(fontSize: 12, color: Colors.grey[500]),
            ),
          ],
        ),
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
              'โหลดเอกสารไม่สำเร็จ',
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
              onPressed: _loadDocuments,
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
              Icons.folder_open,
              size: 40,
              color: Theme.of(context).primaryColor,
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'ยังไม่มีเอกสาร',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 8),
          Text(
            'เอกสารที่แนบในคำขอจะแสดงที่นี่',
            style: TextStyle(fontSize: 14, color: Colors.grey[500]),
          ),
        ],
      ),
    );
  }
}
