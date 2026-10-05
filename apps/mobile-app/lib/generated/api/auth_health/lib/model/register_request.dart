//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class RegisterRequest {
  /// Returns a new [RegisterRequest] instance.
  RegisterRequest({
    required this.email,
    required this.password,
    required this.firstName,
    required this.lastName,
    required this.idCard,
    this.phoneNumber,
    this.address,
    this.province,
    this.district,
    this.subDistrict,
    this.postalCode,
  });

  String email;

  String password;

  String firstName;

  String lastName;

  String idCard;

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
  String? address;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? province;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? district;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? subDistrict;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? postalCode;

  @override
  bool operator ==(Object other) => identical(this, other) || other is RegisterRequest &&
    other.email == email &&
    other.password == password &&
    other.firstName == firstName &&
    other.lastName == lastName &&
    other.idCard == idCard &&
    other.phoneNumber == phoneNumber &&
    other.address == address &&
    other.province == province &&
    other.district == district &&
    other.subDistrict == subDistrict &&
    other.postalCode == postalCode;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (email.hashCode) +
    (password.hashCode) +
    (firstName.hashCode) +
    (lastName.hashCode) +
    (idCard.hashCode) +
    (phoneNumber == null ? 0 : phoneNumber!.hashCode) +
    (address == null ? 0 : address!.hashCode) +
    (province == null ? 0 : province!.hashCode) +
    (district == null ? 0 : district!.hashCode) +
    (subDistrict == null ? 0 : subDistrict!.hashCode) +
    (postalCode == null ? 0 : postalCode!.hashCode);

  @override
  String toString() => 'RegisterRequest[email=$email, password=$password, firstName=$firstName, lastName=$lastName, idCard=$idCard, phoneNumber=$phoneNumber, address=$address, province=$province, district=$district, subDistrict=$subDistrict, postalCode=$postalCode]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'email'] = this.email;
      json[r'password'] = this.password;
      json[r'firstName'] = this.firstName;
      json[r'lastName'] = this.lastName;
      json[r'idCard'] = this.idCard;
    if (this.phoneNumber != null) {
      json[r'phoneNumber'] = this.phoneNumber;
    } else {
      json[r'phoneNumber'] = null;
    }
    if (this.address != null) {
      json[r'address'] = this.address;
    } else {
      json[r'address'] = null;
    }
    if (this.province != null) {
      json[r'province'] = this.province;
    } else {
      json[r'province'] = null;
    }
    if (this.district != null) {
      json[r'district'] = this.district;
    } else {
      json[r'district'] = null;
    }
    if (this.subDistrict != null) {
      json[r'subDistrict'] = this.subDistrict;
    } else {
      json[r'subDistrict'] = null;
    }
    if (this.postalCode != null) {
      json[r'postalCode'] = this.postalCode;
    } else {
      json[r'postalCode'] = null;
    }
    return json;
  }

  /// Returns a new [RegisterRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static RegisterRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        requiredKeys.forEach((key) {
          assert(json.containsKey(key), 'Required key "RegisterRequest[$key]" is missing from JSON.');
          assert(json[key] != null, 'Required key "RegisterRequest[$key]" has a null value in JSON.');
        });
        return true;
      }());

      return RegisterRequest(
        email: mapValueOfType<String>(json, r'email')!,
        password: mapValueOfType<String>(json, r'password')!,
        firstName: mapValueOfType<String>(json, r'firstName')!,
        lastName: mapValueOfType<String>(json, r'lastName')!,
        idCard: mapValueOfType<String>(json, r'idCard')!,
        phoneNumber: mapValueOfType<String>(json, r'phoneNumber'),
        address: mapValueOfType<String>(json, r'address'),
        province: mapValueOfType<String>(json, r'province'),
        district: mapValueOfType<String>(json, r'district'),
        subDistrict: mapValueOfType<String>(json, r'subDistrict'),
        postalCode: mapValueOfType<String>(json, r'postalCode'),
      );
    }
    return null;
  }

  static List<RegisterRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <RegisterRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = RegisterRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, RegisterRequest> mapFromJson(dynamic json) {
    final map = <String, RegisterRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = RegisterRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of RegisterRequest-objects as value to a dart map
  static Map<String, List<RegisterRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<RegisterRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = RegisterRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'email',
    'password',
    'firstName',
    'lastName',
    'idCard',
  };
}

