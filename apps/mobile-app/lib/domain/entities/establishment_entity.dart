import 'package:equatable/equatable.dart';

class EstablishmentEntity extends Equatable {
  final String id;
  final String name;
  final String type;
  final String address;
  final String status;
  final double? latitude;
  final double? longitude;
  final String? imageUrl;

  final String titleDeedNo;
  final String security;

  // Credibility Fields
  final DateTime? updatedAt;
  final DateTime? licenseExpiredAt;
  final String? licenseNumber;

  const EstablishmentEntity({
    required this.id,
    required this.name,
    required this.type,
    required this.address,
    required this.status,
    this.latitude,
    this.longitude,
    this.imageUrl,
    this.titleDeedNo = '',
    this.security = '',
    this.updatedAt,
    this.licenseExpiredAt,
    this.licenseNumber,
  });

  @override
  List<Object?> get props => [
        id,
        name,
        type,
        address,
        status,
        latitude,
        longitude,
        imageUrl,
        titleDeedNo,
        security,
        updatedAt,
        licenseExpiredAt,
        licenseNumber,
      ];

  factory EstablishmentEntity.fromJson(Map<String, dynamic> json) {
    // GeoJSON handling: location.coordinates is complex
    double? lat;
    double? lng;
    if (json['location'] != null && json['location']['coordinates'] != null) {
      final coords = json['location']['coordinates'] as List;
      if (coords.length >= 2) {
        lng = coords[0] is num
            ? (coords[0] as num).toDouble()
            : double.tryParse(coords[0].toString());
        lat = coords[1] is num
            ? (coords[1] as num).toDouble()
            : double.tryParse(coords[1].toString());
      }
    }

    return EstablishmentEntity(
      id: json['id'] ?? json['_id'] ?? '',
      name: json['name'] ?? '',
      type: json['type'] ?? '',
      address: json['address'] ??
          (json['location'] != null ? json['location']['address'] : ''),
      status: json['status'] ?? 'ACTIVE',
      latitude: lat,
      longitude: lng,
      imageUrl: json['imageUrl'] ?? json['image'],
      titleDeedNo: json['titleDeedNo'] ?? '',
      security: json['security'] ?? '',
      licenseNumber: json['licenseNumber'],
      updatedAt: json['updatedAt'] != null
          ? DateTime.tryParse(json['updatedAt'])
          : null,
      licenseExpiredAt: json['licenseExpiredAt'] != null
          ? DateTime.tryParse(json['licenseExpiredAt'])
          : null,
    );
  }
}
