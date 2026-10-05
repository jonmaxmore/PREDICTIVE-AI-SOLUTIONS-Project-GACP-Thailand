// Unit tests for DocumentRow — parses the REAL GET /documents row
// (apps/backend/routes/api/documents/documents.js:44-86):
//   { id, fileName, fileUrl, type (=stepKey||'application'),
//     applicationId, applicationNumber, uploadedAt }
// NOTE: the endpoint returns NO size/status/mimeType — the old mobile model
// invented those fields. Kind is derived from the fileName extension.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/presentation/features/documents/document_model.dart';

void main() {
  test('parses the full contract row', () {
    final doc = DocumentRow.fromJson({
      'id': 'doc-1',
      'fileName': 'id_card.pdf',
      'fileUrl': '/uploads/documents/id_card.pdf',
      'type': 'documents',
      'applicationId': 'app-1',
      'applicationNumber': 'GACP-2569-000123',
      'uploadedAt': '2026-06-01T10:00:00.000Z',
    });
    expect(doc.id, 'doc-1');
    expect(doc.fileName, 'id_card.pdf');
    expect(doc.fileUrl, '/uploads/documents/id_card.pdf');
    expect(doc.type, 'documents');
    expect(doc.applicationId, 'app-1');
    expect(doc.applicationNumber, 'GACP-2569-000123');
    expect(doc.uploadedAt, isNotNull);
    expect(doc.uploadedAt!.year, 2026);
  });

  test('kind derived from fileName extension', () {
    DocumentRow row(String name) => DocumentRow.fromJson({
          'id': 'x',
          'fileName': name,
          'fileUrl': '/u/$name',
        });
    expect(row('a.pdf').kind, DocumentKind.pdf);
    expect(row('a.PDF').kind, DocumentKind.pdf, reason: 'case-insensitive');
    expect(row('photo.jpg').kind, DocumentKind.image);
    expect(row('photo.jpeg').kind, DocumentKind.image);
    expect(row('scan.png').kind, DocumentKind.image);
    expect(row('scan.webp').kind, DocumentKind.image);
    expect(row('letter.docx').kind, DocumentKind.other);
    expect(row('noextension').kind, DocumentKind.other);
  });

  test('tolerates missing optionals (empty strings / null date)', () {
    final doc = DocumentRow.fromJson({'id': 'doc-2'});
    expect(doc.fileName, '');
    expect(doc.fileUrl, '');
    expect(doc.type, '');
    expect(doc.applicationNumber, '');
    expect(doc.uploadedAt, isNull);
  });
}
