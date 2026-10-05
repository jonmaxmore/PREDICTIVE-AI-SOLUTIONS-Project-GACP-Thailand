import 'package:equatable/equatable.dart';

class ApplicationEntity extends Equatable {
  final String id;
  final String type; // 'GACP_FORM_9', 'GACP_FORM_10', 'GACP_FORM_11'
  final String status;
  final String establishmentId;
  final String establishmentName;

  // ── Real /applications/my fields (mapHealthApplication shape) ──
  final String applicationNumber;
  final String plantName;
  final String serviceType;
  final String dashboardStage;
  final bool hasCertificate;
  /// round 5: GET /applications/my `isRenewal` — a renewal pays one charge (the
  /// renewal service) and has its own timeline.
  final bool isRenewal;
  final DateTime? submittedAt;
  
  // Farm Details (Form 9)
  final double? totalArea;
  final double? cultivatedArea;
  final String areaUnit;
  final String landOwnershipType;
  final String landDocumentId;
  final String waterSourceType;
  final String soilType;
  final String plantingSystem;

  // Crop Information (Form 9)
  final String cropName;
  final String cropVariety;
  final String cropSource;
  final String plantingMethod;

  // Security & Storage (Form 9 & 10)
  final String fenceDescription;
  final int? cctvCount;
  final int? guardCount;
  final String accessControl;
  final String storageLocation;
  final String storageSecurity;
  final bool tempControl;

  // Form 10 (Sale)
  final String dispensingMethod; // 'pharmacy', 'clinic', 'other'
  final String pharmacistName;
  final String pharmacistLicense;
  final String operatingHours; // New
  final String commercialRegNumber; // New

  // Form 11 (Import/Export)
  final String importExportType; // 'import', 'export'
  final String country;
  final String portOfEntryExit;
  final String transportMode; // 'air', 'sea', 'land'
  final String carrierName;
  final DateTime? expectedDate;
  final String plantParts; // New: 'flower', 'seed', 'extract'
  final double? quantity; // New

  // Documents
  final List<String> documents;
  final DateTime createdAt;

  const ApplicationEntity({
    required this.id,
    required this.type,
    required this.status,
    required this.establishmentId,
    required this.establishmentName,
    this.applicationNumber = '',
    this.plantName = '',
    this.serviceType = '',
    this.dashboardStage = '',
    this.hasCertificate = false,
    this.isRenewal = false,
    this.submittedAt,

    // Form 9 Defaults
    this.totalArea,
    this.cultivatedArea,
    this.areaUnit = 'rai',
    this.landOwnershipType = 'owned',
    this.landDocumentId = '',
    this.waterSourceType = 'well',
    this.soilType = 'loam',
    this.plantingSystem = 'soil',
    this.cropName = '',
    this.cropVariety = '',
    this.cropSource = '',
    this.plantingMethod = 'seeds',
    this.fenceDescription = '',
    this.cctvCount,
    this.guardCount,
    this.accessControl = '',
    this.storageLocation = '',
    this.storageSecurity = '',
    this.tempControl = false,

    // Form 10 Defaults
    this.dispensingMethod = 'pharmacy',
    this.pharmacistName = '',
    this.pharmacistLicense = '',
    this.operatingHours = '',
    this.commercialRegNumber = '',

    // Form 11 Defaults
    this.importExportType = 'import',
    this.country = '',
    this.portOfEntryExit = '',
    this.transportMode = 'air',
    this.carrierName = '',
    this.expectedDate,
    this.plantParts = '',
    this.quantity,

    required this.documents,
    required this.createdAt,
  });

  @override
  List<Object?> get props => [
    id, type, status, establishmentId, establishmentName,
    applicationNumber, plantName, serviceType, dashboardStage,
    hasCertificate, isRenewal, submittedAt,
    totalArea, cultivatedArea, areaUnit, landOwnershipType, landDocumentId,
    waterSourceType, soilType, plantingSystem,
    cropName, cropVariety, cropSource, plantingMethod,
    fenceDescription, cctvCount, guardCount, accessControl,
    storageLocation, storageSecurity, tempControl,
    dispensingMethod, pharmacistName, pharmacistLicense, operatingHours, commercialRegNumber,
    importExportType, country, portOfEntryExit, transportMode, carrierName, expectedDate, plantParts, quantity,
    documents, createdAt
  ];
}
