import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function FinanceOfficerHomePage() {
  return <RoleHome role={UserRole.FINANCE_OFFICER} />;
}
