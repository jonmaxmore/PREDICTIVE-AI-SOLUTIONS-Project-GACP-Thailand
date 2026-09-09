import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function CertificationBodyFinanceOfficerHomePage() {
  return <RoleHome role={UserRole.CERTIFICATION_BODY_FINANCE_OFFICER} />;
}
