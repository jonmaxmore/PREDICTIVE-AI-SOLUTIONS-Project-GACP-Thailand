import 'package:equatable/equatable.dart';

class UserEntity extends Equatable {
  final String id;
  final String? email; // Optional for non-PROVIDER accounts
  final String firstName;
  final String lastName;
  final String role;
  final String? phoneNumber;
  final String? address;
  final String? province;
  final String? district;
  final String? subdistrict;
  final String? zipCode;
  final DateTime? registeredAt;

  // Multi-account type fields
  final String?
      accountType; // INDIVIDUAL, JURISTIC, COMMUNITY_ENTERPRISE, provider
  final String? companyName; // For JURISTIC accounts
  final String? communityName; // For COMMUNITY_ENTERPRISE accounts

  const UserEntity({
    required this.id,
    this.email,
    required this.firstName,
    required this.lastName,
    required this.role,
    this.phoneNumber,
    this.address,
    this.province,
    this.district,
    this.subdistrict,
    this.zipCode,
    this.registeredAt,
    this.accountType,
    this.companyName,
    this.communityName,
  });

  /// Get display name based on account type
  String get displayName {
    if (accountType == 'JURISTIC' && companyName != null) {
      return companyName!;
    }
    if (accountType == 'COMMUNITY_ENTERPRISE' && communityName != null) {
      return communityName!;
    }
    return '$firstName $lastName';
  }

  @override
  List<Object?> get props => [
        id,
        email,
        firstName,
        lastName,
        role,
        phoneNumber,
        address,
        province,
        district,
        subdistrict,
        zipCode,
        registeredAt,
        accountType,
        companyName,
        communityName,
      ];
}
