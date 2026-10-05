import 'package:flutter/material.dart';
import 'package:cross_file/cross_file.dart'; // For XFile
import 'package:lucide_icons_flutter/lucide_icons.dart';

class DocumentUploadSection extends StatelessWidget {
  final List<Map<String, dynamic>> documents;
  final Map<String, XFile> uploadedFiles;
  final Map<String, String> videoLinks;
  final Function(String docId) onPickFile;
  final Function(String docId, String link) onLinkChanged;
  final Function(String docId) onViewFile;
  final Function(String docId) onDeleteFile;

  const DocumentUploadSection({
    super.key,
    required this.documents,
    required this.uploadedFiles,
    required this.videoLinks,
    required this.onPickFile,
    required this.onLinkChanged,
    required this.onViewFile,
    required this.onDeleteFile,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'รายการเอกสารที่ต้องแนบ (Required Documents)',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        ...documents.map((doc) => _buildDocumentItem(context, doc)),
      ],
    );
  }

  Widget _buildDocumentItem(BuildContext context, Map<String, dynamic> doc) {
    final docId = doc['id'] as String;
    final isUploaded = uploadedFiles.containsKey(docId);
    final isVideoLink = doc['isLink'] == true;
    final linkValue = videoLinks[docId];
    final isLinked = linkValue != null && linkValue.isNotEmpty;
    final isCompulsory = doc['required'] == true;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: (isUploaded || isLinked) ? Colors.green : Colors.grey.shade300,
          width: 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    doc['title'],
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: (isUploaded || isLinked)
                          ? Colors.green[700]
                          : Colors.black87,
                    ),
                  ),
                ),
                if (isCompulsory)
                  Container(
                    margin: const EdgeInsets.only(left: 8),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.red[50],
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: Colors.red[100]!),
                    ),
                    child: const Text('จำเป็น',
                        style: TextStyle(fontSize: 10, color: Colors.red)),
                  ),
                if (isUploaded || isLinked)
                  const Padding(
                    padding: EdgeInsets.only(left: 8),
                    child: Icon(Icons.check_circle, color: Colors.green),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(doc['description'] ?? '',
                style: TextStyle(fontSize: 12, color: Colors.grey[600])),
            const SizedBox(height: 12),
            if (isVideoLink)
              TextFormField(
                initialValue: linkValue,
                decoration: const InputDecoration(
                  labelText: 'วางลิงค์วิดีโอที่นี่ (Paste Video Link)',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(LucideIcons.tv),
                ),
                onChanged: (val) => onLinkChanged(docId, val),
              )
            else
              _buildUploadArea(context, docId, isUploaded),
          ],
        ),
      ),
    );
  }

  Widget _buildUploadArea(BuildContext context, String docId, bool isUploaded) {
    if (isUploaded) {
      final file = uploadedFiles[docId];
      final fileName = file?.name ?? 'ไฟล์';

      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.green[50],
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            const Icon(LucideIcons.fileCheck, color: Colors.green),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                fileName,
                style: const TextStyle(fontWeight: FontWeight.bold),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            IconButton(
              icon: const Icon(Icons.visibility, color: Colors.blue),
              onPressed: () => onViewFile(docId),
            ),
            IconButton(
              icon: const Icon(Icons.delete, color: Colors.red),
              onPressed: () => onDeleteFile(docId),
            ),
          ],
        ),
      );
    }

    return GestureDetector(
      onTap: () => onPickFile(docId),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.grey[400]!),
        ),
        child: Column(
          children: [
            Icon(LucideIcons.uploadCloud, size: 32, color: Colors.blue[600]),
            const SizedBox(height: 8),
            Text(
              'คลิกเพื่ออัปโหลดเอกสาร (Click to Upload)',
              style: TextStyle(
                  color: Colors.blue[600], fontWeight: FontWeight.bold),
            ),
            const Text(
              'รองรับ PDF หรือรูปภาพ (Max 100MB)',
              style: TextStyle(fontSize: 10, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}
