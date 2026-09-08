import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function FieldInspectorHomePage() {
  return <RoleHome role={UserRole.FIELD_INSPECTOR} />;
}
