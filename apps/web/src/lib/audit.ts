import 'server-only';
import { ActorKind, type UserRole } from '@gacp/contracts';
import type { Prisma } from '@gacp/db';
import { database } from '@/lib/database.ts';

// ทุกการเพิ่ม/ถอดคน สังกัด และบทบาท ต้องมีแถวใน audit_logs (append-only) diff ห้ามมีข้อมูลส่วนบุคคลดิบ
export async function recordAudit(input: {
  readonly actorUserId: string;
  readonly actorRole: UserRole;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly diff?: Prisma.InputJsonValue | undefined;
}): Promise<void> {
  await database.auditLog.create({
    data: {
      actorKind: ActorKind.USER,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.diff ? { diff: input.diff } : {}),
    },
  });
}
