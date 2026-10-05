import 'package:flutter/material.dart';
import '../../presentation/features/application/providers/form_state_provider.dart';
import 'cannabis_strategy.dart';
import 'general_strategy.dart';

/// Plant Group Classification
enum PlantGroup {
  highControl, // Cannabis, Kratom
  general, // Turmeric, Ginger, etc.
}

/// Security Requirement Definition
class SecurityRequirement {
  final String label;
  final bool required;
  final String? description;

  const SecurityRequirement(this.label,
      {this.required = true, this.description});
}

/// Document Requirement Definition
class DocumentRequirement {
  final String id;
  final String name;
  final String nameTH;
  final String category;
  final bool isRequired;

  const DocumentRequirement({
    required this.id,
    required this.name,
    required this.nameTH,
    required this.category,
    this.isRequired = true,
  });
}

/// Strategy Protocol for Plant-Specific UI and Logic (Apple Standard)
abstract class PlantStrategy {
  // Identity
  String get id;
  String get name;
  PlantGroup get group;
  bool get requiresStrictLicense;

  // --- Step 4: License Section ---
  /// Build license input widgets for Step 4
  List<Widget> buildLicenseSectionWidgets(
      BuildContext context, ApplicationFormNotifier notifier, dynamic state);

  // --- Step 5: Security ---
  /// Get security requirements for this plant
  List<SecurityRequirement> getSecurityRequirements();

  /// Build security checklist widgets for Step 5
  List<Widget> buildSecurityWidgets(
      BuildContext context, ApplicationFormNotifier notifier, dynamic state);

  /// Validate Step 5 security data
  bool validateSecurity(dynamic securityMeasures);

  // --- Step 6: Production ---
  /// Build production plan widgets for Step 6
  List<Widget> buildProductionWidgets(
      BuildContext context, ApplicationFormNotifier notifier, dynamic state);

  /// Get available plant parts for this plant
  List<String> getPlantPartsOptions();

  /// Get yield label text
  String getYieldLabel();

  /// Whether this plant uses tree unit (vs rai/area)
  bool get usesTreeUnit;

  // --- Step 7: Documents ---
  /// Get required documents for this plant and request type
  List<DocumentRequirement> getDocumentRequirements(String requestType);

  /// Legacy method for simple document list
  List<String> getRequiredDocuments();
}

/// Factory to create Strategy instances (Factory Pattern)
class PlantStrategyFactory {
  static PlantStrategy getStrategy(String plantId) {
    switch (plantId.toUpperCase()) {
      case 'CAN':
        return CannabisStrategy();
      case 'KRA':
        return CannabisStrategy(); // Kratom uses same rules as Cannabis
      case 'TUR':
      case 'GIN':
      case 'BGA':
      case 'PLA':
        return GeneralStrategy();
      default:
        return GeneralStrategy();
    }
  }

  /// Get all available plant IDs
  static List<String> getAvailablePlantIds() {
    return ['CAN', 'KRA', 'TUR', 'GIN', 'BGA', 'PLA'];
  }
}
