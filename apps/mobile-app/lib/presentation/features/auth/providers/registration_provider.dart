import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Provider to maintain registration state across route changes
class RegistrationState {
  final String accountType;
  final int currentStep;
  final String identifier;
  final String phoneNumber;
  final String firstName;
  final String lastName;
  final String companyName;
  final String representativeName;
  final String communityName;
  final String contactName;

  RegistrationState({
    this.accountType = '',
    this.currentStep = 0,
    this.identifier = '',
    this.phoneNumber = '',
    this.firstName = '',
    this.lastName = '',
    this.companyName = '',
    this.representativeName = '',
    this.communityName = '',
    this.contactName = '',
  });

  RegistrationState copyWith({
    String? accountType,
    int? currentStep,
    String? identifier,
    String? phoneNumber,
    String? firstName,
    String? lastName,
    String? companyName,
    String? representativeName,
    String? communityName,
    String? contactName,
  }) {
    return RegistrationState(
      accountType: accountType ?? this.accountType,
      currentStep: currentStep ?? this.currentStep,
      identifier: identifier ?? this.identifier,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      firstName: firstName ?? this.firstName,
      lastName: lastName ?? this.lastName,
      companyName: companyName ?? this.companyName,
      representativeName: representativeName ?? this.representativeName,
      communityName: communityName ?? this.communityName,
      contactName: contactName ?? this.contactName,
    );
  }

  void reset() {}
}

class RegistrationNotifier extends StateNotifier<RegistrationState> {
  RegistrationNotifier() : super(RegistrationState());

  void setAccountType(String type) {
    state = state.copyWith(accountType: type);
  }

  void setStep(int step) {
    state = state.copyWith(currentStep: step);
  }

  void setIdentifier(String value) {
    state = state.copyWith(identifier: value);
  }

  void setPhoneNumber(String value) {
    state = state.copyWith(phoneNumber: value);
  }

  void setPersonalInfo({
    String? firstName,
    String? lastName,
    String? companyName,
    String? representativeName,
    String? communityName,
    String? contactName,
  }) {
    state = state.copyWith(
      firstName: firstName,
      lastName: lastName,
      companyName: companyName,
      representativeName: representativeName,
      communityName: communityName,
      contactName: contactName,
    );
  }

  void reset() {
    state = RegistrationState();
  }
}

final registrationProvider =
    StateNotifierProvider<RegistrationNotifier, RegistrationState>((ref) {
  return RegistrationNotifier();
});
