import { redirect } from 'next/navigation';

type ApplicationPageProps = {
  readonly params: Promise<{ readonly applicationId: string }>;
};

// ทางเข้าคำขอเสมอเริ่มที่ขั้นที่ 1 (แถบขั้นพาไปขั้นอื่นได้)
export default async function ApplicationPage({ params }: ApplicationPageProps) {
  const { applicationId } = await params;
  redirect(`/applicant/applications/${applicationId}/steps/1`);
}
