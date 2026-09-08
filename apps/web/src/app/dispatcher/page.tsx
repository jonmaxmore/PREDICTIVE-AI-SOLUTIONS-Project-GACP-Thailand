import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function DispatcherHomePage() {
  return <RoleHome role={UserRole.DISPATCHER} />;
}
