import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/dio_client.dart';
import '../../../../core/providers/core_providers.dart';
import '../models/gacp_application_models.dart';

/// Maps the mobile wizard's in-memory [GACPApplication] into the EXACT canonical
/// `formData` shape the backend `validateCanonicalSubmission` requires
/// (apps/backend/validation/canonical-application-validator.js).
///
/// Pure + deterministic so it can be unit-tested without a network.
///
/// Required-by-backend fields (per contract):
///  - plantId (non-empty), cultivationMethods (>=1)
///  - applicantData.applicantType in {INDIVIDUAL, COMMUNITY, JURISTIC}
///      INDIVIDUAL: firstName, lastName, idCard(>=13), phone, address
///  - farmData: farmName, address, province, totalAreaSize
///  - plots[0]: name, areaSize, solarSystem  (plots.length >= 1)
///  - productionData: propagationType(>=1), plantParts(>=1)
///  - harvestData: harvestMethod, dryingMethod, storageSystem
///  - documents: >=1 with uploaded/url/fileName
/// Why this application cannot be submitted yet for want of a purpose, in Thai — or null
/// when one is chosen. The backend refuses an empty list (400 CERTIFICATION_PURPOSE_INVALID);
/// this asks first, so the applicant is not sent a refusal for something no screen hid.
String? missingPurposeMessage(GACPApplication app) {
  if (app.certificationPurposes.isNotEmpty) return null;
  return 'กรุณาเลือกวัตถุประสงค์การขอรับรองอย่างน้อยหนึ่งข้อ ในขั้นตอนที่ 2';
}

Map<String, dynamic> buildCanonicalFormData(GACPApplication app) {
  final p = app.profile;
  final loc = app.location;
  final prod = app.production;

  const applicantTypeMap = {
    'Individual': 'INDIVIDUAL',
    'Community': 'COMMUNITY',
    'Juristic': 'JURISTIC',
  };
  final applicantType = applicantTypeMap[p.applicantType] ?? 'INDIVIDUAL';

  const serviceTypeMap = {
    ServiceType.newApplication: 'new_application',
    ServiceType.renewal: 'renewal',
    ServiceType.replacement: 'replacement',
  };
  final serviceType = serviceTypeMap[app.type] ?? 'new_application';

  const ownershipMap = {'Own': 'OWN', 'Rent': 'RENT', 'Consent': 'CONSENT'};

  // cultivationMethods = distinct non-empty plot solar systems (fallback OUTDOOR)
  final methodSet = <String>{
    for (final plot in loc.plots)
      if (plot.solarSystem.trim().isNotEmpty) plot.solarSystem.trim(),
  };
  final methods = methodSet.isNotEmpty ? methodSet.toList() : <String>['OUTDOOR'];

  // total area: prefer explicit rai, else sum plot areas
  String totalAreaSize = '';
  if ((prod.areaSizeRai ?? 0) > 0) {
    totalAreaSize = prod.areaSizeRai!.toString();
  } else {
    double sum = 0;
    for (final plot in loc.plots) {
      sum += double.tryParse(plot.areaSize.trim()) ?? 0;
    }
    if (sum > 0) totalAreaSize = sum.toString();
  }

  final applicantData = <String, dynamic>{
    'applicantType': applicantType,
    'idCard': p.idCard,
    'phone': p.mobile,
    'email': p.email,
    'address': p.address,
    'province': loc.province,
  };
  if (applicantType == 'INDIVIDUAL') {
    final first = p.firstName.isNotEmpty ? p.firstName : _firstToken(p.name);
    final last = p.lastName.isNotEmpty ? p.lastName : _restTokens(p.name);
    applicantData['firstName'] = first;
    applicantData['lastName'] = last;
    applicantData['name'] =
        p.name.isNotEmpty ? p.name : '$first $last'.trim();
  } else if (applicantType == 'COMMUNITY') {
    applicantData['communityName'] = p.name;
    applicantData['presidentName'] = p.responsibleName;
    // Step 4 collects the entity's registration number in the idCard field
    // ("เลขบัตรปชช. / เลขนิติบุคคล") — map it to the backend's required key.
    applicantData['communityRegNumber'] = p.idCard;
    applicantData['name'] = p.name;
  } else {
    applicantData['companyName'] = p.name;
    applicantData['directorName'] = p.responsibleName;
    applicantData['registrationNumber'] = p.idCard;
    applicantData['taxId'] = p.idCard;
    applicantData['name'] = p.name;
  }

  final farmData = <String, dynamic>{
    'farmName': loc.name,
    'address': loc.address,
    'province': loc.province,
    'totalAreaSize': totalAreaSize,
    'totalAreaUnit': prod.areaSizeUnit ?? 'Rai',
    'landOwnership': ownershipMap[loc.landOwnership] ?? loc.landOwnership,
    'gpsLat': loc.lat?.toString() ?? '',
    'gpsLng': loc.lng?.toString() ?? '',
    'hasFence': app.securityMeasures.hasFence,
    'hasCCTV': app.securityMeasures.hasCCTV,
  };

  final plots = [
    for (final plot in loc.plots)
      {
        'id': plot.id,
        'name': plot.name,
        'areaSize': plot.areaSize,
        'areaUnit': plot.areaUnit,
        'solarSystem': plot.solarSystem,
      }
  ];

  final productionData = <String, dynamic>{
    'propagationType':
        prod.sourceType.trim().isNotEmpty ? [prod.sourceType] : <String>[],
    'plantParts': prod.plantParts,
    'sourceDetail': prod.sourceDetail,
    'estimatedYield': prod.estimatedYield,
    'productionCycle': prod.productionCycle,
    if (prod.treeCount != null) 'treeCount': prod.treeCount,
    if (prod.areaSizeRai != null) 'areaSizeRai': prod.areaSizeRai,
  };

  final harvestData = <String, dynamic>{
    'harvestMethod': prod.postHarvest.harvestMethod,
    'dryingMethod': prod.postHarvest.dryingMethod,
    'storageSystem': prod.postHarvest.storage,
    'packaging': prod.postHarvest.packaging,
  };

  final documents = [for (final d in app.documents) d.toMap()];

  return {
    // Pin the draft the documents were uploaded to (backend
    // findOrCreateApplicationForHealth reads payload.applicationId) — without
    // this, /prepare re-resolves "latest open draft" and could silently merge
    // over a draft the user has open on the WEB.
    if (app.applicationId != null && app.applicationId!.isNotEmpty)
      'applicationId': app.applicationId,
    'plantId': app.plantId ?? '',
    'serviceType': serviceType,
    // What the applicant chose in step 2 — never a default (operator ruling 2026-10-05).
    'certificationPurposes': app.certificationPurposes,
    'cultivationMethods': methods,
    'locationType': methods.first,
    'applicantData': applicantData,
    'farmData': farmData,
    'siteData': const <String, dynamic>{},
    'plots': plots,
    'productionData': productionData,
    'harvestData': harvestData,
    'documents': documents,
    'consentedPDPA': app.consentedPDPA,
    'acknowledgedStandards': app.acceptedStandards,
  };
}

String _firstToken(String name) {
  final parts = name.trim().split(RegExp(r'\s+'));
  return parts.isNotEmpty ? parts.first : '';
}

String _restTokens(String name) {
  final parts = name.trim().split(RegExp(r'\s+'));
  return parts.length > 1 ? parts.sublist(1).join(' ') : '';
}

/// Result of a successful two-step create+submit.
class SubmitResult {
  final String applicationId;
  final String applicationNumber;
  final String status; // e.g. PENDING_DOC_FEE
  final String nextRequiredAction; // e.g. PAY_PHASE_1

  const SubmitResult({
    required this.applicationId,
    required this.applicationNumber,
    required this.status,
    required this.nextRequiredAction,
  });
}

/// One uploaded draft document + the backend applicationId it created/attached to.
class DraftDocumentUploadResult {
  final UploadedDocRef doc;
  final String applicationId;
  const DraftDocumentUploadResult({required this.doc, required this.applicationId});
}

/// Thrown for any create/submit/upload failure with a user-presentable message.
class SubmitException implements Exception {
  final String message;
  final List<String> missingFields;
  final int? statusCode;
  const SubmitException(this.message,
      {this.missingFields = const [], this.statusCode});
  @override
  String toString() => message;
}

/// Real applicant create/submit against the backend (`/api/v1/applications/*`).
/// Mirrors the web wizard: upload documents -> prepare (persist canonical
/// formData) -> submit (transition DRAFT -> PENDING_DOC_FEE).
class ApplicationSubmitService {
  final DioClient _client;
  ApplicationSubmitService(this._client);

  /// Upload one supporting document as multipart. The backend finds/creates the
  /// applicant's open draft and appends to `formData.draftDocuments[]`, returning
  /// the applicationId + file url. Caller must also carry the returned
  /// [UploadedDocRef] into `formData.documents[]` (via /prepare) to satisfy the
  /// step-8 submit gate.
  Future<DraftDocumentUploadResult> uploadDraftDocument({
    required List<int> bytes,
    required String filename,
    required String slotId,
  }) async {
    try {
      final ext = filename.contains('.')
          ? filename.split('.').last.toLowerCase()
          : '';
      final formData = FormData.fromMap({
        'file': MultipartFile.fromBytes(
          bytes,
          filename: filename,
          contentType: _mediaTypeForExt(ext),
        ),
        'slotId': slotId,
        'stepKey': 'documents',
      });
      final res =
          await _client.post('/applications/draft-documents', data: formData);
      final data = _unwrap(res);
      return DraftDocumentUploadResult(
        applicationId: data['applicationId']?.toString() ??
            data['draftId']?.toString() ??
            '',
        doc: UploadedDocRef(
          documentId: data['documentId']?.toString() ?? '',
          type: slotId,
          name: data['fileName']?.toString() ?? filename,
          url: data['fileUrl']?.toString() ?? data['url']?.toString() ?? '',
        ),
      );
    } on DioException catch (e) {
      throw _toSubmitException(e, 'อัปโหลดเอกสารไม่สำเร็จ');
    }
  }

  /// Persist the canonical formData (`/prepare`) then transition (`/submit`).
  Future<SubmitResult> prepareAndSubmit(GACPApplication app) async {
    final purposeMessage = missingPurposeMessage(app);
    if (purposeMessage != null) throw SubmitException(purposeMessage);
    final formData = buildCanonicalFormData(app);
    try {
      final prepRes = await _client.post('/applications/prepare', data: formData);
      final prep = _unwrap(prepRes);
      final appId =
          prep['id']?.toString() ?? (app.applicationId ?? '');
      if (appId.isEmpty) {
        throw const SubmitException('เซิร์ฟเวอร์ไม่ส่งเลขคำขอกลับมา');
      }

      final subRes = await _client
          .post('/applications/submit', data: {'applicationId': appId});
      final sub = _unwrap(subRes);
      final body = subRes.data;
      final nextAction = (body is Map ? body['nextRequiredAction'] : null);

      return SubmitResult(
        applicationId: sub['id']?.toString() ?? appId,
        applicationNumber: sub['applicationNumber']?.toString() ??
            prep['applicationNumber']?.toString() ??
            '',
        status: sub['status']?.toString() ?? '',
        nextRequiredAction: nextAction?.toString() ?? '',
      );
    } on DioException catch (e) {
      throw _toSubmitException(e, 'ส่งคำขอไม่สำเร็จ');
    }
  }

  Map<String, dynamic> _unwrap(Response res) {
    final body = res.data;
    if (body is Map && body['data'] is Map) {
      return Map<String, dynamic>.from(body['data'] as Map);
    }
    if (body is Map) return Map<String, dynamic>.from(body);
    return <String, dynamic>{};
  }

  SubmitException _toSubmitException(DioException e, String fallback) {
    final status = e.response?.statusCode;
    final data = e.response?.data;
    String message = fallback;
    final missing = <String>[];
    if (data is Map) {
      final m = data['messageTh'] ?? data['message'] ?? data['error'];
      if (m is String && m.trim().isNotEmpty) message = m;
      final mf = data['missingFields'];
      if (mf is List) {
        missing.addAll(mf.map((e) => e.toString()));
      }
    } else if (e.error is Exception) {
      message = e.error.toString();
    }
    return SubmitException(message, missingFields: missing, statusCode: status);
  }
}

DioMediaType _mediaTypeForExt(String ext) {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return DioMediaType('image', 'jpeg');
    case 'png':
      return DioMediaType('image', 'png');
    case 'webp':
      return DioMediaType('image', 'webp');
    case 'pdf':
      return DioMediaType('application', 'pdf');
    default:
      return DioMediaType('application', 'octet-stream');
  }
}

final applicationSubmitServiceProvider =
    Provider<ApplicationSubmitService>((ref) {
  return ApplicationSubmitService(ref.read(dioClientProvider));
});
