import 'server-only';
import type { DatabaseClient } from '@gacp/db';

// เลขคำขอ APP-<พ.ศ.>-<ลำดับ 6 หลัก> นับต่อเนื่องต่อปี ออกภายในธุรกรรมเดียวกับการสร้างคำขอ (unique index กันชน)
export function buddhistYearOf(now: Date): number {
  const year = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(now),
  );
  return year + 543;
}

type ApplicationCounter = Pick<DatabaseClient, 'application'>;

export async function nextApplicationReferenceNumber(
  database: ApplicationCounter,
  now: Date = new Date(),
): Promise<string> {
  const prefix = `APP-${buddhistYearOf(now)}-`;
  const count = await database.application.count({
    where: { referenceNumber: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(6, '0')}`;
}
