import { apiClient } from '@/lib/api/api-client';

/**
 * The single path a field-evidence photo takes to the server.
 *
 * The auditor's camera watermarks each capture with GPS and timestamp and hands
 * back a `Blob`. The panel used to POST everything about that photo — id,
 * latitude, longitude, accuracy, capturedAt, originalSize, watermarkedSize —
 * and not the image, to an endpoint that stores session metadata. Then it
 * showed "ถ่ายรูป + บันทึกแล้ว ... พร้อมลายน้ำ GPS+เวลา".
 *
 * So the photograph that evidences a certification decision was discarded at
 * the moment the auditor was told it had been kept. The auditor leaves the farm
 * believing the record exists; nobody discovers otherwise until someone looks
 * for it, by which time the farm visit cannot be repeated.
 *
 * `POST /api/audit/onsite/:auditId/photo` already existed, unused: multipart,
 * `file=photo`, and it returns a `photoId` and a `fileHash`. This sends the
 * blob there.
 *
 * The rule this module exists to enforce: the caller may only claim the photo
 * was saved when a `photoId` comes back. Anything else is a failure the auditor
 * has to see while they are still standing in the field.
 */

export interface AuditPhotoUploadArgs {
    auditId: string;
    blob: Blob;
    latitude: number | null;
    longitude: number | null;
    capturedAt?: string;
    caption?: string;
    fileName?: string;
}

export interface AuditPhotoUploadResult {
    photoId: string | null;
    fileHash: string | null;
    error: string | null;
}

interface PostDeps {
    post: (path: string, body: FormData) => Promise<{
        success?: boolean;
        data?: { photoId?: string; fileHash?: string } | null;
    } | null>;
}

const endpoint = (auditId: string) => `/audit/onsite/${encodeURIComponent(auditId)}/photo`;

export async function uploadAuditPhoto(
    args: AuditPhotoUploadArgs,
    deps: PostDeps = { post: (path, body) => apiClient.post(path, body) },
): Promise<AuditPhotoUploadResult> {
    if (!args.blob || args.blob.size === 0) {
        return { photoId: null, fileHash: null, error: 'ไม่พบไฟล์รูป กรุณาถ่ายใหม่' };
    }

    const formData = new FormData();
    formData.append('photo', args.blob, args.fileName || 'evidence.jpg');
    // The endpoint reads these off the multipart body, not the JSON.
    if (args.latitude != null) formData.append('gpsLat', String(args.latitude));
    if (args.longitude != null) formData.append('gpsLng', String(args.longitude));
    if (args.capturedAt) formData.append('capturedAt', args.capturedAt);
    if (args.caption) formData.append('caption', args.caption);

    try {
        const response = await deps.post(endpoint(args.auditId), formData);
        const photoId = response?.data?.photoId;
        if (response?.success && typeof photoId === 'string' && photoId.length > 0) {
            return { photoId, fileHash: response.data?.fileHash ?? null, error: null };
        }
        return { photoId: null, fileHash: null, error: 'บันทึกรูปไม่สำเร็จ กรุณาถ่ายใหม่อีกครั้ง' };
    } catch {
        return {
            photoId: null,
            fileHash: null,
            error: 'บันทึกรูปไม่สำเร็จ กรุณาตรวจสอบสัญญาณแล้วถ่ายใหม่',
        };
    }
}
