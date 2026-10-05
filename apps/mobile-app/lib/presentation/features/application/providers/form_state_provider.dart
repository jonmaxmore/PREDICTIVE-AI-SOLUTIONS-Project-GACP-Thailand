import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../domain/certification_purposes.dart';
import '../models/gacp_application_models.dart';

class ApplicationFormNotifier extends StateNotifier<GACPApplication> {
  ApplicationFormNotifier() : super(_emptyForm());

  static GACPApplication _emptyForm() => const GACPApplication(
        profile: ApplicantProfile(),
        location: SiteLocation(),
        securityMeasures: SecurityChecklist(),
        production: ProductionPlan(),
      );

  /// Wipe ALL wizard state. MUST be called after a successful submit (so the
  /// next application never inherits documents/ids from the previous one) and
  /// on logout (PII: national ID / address / phone must not survive into
  /// another account's session on a shared device).
  void resetForm() {
    state = _emptyForm();
  }

  // --- Step 0: Plant Config ---
  /// When plant changes, sanitize all context-dependent state.
  /// NOTE: built explicitly (NOT copyWith) — copyWith's `x ?? this.x` swallows
  /// explicit nulls, which made the old sanitize a silent no-op for
  /// licenseInfo/hasGapHistory/gapCertificateNumber, and never cleared
  /// documents (plant-dependent slots → zombie uploads).
  void setPlant(String plantId) {
    // Detect if plant is actually changing (not initial set)
    final isPlantChanging = state.plantId != null && state.plantId != plantId;

    if (isPlantChanging) {
      state = GACPApplication(
        applicationId: state.applicationId,
        establishmentId: state.establishmentId,
        plantId: plantId,
        type: state.type,
        profile: state.profile,
        licenseInfo: null, // Group A vs B differ — clear
        replacementReason: state.replacementReason,
        location: state.location,
        securityMeasures: const SecurityChecklist(), // reset
        production: const ProductionPlan(), // reset
        acceptedStandards: state.acceptedStandards,
        consentedPDPA: state.consentedPDPA,
        signatureBase64: state.signatureBase64,
        documents: const [], // plant-dependent doc slots — clear
        hasGapHistory: null,
        gapCertificateNumber: null,
      );
    } else {
      state = state.copyWith(plantId: plantId);
    }
  }

  void setEstablishmentId(String id) {
    state = state.copyWith(establishmentId: id);
  }

  // --- Step 1: Standards ---
  void acceptStandards(bool isAccepted) {
    state = state.copyWith(acceptedStandards: isAccepted);
  }

  // --- Step 2: Request Type ---
  void setServiceType(ServiceType type) {
    state = state.copyWith(type: type);
  }

  /// Tick or untick one purpose. Only the three codes of
  /// CertificationPurposes are accepted; the order stays the vocabulary's order so the
  /// list the backend sees does not depend on the order of the taps.
  void togglePurpose(String code) {
    if (!CertificationPurposes.codes.contains(code)) return;
    final chosen = state.certificationPurposes.toSet();
    if (!chosen.remove(code)) chosen.add(code);
    state = state.copyWith(certificationPurposes: [
      for (final known in CertificationPurposes.codes)
        if (chosen.contains(known)) known,
    ]);
  }

  // --- Step 3: Terms ---
  void consentPDPA(bool isConsented) {
    state = state.copyWith(consentedPDPA: isConsented);
  }

  // --- Step 4: Profile & License ---
  void updateProfile({
    String? applicantType,
    String? name,
    String? firstName,
    String? lastName,
    String? idCard,
    String? address,
    String? mobile,
    String? email,
    String? responsibleName,
    String? qualification,
  }) {
    // Switching applicant TYPE invalidates the name fields: a person's name
    // must not silently become companyName (and vice-versa). Reset them so the
    // user re-enters the right identity for the new type.
    final typeChanged = applicantType != null &&
        applicantType != state.profile.applicantType;
    final base = typeChanged
        ? state.profile
            .copyWith(applicantType: applicantType)
            .copyWith(name: '', firstName: '', lastName: '')
        : state.profile;

    final updated = base.copyWith(
      applicantType: applicantType,
      name: name,
      firstName: firstName,
      lastName: lastName,
      idCard: idCard,
      address: address,
      mobile: mobile,
      email: email,
      responsibleName: responsibleName,
      qualification: qualification,
    );
    // Keep the derived display `name` in sync with first/last for INDIVIDUAL,
    // unless the caller set `name` explicitly (entity types).
    final derivedName = name ??
        ((firstName != null || lastName != null)
            ? '${updated.firstName} ${updated.lastName}'.trim()
            : null);
    state = state.copyWith(
      profile: derivedName != null
          ? updated.copyWith(name: derivedName)
          : updated,
    );
  }

  void updateLicense({
    String? plantingStatus,
    String? notifyNumber,
    List<String>? licenses,
    String? licenseNumber,
    String? licenseType,
    String? licenseExpiry,
  }) {
    final currentLicense = state.licenseInfo ?? const LegalLicense();
    state = state.copyWith(
      licenseInfo: currentLicense.copyWith(
        plantingStatus: plantingStatus,
        notifyNumber: notifyNumber,
        licenses: licenses,
        licenseNumber: licenseNumber,
        licenseType: licenseType,
        licenseExpiry: licenseExpiry,
      ),
    );
  }

  /// Generic field update for dynamic form fields
  void updateField(String fieldName, dynamic value) {
    switch (fieldName) {
      case 'hasGapHistory':
        state = state.copyWith(hasGapHistory: value as bool?);
        break;
      case 'gapCertificateNumber':
        state = state.copyWith(gapCertificateNumber: value as String?);
        break;
      default:
        // For unknown fields, log a warning (could add more fields as needed)
        break;
    }
  }

  void updateReplacementReason({
    String? reason,
    String? policeReportNo,
    String? policeStation,
    DateTime? reportDate,
  }) {
    final currentReason = state.replacementReason ?? const ReplacementReason();
    state = state.copyWith(
      replacementReason: currentReason.copyWith(
        reason: reason,
        policeReportNo: policeReportNo,
        policeStation: policeStation,
        reportDate: reportDate,
      ),
    );
  }

  // --- Step 5: Location & Security ---
  void updateLocation({
    String? name,
    String? address,
    String? province,
    String? north,
    String? south,
    String? east,
    String? west,
    String? landOwnership,
    List<PlotDefinition>? plots,
  }) {
    state = state.copyWith(
      location: state.location.copyWith(
        name: name,
        address: address,
        province: province,
        north: north,
        south: south,
        east: east,
        west: west,
        landOwnership: landOwnership,
        plots: plots,
      ),
    );
  }

  void updateSecurity({
    bool? hasFence,
    bool? hasCCTV,
    bool? hasAccessControl,
    bool? hasAnimalBarrier,
    bool? hasZoning,
  }) {
    state = state.copyWith(
      securityMeasures: state.securityMeasures.copyWith(
        hasFence: hasFence,
        hasCCTV: hasCCTV,
        hasAccessControl: hasAccessControl,
        hasAnimalBarrier: hasAnimalBarrier,
        hasZoning: hasZoning,
      ),
    );
  }

  // --- Step 6: Production ---
  void updateProduction({
    List<String>? plantParts,
    String? sourceType,
    String? sourceDetail,
    double? areaSizeRai,
    String? areaSizeUnit,
    int? treeCount,
    double? estimatedYield,
    String? cycle,
  }) {
    state = state.copyWith(
      production: state.production.copyWith(
        plantParts: plantParts,
        sourceType: sourceType,
        sourceDetail: sourceDetail,
        areaSizeRai: areaSizeRai,
        areaSizeUnit: areaSizeUnit,
        treeCount: treeCount,
        estimatedYield: estimatedYield,
        productionCycle: cycle,
      ),
    );
  }

  // New methods for Farm Inputs & Post Harvest
  void addFarmInput(FarmInputItem item) {
    final newInputs = List<FarmInputItem>.from(state.production.farmInputs)
      ..add(item);
    state = state.copyWith(
        production: state.production.copyWith(farmInputs: newInputs));
  }

  void removeFarmInput(int index) {
    final newInputs = List<FarmInputItem>.from(state.production.farmInputs)
      ..removeAt(index);
    state = state.copyWith(
        production: state.production.copyWith(farmInputs: newInputs));
  }

  void updatePostHarvest(
      {String? harvestMethod,
      String? drying,
      String? packaging,
      String? storage}) {
    state = state.copyWith(
        production: state.production.copyWith(
            postHarvest: state.production.postHarvest.copyWith(
                harvestMethod: harvestMethod,
                dryingMethod: drying,
                packaging: packaging,
                storage: storage)));
  }

  // --- Step 7: Documents (real, backend-persisted) ---
  /// Add or replace an uploaded document. Replaces any existing doc with the
  /// same `type` (slot) so re-uploading a slot supersedes the prior file.
  void upsertDocument(UploadedDocRef doc) {
    final next = List<UploadedDocRef>.from(state.documents)
      ..removeWhere((d) => d.type == doc.type)
      ..add(doc);
    state = state.copyWith(documents: next);
  }

  void removeDocument(String documentId) {
    final next = state.documents
        .where((d) => d.documentId != documentId)
        .toList();
    state = state.copyWith(documents: next);
  }

  /// Stamp the backend applicationId once the draft is created/uploaded.
  void setApplicationId(String id) {
    state = state.copyWith(applicationId: id);
  }
}

final applicationFormProvider =
    StateNotifierProvider<ApplicationFormNotifier, GACPApplication>((ref) {
  return ApplicationFormNotifier();
});
