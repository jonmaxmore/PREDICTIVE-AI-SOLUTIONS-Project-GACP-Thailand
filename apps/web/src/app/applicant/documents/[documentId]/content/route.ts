import { UserRole } from '@gacp/contracts';
import { StoredObjectNotFoundError } from '@gacp/storage';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user.ts';
import { database } from '@/lib/database.ts';
import { fileStorage } from '@/lib/storage.ts';

// เปิดดูเอกสารผ่านแอปเท่านั้น (bucket ส่วนตัว ไม่มี URL สาธารณะ)
// ดูในหน้า (iframe/img) = inline · เปิดเป็นหน้าเต็ม = attachment ตามหลักการข้อ 8 · ทุกครั้งบันทึก DocumentAccessLog
// biome-ignore lint/style/useNamingConvention: Next.js กำหนดชื่อ Route Handler ตาม HTTP method
export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const user = await currentUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const { documentId } = await context.params;

  const document = await database.applicationDocument.findFirst({
    where: { id: documentId, removedAt: null },
    include: {
      application: {
        include: { applicant: { include: { members: { where: { userId: user.id } } } } },
      },
    },
  });
  if (!document) return new NextResponse(null, { status: 404 });

  const isOwner =
    document.application.applicant.members.length > 0 && user.roles.includes(UserRole.APPLICANT);
  const staffRole = user.roles.find((role) => role !== UserRole.APPLICANT);
  if (!isOwner && !staffRole) return new NextResponse(null, { status: 403 });

  const fetchDestination = request.headers.get('sec-fetch-dest');
  const inline =
    fetchDestination === 'iframe' ||
    fetchDestination === 'image' ||
    fetchDestination === 'embed' ||
    fetchDestination === 'object';

  await database.documentAccessLog.create({
    data: {
      userId: user.id,
      role: isOwner ? UserRole.APPLICANT : (staffRole as UserRole),
      documentId: document.id,
      applicationId: document.applicationId,
      accessKind: inline ? 'VIEW' : 'DOWNLOAD',
    },
  });

  let stored: Awaited<ReturnType<typeof fileStorage.get>>;
  try {
    stored = await fileStorage.get(document.fileKey);
  } catch (error) {
    if (error instanceof StoredObjectNotFoundError) return new NextResponse(null, { status: 404 });
    throw error;
  }

  const encodedName = encodeURIComponent(document.fileName).replace(
    /['()]/g,
    (character) => `%${character.charCodeAt(0).toString(16)}`,
  );
  return new NextResponse(stored.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': document.mimeType,
      'Content-Length': String(document.byteSize),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
