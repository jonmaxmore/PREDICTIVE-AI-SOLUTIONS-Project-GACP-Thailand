// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'establishment_model.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

EstablishmentModel _$EstablishmentModelFromJson(Map<String, dynamic> json) {
  return _EstablishmentModel.fromJson(json);
}

/// @nodoc
mixin _$EstablishmentModel {
  String? get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  EstablishmentType get type => throw _privateConstructorUsedError;
  EstablishmentAddressModel get address => throw _privateConstructorUsedError;
  EstablishmentCoordinatesModel get coordinates =>
      throw _privateConstructorUsedError;
  List<String> get images => throw _privateConstructorUsedError;
  String get titleDeedNo =>
      throw _privateConstructorUsedError; // Default empty for backward compat
  String get security => throw _privateConstructorUsedError;

  /// Serializes this EstablishmentModel to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of EstablishmentModel
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $EstablishmentModelCopyWith<EstablishmentModel> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $EstablishmentModelCopyWith<$Res> {
  factory $EstablishmentModelCopyWith(
          EstablishmentModel value, $Res Function(EstablishmentModel) then) =
      _$EstablishmentModelCopyWithImpl<$Res, EstablishmentModel>;
  @useResult
  $Res call(
      {String? id,
      String name,
      EstablishmentType type,
      EstablishmentAddressModel address,
      EstablishmentCoordinatesModel coordinates,
      List<String> images,
      String titleDeedNo,
      String security});

  $EstablishmentAddressModelCopyWith<$Res> get address;
  $EstablishmentCoordinatesModelCopyWith<$Res> get coordinates;
}

/// @nodoc
class _$EstablishmentModelCopyWithImpl<$Res, $Val extends EstablishmentModel>
    implements $EstablishmentModelCopyWith<$Res> {
  _$EstablishmentModelCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of EstablishmentModel
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = freezed,
    Object? name = null,
    Object? type = null,
    Object? address = null,
    Object? coordinates = null,
    Object? images = null,
    Object? titleDeedNo = null,
    Object? security = null,
  }) {
    return _then(_value.copyWith(
      id: freezed == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String?,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as EstablishmentType,
      address: null == address
          ? _value.address
          : address // ignore: cast_nullable_to_non_nullable
              as EstablishmentAddressModel,
      coordinates: null == coordinates
          ? _value.coordinates
          : coordinates // ignore: cast_nullable_to_non_nullable
              as EstablishmentCoordinatesModel,
      images: null == images
          ? _value.images
          : images // ignore: cast_nullable_to_non_nullable
              as List<String>,
      titleDeedNo: null == titleDeedNo
          ? _value.titleDeedNo
          : titleDeedNo // ignore: cast_nullable_to_non_nullable
              as String,
      security: null == security
          ? _value.security
          : security // ignore: cast_nullable_to_non_nullable
              as String,
    ) as $Val);
  }

  /// Create a copy of EstablishmentModel
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $EstablishmentAddressModelCopyWith<$Res> get address {
    return $EstablishmentAddressModelCopyWith<$Res>(_value.address, (value) {
      return _then(_value.copyWith(address: value) as $Val);
    });
  }

  /// Create a copy of EstablishmentModel
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $EstablishmentCoordinatesModelCopyWith<$Res> get coordinates {
    return $EstablishmentCoordinatesModelCopyWith<$Res>(_value.coordinates,
        (value) {
      return _then(_value.copyWith(coordinates: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$EstablishmentModelImplCopyWith<$Res>
    implements $EstablishmentModelCopyWith<$Res> {
  factory _$$EstablishmentModelImplCopyWith(_$EstablishmentModelImpl value,
          $Res Function(_$EstablishmentModelImpl) then) =
      __$$EstablishmentModelImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String? id,
      String name,
      EstablishmentType type,
      EstablishmentAddressModel address,
      EstablishmentCoordinatesModel coordinates,
      List<String> images,
      String titleDeedNo,
      String security});

  @override
  $EstablishmentAddressModelCopyWith<$Res> get address;
  @override
  $EstablishmentCoordinatesModelCopyWith<$Res> get coordinates;
}

/// @nodoc
class __$$EstablishmentModelImplCopyWithImpl<$Res>
    extends _$EstablishmentModelCopyWithImpl<$Res, _$EstablishmentModelImpl>
    implements _$$EstablishmentModelImplCopyWith<$Res> {
  __$$EstablishmentModelImplCopyWithImpl(_$EstablishmentModelImpl _value,
      $Res Function(_$EstablishmentModelImpl) _then)
      : super(_value, _then);

  /// Create a copy of EstablishmentModel
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = freezed,
    Object? name = null,
    Object? type = null,
    Object? address = null,
    Object? coordinates = null,
    Object? images = null,
    Object? titleDeedNo = null,
    Object? security = null,
  }) {
    return _then(_$EstablishmentModelImpl(
      id: freezed == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String?,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as EstablishmentType,
      address: null == address
          ? _value.address
          : address // ignore: cast_nullable_to_non_nullable
              as EstablishmentAddressModel,
      coordinates: null == coordinates
          ? _value.coordinates
          : coordinates // ignore: cast_nullable_to_non_nullable
              as EstablishmentCoordinatesModel,
      images: null == images
          ? _value._images
          : images // ignore: cast_nullable_to_non_nullable
              as List<String>,
      titleDeedNo: null == titleDeedNo
          ? _value.titleDeedNo
          : titleDeedNo // ignore: cast_nullable_to_non_nullable
              as String,
      security: null == security
          ? _value.security
          : security // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$EstablishmentModelImpl extends _EstablishmentModel {
  const _$EstablishmentModelImpl(
      {this.id,
      required this.name,
      required this.type,
      required this.address,
      required this.coordinates,
      final List<String> images = const [],
      this.titleDeedNo = '',
      this.security = ''})
      : _images = images,
        super._();

  factory _$EstablishmentModelImpl.fromJson(Map<String, dynamic> json) =>
      _$$EstablishmentModelImplFromJson(json);

  @override
  final String? id;
  @override
  final String name;
  @override
  final EstablishmentType type;
  @override
  final EstablishmentAddressModel address;
  @override
  final EstablishmentCoordinatesModel coordinates;
  final List<String> _images;
  @override
  @JsonKey()
  List<String> get images {
    if (_images is EqualUnmodifiableListView) return _images;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_images);
  }

  @override
  @JsonKey()
  final String titleDeedNo;
// Default empty for backward compat
  @override
  @JsonKey()
  final String security;

  @override
  String toString() {
    return 'EstablishmentModel(id: $id, name: $name, type: $type, address: $address, coordinates: $coordinates, images: $images, titleDeedNo: $titleDeedNo, security: $security)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$EstablishmentModelImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.address, address) || other.address == address) &&
            (identical(other.coordinates, coordinates) ||
                other.coordinates == coordinates) &&
            const DeepCollectionEquality().equals(other._images, _images) &&
            (identical(other.titleDeedNo, titleDeedNo) ||
                other.titleDeedNo == titleDeedNo) &&
            (identical(other.security, security) ||
                other.security == security));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      id,
      name,
      type,
      address,
      coordinates,
      const DeepCollectionEquality().hash(_images),
      titleDeedNo,
      security);

  /// Create a copy of EstablishmentModel
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$EstablishmentModelImplCopyWith<_$EstablishmentModelImpl> get copyWith =>
      __$$EstablishmentModelImplCopyWithImpl<_$EstablishmentModelImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$EstablishmentModelImplToJson(
      this,
    );
  }
}

abstract class _EstablishmentModel extends EstablishmentModel {
  const factory _EstablishmentModel(
      {final String? id,
      required final String name,
      required final EstablishmentType type,
      required final EstablishmentAddressModel address,
      required final EstablishmentCoordinatesModel coordinates,
      final List<String> images,
      final String titleDeedNo,
      final String security}) = _$EstablishmentModelImpl;
  const _EstablishmentModel._() : super._();

  factory _EstablishmentModel.fromJson(Map<String, dynamic> json) =
      _$EstablishmentModelImpl.fromJson;

  @override
  String? get id;
  @override
  String get name;
  @override
  EstablishmentType get type;
  @override
  EstablishmentAddressModel get address;
  @override
  EstablishmentCoordinatesModel get coordinates;
  @override
  List<String> get images;
  @override
  String get titleDeedNo; // Default empty for backward compat
  @override
  String get security;

  /// Create a copy of EstablishmentModel
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$EstablishmentModelImplCopyWith<_$EstablishmentModelImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

EstablishmentAddressModel _$EstablishmentAddressModelFromJson(
    Map<String, dynamic> json) {
  return _EstablishmentAddressModel.fromJson(json);
}

/// @nodoc
mixin _$EstablishmentAddressModel {
  String get street => throw _privateConstructorUsedError;
  String get city => throw _privateConstructorUsedError;
  String get zipCode => throw _privateConstructorUsedError;

  /// Serializes this EstablishmentAddressModel to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of EstablishmentAddressModel
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $EstablishmentAddressModelCopyWith<EstablishmentAddressModel> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $EstablishmentAddressModelCopyWith<$Res> {
  factory $EstablishmentAddressModelCopyWith(EstablishmentAddressModel value,
          $Res Function(EstablishmentAddressModel) then) =
      _$EstablishmentAddressModelCopyWithImpl<$Res, EstablishmentAddressModel>;
  @useResult
  $Res call({String street, String city, String zipCode});
}

/// @nodoc
class _$EstablishmentAddressModelCopyWithImpl<$Res,
        $Val extends EstablishmentAddressModel>
    implements $EstablishmentAddressModelCopyWith<$Res> {
  _$EstablishmentAddressModelCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of EstablishmentAddressModel
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? street = null,
    Object? city = null,
    Object? zipCode = null,
  }) {
    return _then(_value.copyWith(
      street: null == street
          ? _value.street
          : street // ignore: cast_nullable_to_non_nullable
              as String,
      city: null == city
          ? _value.city
          : city // ignore: cast_nullable_to_non_nullable
              as String,
      zipCode: null == zipCode
          ? _value.zipCode
          : zipCode // ignore: cast_nullable_to_non_nullable
              as String,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$EstablishmentAddressModelImplCopyWith<$Res>
    implements $EstablishmentAddressModelCopyWith<$Res> {
  factory _$$EstablishmentAddressModelImplCopyWith(
          _$EstablishmentAddressModelImpl value,
          $Res Function(_$EstablishmentAddressModelImpl) then) =
      __$$EstablishmentAddressModelImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String street, String city, String zipCode});
}

/// @nodoc
class __$$EstablishmentAddressModelImplCopyWithImpl<$Res>
    extends _$EstablishmentAddressModelCopyWithImpl<$Res,
        _$EstablishmentAddressModelImpl>
    implements _$$EstablishmentAddressModelImplCopyWith<$Res> {
  __$$EstablishmentAddressModelImplCopyWithImpl(
      _$EstablishmentAddressModelImpl _value,
      $Res Function(_$EstablishmentAddressModelImpl) _then)
      : super(_value, _then);

  /// Create a copy of EstablishmentAddressModel
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? street = null,
    Object? city = null,
    Object? zipCode = null,
  }) {
    return _then(_$EstablishmentAddressModelImpl(
      street: null == street
          ? _value.street
          : street // ignore: cast_nullable_to_non_nullable
              as String,
      city: null == city
          ? _value.city
          : city // ignore: cast_nullable_to_non_nullable
              as String,
      zipCode: null == zipCode
          ? _value.zipCode
          : zipCode // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$EstablishmentAddressModelImpl extends _EstablishmentAddressModel {
  const _$EstablishmentAddressModelImpl(
      {required this.street, required this.city, required this.zipCode})
      : super._();

  factory _$EstablishmentAddressModelImpl.fromJson(Map<String, dynamic> json) =>
      _$$EstablishmentAddressModelImplFromJson(json);

  @override
  final String street;
  @override
  final String city;
  @override
  final String zipCode;

  @override
  String toString() {
    return 'EstablishmentAddressModel(street: $street, city: $city, zipCode: $zipCode)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$EstablishmentAddressModelImpl &&
            (identical(other.street, street) || other.street == street) &&
            (identical(other.city, city) || other.city == city) &&
            (identical(other.zipCode, zipCode) || other.zipCode == zipCode));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, street, city, zipCode);

  /// Create a copy of EstablishmentAddressModel
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$EstablishmentAddressModelImplCopyWith<_$EstablishmentAddressModelImpl>
      get copyWith => __$$EstablishmentAddressModelImplCopyWithImpl<
          _$EstablishmentAddressModelImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$EstablishmentAddressModelImplToJson(
      this,
    );
  }
}

abstract class _EstablishmentAddressModel extends EstablishmentAddressModel {
  const factory _EstablishmentAddressModel(
      {required final String street,
      required final String city,
      required final String zipCode}) = _$EstablishmentAddressModelImpl;
  const _EstablishmentAddressModel._() : super._();

  factory _EstablishmentAddressModel.fromJson(Map<String, dynamic> json) =
      _$EstablishmentAddressModelImpl.fromJson;

  @override
  String get street;
  @override
  String get city;
  @override
  String get zipCode;

  /// Create a copy of EstablishmentAddressModel
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$EstablishmentAddressModelImplCopyWith<_$EstablishmentAddressModelImpl>
      get copyWith => throw _privateConstructorUsedError;
}

EstablishmentCoordinatesModel _$EstablishmentCoordinatesModelFromJson(
    Map<String, dynamic> json) {
  return _EstablishmentCoordinatesModel.fromJson(json);
}

/// @nodoc
mixin _$EstablishmentCoordinatesModel {
  double get lat => throw _privateConstructorUsedError;
  double get lng => throw _privateConstructorUsedError;

  /// Serializes this EstablishmentCoordinatesModel to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of EstablishmentCoordinatesModel
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $EstablishmentCoordinatesModelCopyWith<EstablishmentCoordinatesModel>
      get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $EstablishmentCoordinatesModelCopyWith<$Res> {
  factory $EstablishmentCoordinatesModelCopyWith(
          EstablishmentCoordinatesModel value,
          $Res Function(EstablishmentCoordinatesModel) then) =
      _$EstablishmentCoordinatesModelCopyWithImpl<$Res,
          EstablishmentCoordinatesModel>;
  @useResult
  $Res call({double lat, double lng});
}

/// @nodoc
class _$EstablishmentCoordinatesModelCopyWithImpl<$Res,
        $Val extends EstablishmentCoordinatesModel>
    implements $EstablishmentCoordinatesModelCopyWith<$Res> {
  _$EstablishmentCoordinatesModelCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of EstablishmentCoordinatesModel
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? lat = null,
    Object? lng = null,
  }) {
    return _then(_value.copyWith(
      lat: null == lat
          ? _value.lat
          : lat // ignore: cast_nullable_to_non_nullable
              as double,
      lng: null == lng
          ? _value.lng
          : lng // ignore: cast_nullable_to_non_nullable
              as double,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$EstablishmentCoordinatesModelImplCopyWith<$Res>
    implements $EstablishmentCoordinatesModelCopyWith<$Res> {
  factory _$$EstablishmentCoordinatesModelImplCopyWith(
          _$EstablishmentCoordinatesModelImpl value,
          $Res Function(_$EstablishmentCoordinatesModelImpl) then) =
      __$$EstablishmentCoordinatesModelImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({double lat, double lng});
}

/// @nodoc
class __$$EstablishmentCoordinatesModelImplCopyWithImpl<$Res>
    extends _$EstablishmentCoordinatesModelCopyWithImpl<$Res,
        _$EstablishmentCoordinatesModelImpl>
    implements _$$EstablishmentCoordinatesModelImplCopyWith<$Res> {
  __$$EstablishmentCoordinatesModelImplCopyWithImpl(
      _$EstablishmentCoordinatesModelImpl _value,
      $Res Function(_$EstablishmentCoordinatesModelImpl) _then)
      : super(_value, _then);

  /// Create a copy of EstablishmentCoordinatesModel
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? lat = null,
    Object? lng = null,
  }) {
    return _then(_$EstablishmentCoordinatesModelImpl(
      lat: null == lat
          ? _value.lat
          : lat // ignore: cast_nullable_to_non_nullable
              as double,
      lng: null == lng
          ? _value.lng
          : lng // ignore: cast_nullable_to_non_nullable
              as double,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$EstablishmentCoordinatesModelImpl
    extends _EstablishmentCoordinatesModel {
  const _$EstablishmentCoordinatesModelImpl(
      {required this.lat, required this.lng})
      : super._();

  factory _$EstablishmentCoordinatesModelImpl.fromJson(
          Map<String, dynamic> json) =>
      _$$EstablishmentCoordinatesModelImplFromJson(json);

  @override
  final double lat;
  @override
  final double lng;

  @override
  String toString() {
    return 'EstablishmentCoordinatesModel(lat: $lat, lng: $lng)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$EstablishmentCoordinatesModelImpl &&
            (identical(other.lat, lat) || other.lat == lat) &&
            (identical(other.lng, lng) || other.lng == lng));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, lat, lng);

  /// Create a copy of EstablishmentCoordinatesModel
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$EstablishmentCoordinatesModelImplCopyWith<
          _$EstablishmentCoordinatesModelImpl>
      get copyWith => __$$EstablishmentCoordinatesModelImplCopyWithImpl<
          _$EstablishmentCoordinatesModelImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$EstablishmentCoordinatesModelImplToJson(
      this,
    );
  }
}

abstract class _EstablishmentCoordinatesModel
    extends EstablishmentCoordinatesModel {
  const factory _EstablishmentCoordinatesModel(
      {required final double lat,
      required final double lng}) = _$EstablishmentCoordinatesModelImpl;
  const _EstablishmentCoordinatesModel._() : super._();

  factory _EstablishmentCoordinatesModel.fromJson(Map<String, dynamic> json) =
      _$EstablishmentCoordinatesModelImpl.fromJson;

  @override
  double get lat;
  @override
  double get lng;

  /// Create a copy of EstablishmentCoordinatesModel
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$EstablishmentCoordinatesModelImplCopyWith<
          _$EstablishmentCoordinatesModelImpl>
      get copyWith => throw _privateConstructorUsedError;
}
