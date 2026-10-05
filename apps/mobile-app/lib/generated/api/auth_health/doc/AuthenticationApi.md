# gacp_auth_health_client.api.AuthenticationApi

## Load the API package
```dart
import 'package:gacp_auth_health_client/api.dart';
```

All URIs are relative to *http://localhost:5000*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getProfile**](AuthenticationApi.md#getprofile) | **GET** /api/auth/health/profile | Get current user profile
[**loginApplicant**](AuthenticationApi.md#loginApplicant) | **POST** /api/auth/health/login | Login Applicant
[**registerApplicant**](AuthenticationApi.md#registerApplicant) | **POST** /api/auth/health/register | Register new Applicant account
[**resetPassword**](AuthenticationApi.md#resetpassword) | **POST** /api/auth/health/reset-password/{token} | Reset password with token
[**updateProfile**](AuthenticationApi.md#updateprofile) | **PUT** /api/auth/health/profile | Update user profile


# **getProfile**
> UserProfile getProfile()

Get current user profile

Returns authenticated Applicant's profile

### Example
```dart
import 'package:gacp_auth_health_client/api.dart';
// TODO Configure HTTP Bearer authorization: BearerAuth
// Case 1. Use String Token
//defaultApiClient.getAuthentication<HttpBearerAuth>('BearerAuth').setAccessToken('YOUR_ACCESS_TOKEN');
// Case 2. Use Function which generate token.
// String yourTokenGeneratorFunction() { ... }
//defaultApiClient.getAuthentication<HttpBearerAuth>('BearerAuth').setAccessToken(yourTokenGeneratorFunction);

final api_instance = AuthenticationApi();

try {
    final result = api_instance.getProfile();
    print(result);
} catch (e) {
    print('Exception when calling AuthenticationApi->getProfile: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**UserProfile**](user-profile.md)

### Authorization

[BearerAuth](../readme.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../readme.md#documentation-for-api-endpoints) [[Back to Model list]](../readme.md#documentation-for-models) [[Back to README]](../readme.md)

# **loginApplicant**
> LoginResponse loginApplicant(loginRequest)

Login Applicant

Authenticates Applicant and returns JWT token

### Example
```dart
import 'package:gacp_auth_health_client/api.dart';

final api_instance = AuthenticationApi();
final loginRequest = LoginRequest(); // LoginRequest | 

try {
    final result = api_instance.loginApplicant(loginRequest);
    print(result);
} catch (e) {
    print('Exception when calling AuthenticationApi->loginApplicant: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **loginRequest** | [**LoginRequest**](LoginRequest.md)|  | 

### Return type

[**LoginResponse**](LoginResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../readme.md#documentation-for-api-endpoints) [[Back to Model list]](../readme.md#documentation-for-models) [[Back to README]](../readme.md)

# **registerApplicant**
> RegisterResponse registerApplicant(registerRequest)

Register new Applicant account

Creates a new Applicant account with email verification required. Password must meet security requirements (min 8 chars, uppercase, lowercase, number, special char). 

### Example
```dart
import 'package:gacp_auth_health_client/api.dart';

final api_instance = AuthenticationApi();
final registerRequest = RegisterRequest(); // RegisterRequest | 

try {
    final result = api_instance.registerApplicant(registerRequest);
    print(result);
} catch (e) {
    print('Exception when calling AuthenticationApi->registerApplicant: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **registerRequest** | [**RegisterRequest**](RegisterRequest.md)|  | 

### Return type

[**RegisterResponse**](RegisterResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../readme.md#documentation-for-api-endpoints) [[Back to Model list]](../readme.md#documentation-for-models) [[Back to README]](../readme.md)

# **resetPassword**
> resetPassword(token, resetPasswordRequest)

Redeem a staff-issued password reset token

Sets a new password using the one-time token a system administrator issued from staff management. There is no self-service request endpoint.

### Example
```dart
import 'package:gacp_auth_health_client/api.dart';

final api_instance = AuthenticationApi();
final token = token_example; // String | 
final resetPasswordRequest = ResetPasswordRequest(); // ResetPasswordRequest | 

try {
    api_instance.resetPassword(token, resetPasswordRequest);
} catch (e) {
    print('Exception when calling AuthenticationApi->resetPassword: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **token** | **String**|  | 
 **resetPasswordRequest** | [**ResetPasswordRequest**](ResetPasswordRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../readme.md#documentation-for-api-endpoints) [[Back to Model list]](../readme.md#documentation-for-models) [[Back to README]](../readme.md)

# **updateProfile**
> updateProfile(updateProfileRequest)

Update user profile

Updates Applicant profile information

### Example
```dart
import 'package:gacp_auth_health_client/api.dart';
// TODO Configure HTTP Bearer authorization: BearerAuth
// Case 1. Use String Token
//defaultApiClient.getAuthentication<HttpBearerAuth>('BearerAuth').setAccessToken('YOUR_ACCESS_TOKEN');
// Case 2. Use Function which generate token.
// String yourTokenGeneratorFunction() { ... }
//defaultApiClient.getAuthentication<HttpBearerAuth>('BearerAuth').setAccessToken(yourTokenGeneratorFunction);

final api_instance = AuthenticationApi();
final updateProfileRequest = UpdateProfileRequest(); // UpdateProfileRequest | 

try {
    api_instance.updateProfile(updateProfileRequest);
} catch (e) {
    print('Exception when calling AuthenticationApi->updateProfile: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **updateProfileRequest** | [**UpdateProfileRequest**](UpdateProfileRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

[BearerAuth](../readme.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../readme.md#documentation-for-api-endpoints) [[Back to Model list]](../readme.md#documentation-for-models) [[Back to README]](../readme.md)
