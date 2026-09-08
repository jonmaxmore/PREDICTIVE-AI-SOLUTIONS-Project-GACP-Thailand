import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function ApplicantHomePage() {
  return <RoleHome role={UserRole.APPLICANT} />;
}
