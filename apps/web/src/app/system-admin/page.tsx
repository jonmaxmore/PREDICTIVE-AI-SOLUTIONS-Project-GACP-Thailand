import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function SystemAdminHomePage() {
  return <RoleHome role={UserRole.SYSTEM_ADMIN} />;
}
