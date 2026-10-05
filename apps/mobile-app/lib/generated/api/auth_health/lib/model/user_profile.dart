//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class UserProfile {
  /// Returns a new [UserProfile] instance.
  UserProfile({
    this.id,
    this.email,
    this.firstName,
    this.lastName,
    this.phoneNumber,
    this.idCard,
    this.province,
    this.role,
    this.status,
    this.isEmailVerified,
    this.createdAt,
    this.updatedAt,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? id;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? email;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? firstName;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? lastName;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? phoneNumber;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? idCard;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? province;

  UserProfileRoleEnum? role;

  UserProfileStatusEnum? status;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  bool? isEmailVerified;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? createdAt;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  DateTime? updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is UserProfile &&
    other.id == id &&
    other.email == email &&
    other.firstName == firstName &&
    other.lastName == lastName &&
    other.phoneNumber == phoneNumber &&
    other.idCard == idCard &&
    other.province == province &&
    other.role == role &&
    other.status == status &&
    other.isEmailVerified == isEmailVerified &&
    other.createdAt == createdAt &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (id == null ? 0 : id!.hashCode) +
    (email == null ? 0 : email!.hashCode) +
    (firstName == null ? 0 : firstName!.hashCode) +
    (lastName == null ? 0 : lastName!.hashCode) +
    (phoneNumber == null ? 0 : phoneNumber!.hashCode) +
    (idCard == null ? 0 : idCard!.hashCode) +
    (province == null ? 0 : province!.hashCode) +
    (role == null ? 0 : role!.hashCode) +
    (status == null ? 0 : status!.hashCode) +
    (isEmailVerified == null ? 0 : isEmailVerified!.hashCode) +
    (createdAt == null ? 0 : createdAt!.hashCode) +
    (updatedAt == null ? 0 : updatedAt!.hashCode);

  @override
  String toString() => 'UserProfile[id=$id, email=$email, firstName=$firstName, lastName=$lastName, phoneNumber=$phoneNumber, idCard=$idCard, province=$province, role=$role, status=$status, isEmailVerified=$isEmailVerified, createdAt=$createdAt, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.id != null) {
      json[r'id'] = this.id;
    } else {
      json[r'id'] = null;
    }
    if (this.email != null) {
      json[r'email'] = this.email;
    } else {
      json[r'email'] = null;
    }
    if (this.firstName != null) {
      json[r'firstName'] = this.firstName;
    } else {
      json[r'firstName'] = null;
    }
    if (this.lastName != null) {
      json[r'lastName'] = this.lastName;
    } else {
      json[r'lastName'] = null;
    }
    if (this.phoneNumber != null) {
      json[r'phoneNumber'] = this.phoneNumber;
    } else {
      json[r'phoneNumber'] = null;
    }
    if (this.idCard != null) {
      json[r'idCard'] = this.idCard;
    } else {
      json[r'idCard'] = null;
    }
    if (this.province != null) {
      json[r'province'] = this.province;
    } else {
      json[r'province'] = null;
    }
    if (this.role != null) {
      json[r'role'] = this.role;
    } else {
      json[r'role'] = null;
    }
    if (this.status != null) {
      json[r'status'] = this.status;
    } else {
      json[r'status'] = null;
    }
    if (this.isEmailVerified != null) {
      json[r'isEmailVerified'] = this.isEmailVerified;
    } else {
      json[r'isEmailVerified'] = null;
    }
    if (this.createdAt != null) {
      json[r'createdAt'] = this.createdAt!.toUtc().toIso8601String();
    } else {
      json[r'createdAt'] = null;
    }
    if (this.updatedAt != null) {
      json[r'updatedAt'] = this.updatedAt!.toUtc().toIso8601String();
    } else {
      json[r'updatedAt'] = null;
    }
    return json;
  }

  /// Returns a new [UserProfile] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static UserProfile? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        requiredKeys.forEach((key) {
          assert(json.containsKey(key), 'Required key "UserProfile[$key]" is missing from JSON.');
          assert(json[key] != null, 'Required key "UserProfile[$key]" has a null value in JSON.');
        });
        return true;
      }());

      return UserProfile(
        id: mapValueOfType<String>(json, r'id'),
        email: mapValueOfType<String>(json, r'email'),
        firstName: mapValueOfType<String>(json, r'firstName'),
        lastName: mapValueOfType<String>(json, r'lastName'),
        phoneNumber: mapValueOfType<String>(json, r'phoneNumber'),
        idCard: mapValueOfType<String>(json, r'idCard'),
        province: mapValueOfType<String>(json, r'province'),
        role: UserProfileRoleEnum.fromJson(json[r'role']),
        status: UserProfileStatusEnum.fromJson(json[r'status']),
        isEmailVerified: mapValueOfType<bool>(json, r'isEmailVerified'),
        createdAt: mapDateTime(json, r'createdAt', r''),
        updatedAt: mapDateTime(json, r'updatedAt', r''),
      );
    }
    return null;
  }

  static List<UserProfile> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <UserProfile>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = UserProfile.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, UserProfile> mapFromJson(dynamic json) {
    final map = <String, UserProfile>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = UserProfile.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of UserProfile-objects as value to a dart map
  static Map<String, List<UserProfile>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<UserProfile>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = UserProfile.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


class UserProfileRoleEnum {
  /// Instantiate a new enum with the provided [value].
  const UserProfileRoleEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const HEALTH_USER = UserProfileRoleEnum._(r'HEALTH_USER');
  static const INSPECTOR = UserProfileRoleEnum._(r'INSPECTOR');
  static const ADMIN = UserProfileRoleEnum._(r'ADMIN');

  /// List of all possible values in this [enum][UserProfileRoleEnum].
  static const values = <UserProfileRoleEnum>[
    HEALTH_USER,
    INSPECTOR,
    ADMIN,
  ];

  static UserProfileRoleEnum? fromJson(dynamic value) => UserProfileRoleEnumTypeTransformer().decode(value);

  static List<UserProfileRoleEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <UserProfileRoleEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = UserProfileRoleEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [UserProfileRoleEnum] to String,
/// and [decode] dynamic data back to [UserProfileRoleEnum].
class UserProfileRoleEnumTypeTransformer {
  factory UserProfileRoleEnumTypeTransformer() => _instance ??= const UserProfileRoleEnumTypeTransformer._();

  const UserProfileRoleEnumTypeTransformer._();

  String encode(UserProfileRoleEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a UserProfileRoleEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  UserProfileRoleEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'HEALTH_USER': return UserProfileRoleEnum.HEALTH_USER;
        case r'INSPECTOR': return UserProfileRoleEnum.INSPECTOR;
        case r'ADMIN': return UserProfileRoleEnum.ADMIN;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [UserProfileRoleEnumTypeTransformer] instance.
  static UserProfileRoleEnumTypeTransformer? _instance;
}



class UserProfileStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const UserProfileStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const PENDING_VERIFICATION = UserProfileStatusEnum._(r'PENDING_VERIFICATION');
  static const ACTIVE = UserProfileStatusEnum._(r'ACTIVE');
  static const SUSPENDED = UserProfileStatusEnum._(r'SUSPENDED');
  static const INACTIVE = UserProfileStatusEnum._(r'INACTIVE');

  /// List of all possible values in this [enum][UserProfileStatusEnum].
  static const values = <UserProfileStatusEnum>[
    PENDING_VERIFICATION,
    ACTIVE,
    SUSPENDED,
    INACTIVE,
  ];

  static UserProfileStatusEnum? fromJson(dynamic value) => UserProfileStatusEnumTypeTransformer().decode(value);

  static List<UserProfileStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <UserProfileStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = UserProfileStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [UserProfileStatusEnum] to String,
/// and [decode] dynamic data back to [UserProfileStatusEnum].
class UserProfileStatusEnumTypeTransformer {
  factory UserProfileStatusEnumTypeTransformer() => _instance ??= const UserProfileStatusEnumTypeTransformer._();

  const UserProfileStatusEnumTypeTransformer._();

  String encode(UserProfileStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a UserProfileStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  UserProfileStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'PENDING_VERIFICATION': return UserProfileStatusEnum.PENDING_VERIFICATION;
        case r'ACTIVE': return UserProfileStatusEnum.ACTIVE;
        case r'SUSPENDED': return UserProfileStatusEnum.SUSPENDED;
        case r'INACTIVE': return UserProfileStatusEnum.INACTIVE;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [UserProfileStatusEnumTypeTransformer] instance.
  static UserProfileStatusEnumTypeTransformer? _instance;
}


