import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function CertificationBodyAdminHomePage() {
  return <RoleHome role={UserRole.CERTIFICATION_BODY_ADMIN} />;
}
