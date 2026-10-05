import { redirect } from 'next/navigation';
import { HEALTH_LOGIN_ROUTE } from '@/lib/constants/auth-routes';

export default function LegacyHealthLoginPage() {
  redirect(HEALTH_LOGIN_ROUTE);
}
