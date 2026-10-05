/**
 * The wizard's side of the F-G4-08 upload rules.
 *
 * Every slot has to answer the same question before it posts: what is actually
 * in this file. `File.type` is the browser's guess from the extension and
 * `File.name` is whatever the file happened to be called, so neither can answer
 * it. Only the leading bytes can, and `file.slice(0, n)` reads them without
 * pulling a 20 MB scan into memory.
 *
 * One helper rather than the same block in each uploader, because the whole
 * point of F-G4-08 is that the slots had stopped agreeing with each other.
 *
 * On failing open: this check is a COURTESY. It exists so a farmer hears "this
 * is a photo, the slot needs a PDF" the moment they pick the file instead of
 * after a slow upload. The gate is the server, which runs the same
 * `validateUploadedFile` from the same module on every request. So when the
 * bytes cannot be read at all — Blob.arrayBuffer is missing on Safari before 14
 * and FileReader can still fail on a file the OS has moved — this refuses
 * nothing and lets the request go to the server, which will answer properly.
 * A browser quirk must never be the reason a farmer cannot file an application.
 */

import { MAGIC_SNIFF_BYTES, validateUploadedFile } from '@gacp/validation/upload-rules';

/**
 * @returns the first MAGIC_SNIFF_BYTES of the file, or null when this browser
 *   cannot produce them.
 */
export async function readUploadHead(file: File): Promise<Uint8Array | null> {
    let head: Blob;
    try {
        head = file.slice(0, MAGIC_SNIFF_BYTES);
    } catch {
        return null;
    }
    try {
        // The modern path. Safari gained Blob.arrayBuffer only in 14, and a
        // farmer on an older phone must not be locked out of the wizard.
        if (typeof head.arrayBuffer === 'function') {
            return new Uint8Array(await head.arrayBuffer());
        }
    } catch {
        // fall through to FileReader
    }
    try {
        return await new Promise<Uint8Array>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(head);
        });
    } catch {
        return null;
    }
}

export interface ClientUploadVerdict {
    ok: boolean;
    /** Thai sentence naming the cause and the next action. Set only when ok is false. */
    message?: string;
    code?: string;
}

/**
 * Run the shared upload rules in the browser, for one file and one slot.
 *
 * @param file the file the farmer picked
 * @param slot either the slot's declared type ('PDF' | 'IMAGE' | 'BOTH') or, when
 *   the caller only knows the slot id, `{ slotId }` — the shared table maps it.
 */
export async function checkUploadInBrowser(
    file: File,
    slot: { slotType?: 'PDF' | 'IMAGE' | 'BOTH' | 'LINK'; slotId?: string },
): Promise<ClientUploadVerdict> {
    const head = await readUploadHead(file);
    if (head === null) {
        // See the module note: unreadable here means "let the server answer",
        // never "refuse the farmer".
        return { ok: true };
    }
    const verdict = validateUploadedFile({
        fileName: file.name,
        size: file.size,
        head,
        ...(slot.slotType !== undefined ? { slotType: slot.slotType } : {}),
        ...(slot.slotId !== undefined ? { slotId: slot.slotId } : {}),
    });
    return verdict.ok
        ? { ok: true }
        : { ok: false, message: verdict.message, code: verdict.code };
}
