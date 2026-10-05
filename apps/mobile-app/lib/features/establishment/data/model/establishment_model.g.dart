// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'establishment_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$EstablishmentModelImpl _$$EstablishmentModelImplFromJson(
        Map<String, dynamic> json) =>
    _$EstablishmentModelImpl(
      id: json['id'] as String?,
      name: json['name'] as String,
      type: $enumDecode(_$EstablishmentTypeEnumMap, json['type']),
      address: EstablishmentAddressModel.fromJson(
          json['address'] as Map<String, dynamic>),
      coordinates: EstablishmentCoordinatesModel.fromJson(
          json['coordinates'] as Map<String, dynamic>),
      images: (json['images'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const [],
      titleDeedNo: json['titleDeedNo'] as String? ?? '',
      security: json['security'] as String? ?? '',
    );

Map<String, dynamic> _$$EstablishmentModelImplToJson(
        _$EstablishmentModelImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'type': _$EstablishmentTypeEnumMap[instance.type]!,
      'address': instance.address,
      'coordinates': instance.coordinates,
      'images': instance.images,
      'titleDeedNo': instance.titleDeedNo,
      'security': instance.security,
    };

const _$EstablishmentTypeEnumMap = {
  EstablishmentType.farm: 'farm',
  EstablishmentType.shop: 'shop',
  EstablishmentType.processing: 'processing',
  EstablishmentType.extraction: 'extraction',
};

_$EstablishmentAddressModelImpl _$$EstablishmentAddressModelImplFromJson(
        Map<String, dynamic> json) =>
    _$EstablishmentAddressModelImpl(
      street: json['street'] as String,
      city: json['city'] as String,
      zipCode: json['zipCode'] as String,
    );

Map<String, dynamic> _$$EstablishmentAddressModelImplToJson(
        _$EstablishmentAddressModelImpl instance) =>
    <String, dynamic>{
      'street': instance.street,
      'city': instance.city,
      'zipCode': instance.zipCode,
    };

_$EstablishmentCoordinatesModelImpl
    _$$EstablishmentCoordinatesModelImplFromJson(Map<String, dynamic> json) =>
        _$EstablishmentCoordinatesModelImpl(
          lat: (json['lat'] as num).toDouble(),
          lng: (json['lng'] as num).toDouble(),
        );

Map<String, dynamic> _$$EstablishmentCoordinatesModelImplToJson(
        _$EstablishmentCoordinatesModelImpl instance) =>
    <String, dynamic>{
      'lat': instance.lat,
      'lng': instance.lng,
    };
