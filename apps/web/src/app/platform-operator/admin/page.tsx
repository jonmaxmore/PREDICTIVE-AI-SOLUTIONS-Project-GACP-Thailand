import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function PlatformOperatorAdminHomePage() {
  return <RoleHome role={UserRole.PLATFORM_OPERATOR_ADMIN} />;
}
