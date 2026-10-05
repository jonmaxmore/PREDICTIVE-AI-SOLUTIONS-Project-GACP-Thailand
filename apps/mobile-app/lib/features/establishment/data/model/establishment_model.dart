import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entity/establishment_entity.dart';

part 'establishment_model.freezed.dart';
part 'establishment_model.g.dart';

@freezed
class EstablishmentModel with _$EstablishmentModel {
  const EstablishmentModel._();

  const factory EstablishmentModel({
    String? id,
    required String name,
    required EstablishmentType type,
    required EstablishmentAddressModel address,
    required EstablishmentCoordinatesModel coordinates,
    @Default([]) List<String> images,
    @Default('') String titleDeedNo, // Default empty for backward compat
    @Default('') String security,
  }) = _EstablishmentModel;

  factory EstablishmentModel.fromJson(Map<String, dynamic> json) =>
      _$EstablishmentModelFromJson(json);

  EstablishmentEntity toEntity() {
    final idSource = (id == null || id!.isEmpty) ? 'TEST' : id!;
    final normalized = idSource.replaceAll('-', '').toUpperCase();
    final licenseSuffix =
        normalized.length <= 4 ? normalized : normalized.substring(0, 4);

    return EstablishmentEntity(
      id: id,
      name: name,
      type: type,
      address: address.toEntity(),
      coordinates: coordinates.toEntity(),
      images: images,
      titleDeedNo: titleDeedNo,
      security: security,
      // Mock Data for UI Demonstration
      updatedAt: DateTime.now().subtract(Duration(days: id?.length ?? 1)),
      licenseExpiredAt: DateTime.now().add(const Duration(days: 365)),
      licenseNumber: 'GACP-2024-$licenseSuffix',
    );
  }
}

@freezed
class EstablishmentAddressModel with _$EstablishmentAddressModel {
  const EstablishmentAddressModel._();

  const factory EstablishmentAddressModel({
    required String street,
    required String city,
    required String zipCode,
  }) = _EstablishmentAddressModel;

  factory EstablishmentAddressModel.fromJson(Map<String, dynamic> json) =>
      _$EstablishmentAddressModelFromJson(json);

  EstablishmentAddress toEntity() {
    return EstablishmentAddress(
      street: street,
      city: city,
      zipCode: zipCode,
    );
  }
}

@freezed
class EstablishmentCoordinatesModel with _$EstablishmentCoordinatesModel {
  const EstablishmentCoordinatesModel._();

  const factory EstablishmentCoordinatesModel({
    required double lat,
    required double lng,
  }) = _EstablishmentCoordinatesModel;

  factory EstablishmentCoordinatesModel.fromJson(Map<String, dynamic> json) =>
      _$EstablishmentCoordinatesModelFromJson(json);

  EstablishmentCoordinates toEntity() {
    return EstablishmentCoordinates(
      lat: lat,
      lng: lng,
    );
  }
}
