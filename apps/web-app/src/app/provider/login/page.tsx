import { redirect } from 'next/navigation';
import { PROVIDER_LOGIN_ROUTE } from '@/lib/constants/auth-routes';

export default function LegacyProviderLoginPage() {
  redirect(PROVIDER_LOGIN_ROUTE);
}
