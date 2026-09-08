import { UserRole } from '@gacp/contracts';
import { RoleHome } from '@/components/role-home.tsx';

export default function DocumentReviewerHomePage() {
  return <RoleHome role={UserRole.DOCUMENT_REVIEWER} />;
}
