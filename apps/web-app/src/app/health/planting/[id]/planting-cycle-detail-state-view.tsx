import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/primitives/button';
import { Container } from '@/components/ui/layout-utils';
import { Spinner as Loader } from '@/components/ui/spinner';
import { Icons } from '@/components/ui/icons';

interface PlantingCycleDetailStateViewArgs {
  loading: boolean;
  error: string | null;
  cycle: unknown;
}

export function getPlantingCycleDetailStateView({ loading, error, cycle }: PlantingCycleDetailStateViewArgs) {
  if (loading) {
    return (
      <Container size="xl">
        <div className="rounded-lg bg-card p-6 text-center shadow-sm">
          <Loader color="green" />
          <p className="mt-3 text-slate-500">กำลังโหลดข้อมูลรอบปลูก...</p>
        </div>
      </Container>
    );
  }

  if (error || !cycle) {
    return (
      <Container size="md">
        <Alert color="red" title="ไม่สามารถแสดงข้อมูลได้" icon={<Icons.AlertCircle size={16} />}>
          {error || 'ไม่พบข้อมูลรอบปลูก'}
        </Alert>
        <div className="mt-4 flex flex-wrap items-center">
          <Button href="/health/planting" variant="default">กลับหน้ารอบปลูก</Button>
        </div>
      </Container>
    );
  }

  return null;
}
