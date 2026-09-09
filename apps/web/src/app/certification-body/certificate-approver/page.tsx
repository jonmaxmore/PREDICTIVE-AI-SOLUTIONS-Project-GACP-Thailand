import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function CertificateApproverHomePage() {
  return <RoleHome role={UserRole.CERTIFICATE_APPROVER} />;
}
