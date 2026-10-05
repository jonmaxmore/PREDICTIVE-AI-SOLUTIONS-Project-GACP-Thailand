/**
 * The single path by which a wizard document reaches the server.
 *
 * The application wizard used to have two. Steps 4 and 8 uploaded through
 * `InlineDocumentUpload`, which POSTs here and only reports success when the
 * server returns a `fileUrl`. Step 5's land-title and water-test pickers had
 * no upload path at all: they wrote the `File` into React state, showed the
 * farmer a green "attached" chip, and the bytes vanished on reload. Step 8
 * then read the stored filename, concluded the document was already supplied,
 * and removed the required slot — so the application was submitted without a
 * title deed or a water test, both legally mandatory, with neither the farmer
 * nor the reviewing officer told.
 *
 * Two paths meant one could be wrong for a long time without anyone noticing.
 * This is the one path, and it holds one rule:
 *
 *     a URL comes back only when the server actually produced one.
 *
 * Every other outcome — a rejection, a 200 with no url, a thrown request, a
 * file over the size limit — returns an error the caller is obliged to render.
 * There is deliberately no way for this function to report success quietly.
 */

import { apiClient } from '@/lib/api/api-client';
import { MAX_UPLOAD_BYTES } from '@gacp/validation/upload-rules';
import { checkUploadInBrowser } from '@/lib/services/client-upload-check';

const ENDPOINT = '/applications/draft-documents';
/**
 * F-G4-08 — the ceiling is the shared one. This module used to default to 10 MB
 * while the step-8 slots and the server both used 20, so the same file was
 * refused or accepted depending on which slot a farmer put it in.
 */
const DEFAULT_MAX_SIZE_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

export interface DraftUploadArgs {
    file: File;
    /** Which document slot this file fills, e.g. CHANOTE, WATER_TEST. */
    slotId: string;
    /** Wizard step the upload came from; the server files documents by step. */
    stepKey?: string;
    draftId?: string | undefined;
    applicationId?: string | undefined;
    maxSizeMB?: number;
}

export interface DraftUploadResult {
    /** Non-null only when the server returned a URL. */
    url: string | null;
    /** Thai message to show the applicant. Non-null whenever url is null. */
    error: string | null;
}

interface UploadDeps {
    post: (path: string, body: FormData) => Promise<{ success?: boolean; error?: string; data?: { fileUrl?: string } | null }>;
}

export async function uploadDraftDocument(
    args: DraftUploadArgs,
    deps: UploadDeps = { post: (path, body) => apiClient.post(path, body) },
): Promise<DraftUploadResult> {
    const maxSizeMB = args.maxSizeMB ?? DEFAULT_MAX_SIZE_MB;

    if (args.file.size > maxSizeMB * 1024 * 1024) {
        return { url: null, error: `ไฟล์ใหญ่เกิน ${maxSizeMB} MB คุณสามารถบีบอัดไฟล์ หรือสแกนใหม่ที่ความละเอียดต่ำลง แล้วอัปโหลดอีกครั้ง` };
    }

    // F-G4-08 — what the file actually is, and whether it holds anything, judged
    // against what this slot accepts. Same rules the server applies.
    const verdict = await checkUploadInBrowser(args.file, { slotId: args.slotId });
    if (!verdict.ok && verdict.message) {
        return { url: null, error: verdict.message };
    }

    const formData = new FormData();
    formData.append('file', args.file);
    formData.append('slotId', args.slotId);
    formData.append('stepKey', args.stepKey ?? 'farm_info');
    // Only send the optional ids when we have them — appending an undefined
    // sends the literal string "undefined", which the server would file under.
    if (args.draftId) {
        formData.append('draftId', args.draftId);
    }
    if (args.applicationId) {
        formData.append('applicationId', args.applicationId);
    }

    try {
        const response = await deps.post(ENDPOINT, formData);
        const url = response?.data?.fileUrl;
        if (response?.success && typeof url === 'string' && url.trim().length > 0) {
            return { url, error: null };
        }
        // A server refusal already names the cause and the next action in Thai
        // (F-G4-08), so pass it through rather than replacing it with a sentence
        // that tells the farmer nothing about what to change.
        return { url: null, error: response?.error || 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
    } catch {
        return { url: null, error: 'อัปโหลดไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่' };
    }
}
