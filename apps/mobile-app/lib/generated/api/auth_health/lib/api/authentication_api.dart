//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AuthenticationApi {
  AuthenticationApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Get current user profile
  ///
  /// Returns authenticated Applicant's profile
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getProfileWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/auth/health/profile';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Get current user profile
  ///
  /// Returns authenticated Applicant's profile
  Future<UserProfile?> getProfile() async {
    final response = await getProfileWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'UserProfile',) as UserProfile;
    
    }
    return null;
  }

  /// Login Applicant
  ///
  /// Authenticates Applicant and returns JWT token
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [LoginRequest] loginRequest (required):
  Future<Response> loginApplicantWithHttpInfo(LoginRequest loginRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/auth/health/login';

    // ignore: prefer_final_locals
    Object? postBody = loginRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Login Applicant
  ///
  /// Authenticates Applicant and returns JWT token
  ///
  /// Parameters:
  ///
  /// * [LoginRequest] loginRequest (required):
  Future<LoginResponse?> loginApplicant(LoginRequest loginRequest,) async {
    final response = await loginApplicantWithHttpInfo(loginRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'LoginResponse',) as LoginResponse;
    
    }
    return null;
  }

  /// Register new Applicant account
  ///
  /// Creates a new Applicant account with email verification required. Password must meet security requirements (min 8 chars, uppercase, lowercase, number, special char). 
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [RegisterRequest] registerRequest (required):
  Future<Response> registerApplicantWithHttpInfo(RegisterRequest registerRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/auth/health/register';

    // ignore: prefer_final_locals
    Object? postBody = registerRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Register new Applicant account
  ///
  /// Creates a new Applicant account with email verification required. Password must meet security requirements (min 8 chars, uppercase, lowercase, number, special char). 
  ///
  /// Parameters:
  ///
  /// * [RegisterRequest] registerRequest (required):
  Future<RegisterResponse?> registerApplicant(RegisterRequest registerRequest,) async {
    final response = await registerApplicantWithHttpInfo(registerRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'RegisterResponse',) as RegisterResponse;
    
    }
    return null;
  }

  /// Redeem a staff-issued password reset token
  ///
  /// Sets a new password using the one-time token a system administrator issued from staff management. There is no self-service request endpoint.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] token (required):
  ///
  /// * [ResetPasswordRequest] resetPasswordRequest (required):
  Future<Response> resetPasswordWithHttpInfo(String token, ResetPasswordRequest resetPasswordRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/auth/health/reset-password/{token}'
      .replaceAll('{token}', token);

    // ignore: prefer_final_locals
    Object? postBody = resetPasswordRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Redeem a staff-issued password reset token
  ///
  /// Sets a new password using the one-time token a system administrator issued from staff management. There is no self-service request endpoint.
  ///
  /// Parameters:
  ///
  /// * [String] token (required):
  ///
  /// * [ResetPasswordRequest] resetPasswordRequest (required):
  Future<void> resetPassword(String token, ResetPasswordRequest resetPasswordRequest,) async {
    final response = await resetPasswordWithHttpInfo(token, resetPasswordRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Update user profile
  ///
  /// Updates Applicant profile information
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [UpdateProfileRequest] updateProfileRequest (required):
  Future<Response> updateProfileWithHttpInfo(UpdateProfileRequest updateProfileRequest,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/auth/health/profile';

    // ignore: prefer_final_locals
    Object? postBody = updateProfileRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Update user profile
  ///
  /// Updates Applicant profile information
  ///
  /// Parameters:
  ///
  /// * [UpdateProfileRequest] updateProfileRequest (required):
  Future<void> updateProfile(UpdateProfileRequest updateProfileRequest,) async {
    final response = await updateProfileWithHttpInfo(updateProfileRequest,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
