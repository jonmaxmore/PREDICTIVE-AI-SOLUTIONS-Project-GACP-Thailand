/// Row model for the REAL GET /documents response
/// (apps/backend/routes/api/documents/documents.js:44-86):
///   { id, fileName, fileUrl, type (=stepKey||'application'),
///     applicationId, applicationNumber, uploadedAt }
///
/// The endpoint returns NO size/status/mimeType — the previous mobile model
/// invented those fields (they always fell back to defaults).
enum DocumentKind { pdf, image, other }

class DocumentRow {
  final String id;
  final String fileName;
  final String fileUrl;
  final String type;
  final String applicationId;
  final String applicationNumber;
  final DateTime? uploadedAt;

  const DocumentRow({
    required this.id,
    required this.fileName,
    required this.fileUrl,
    required this.type,
    required this.applicationId,
    required this.applicationNumber,
    required this.uploadedAt,
  });

  factory DocumentRow.fromJson(Map<String, dynamic> json) {
    return DocumentRow(
      id: json['id']?.toString() ?? '',
      fileName: json['fileName']?.toString() ?? '',
      fileUrl: json['fileUrl']?.toString() ?? '',
      type: json['type']?.toString() ?? '',
      applicationId: json['applicationId']?.toString() ?? '',
      applicationNumber: json['applicationNumber']?.toString() ?? '',
      uploadedAt: json['uploadedAt'] == null
          ? null
          : DateTime.tryParse(json['uploadedAt'].toString()),
    );
  }

  DocumentKind get kind {
    final dot = fileName.lastIndexOf('.');
    if (dot < 0) return DocumentKind.other;
    final ext = fileName.substring(dot + 1).toLowerCase();
    if (ext == 'pdf') return DocumentKind.pdf;
    if (const {'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic'}
        .contains(ext)) {
      return DocumentKind.image;
    }
    return DocumentKind.other;
  }
}
