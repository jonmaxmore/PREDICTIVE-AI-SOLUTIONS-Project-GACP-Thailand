import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function PlatformOperatorFinanceOfficerHomePage() {
  return <RoleHome role={UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER} />;
}
