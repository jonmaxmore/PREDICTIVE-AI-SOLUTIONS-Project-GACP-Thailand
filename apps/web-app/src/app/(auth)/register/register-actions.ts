import { FormEvent } from 'react';
import { AuthService } from '@/lib/services/auth-service';

/** Simple email validation — replaces deleted register-copy.ts import */
function isValidEmail(email: string): boolean {
  if (!email || !email.trim()) return true; // email is optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

type RegisterCopy = {
  identifierUnavailable: string;
  missingId: string;
  missingName: string;
  invalidPhone: string;
  invalidEmail: string;
  weakPassword: string;
  mismatchPassword: string;
  missingTerms: string;
  duplicateId: string;
  registerFailed: string;
  connectError: string;
};

type RegisterSubmitParams = {
  event: FormEvent<HTMLFormElement>;
  cleanIdentifier: string;
  idValid: boolean | null;
  firstName: string;
  lastName: string;
  isPhoneValid: boolean;
  email: string;
  isPasswordStrong: boolean;
  isPasswordMatched: boolean;
  acceptTerms: boolean;
  phoneNumber: string;
  password: string;
  copy: RegisterCopy;
  setError: (value: string) => void;
  setIsLoading: (value: boolean) => void;
  router: { push: (href: string) => void };
};

export async function submitRegisterForm(params: RegisterSubmitParams): Promise<void> {
  const {
    event,
    cleanIdentifier,
    idValid,
    firstName,
    lastName,
    isPhoneValid,
    email,
    isPasswordStrong,
    isPasswordMatched,
    acceptTerms,
    phoneNumber,
    password,
    copy,
    setError,
    setIsLoading,
    router,
  } = params;

  event.preventDefault();
  setError('');

  if (!cleanIdentifier || cleanIdentifier.length !== 13 || idValid !== true) {
    setError(copy.missingId);
    return;
  }
  if (!firstName.trim() || !lastName.trim()) {
    setError(copy.missingName);
    return;
  }
  if (!isPhoneValid) {
    setError(copy.invalidPhone);
    return;
  }
  if (!isValidEmail(email)) {
    setError(copy.invalidEmail);
    return;
  }
  if (!isPasswordStrong) {
    setError(copy.weakPassword);
    return;
  }
  if (!isPasswordMatched) {
    setError(copy.mismatchPassword);
    return;
  }
  if (!acceptTerms) {
    setError(copy.missingTerms);
    return;
  }

  setIsLoading(true);
  try {
    const availability = await AuthService.checkIdentifier(cleanIdentifier);
    if (!availability.available) {
      setError(availability.error || copy.duplicateId);
      setIsLoading(false);
      return;
    }

    const result = await AuthService.register({
      accountType: 'INDIVIDUAL',
      identifier: cleanIdentifier,
      healthId: cleanIdentifier,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phoneNumber,
      email: email.trim() || undefined,
      password,
    });

    if (!result.success) {
      setError(result.error || copy.registerFailed);
      setIsLoading(false);
      return;
    }

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    router.push(`/register/success?name=${encodeURIComponent(fullName)}`);
  } catch {
    setError(copy.connectError);
    setIsLoading(false);
  }
}
