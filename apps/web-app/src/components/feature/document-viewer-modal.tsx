'use client';

/**
 * Read an attached document INSIDE the page.
 *
 * `/uploads` is served `Content-Disposition: attachment`
 * (apps/backend/middleware/uploads-security-headers.js) — deliberate PDPA hardening
 * that neutralises a document.referrer leak and a cross-origin embed vector. The
 * consequence is that anything which navigates to the file DOWNLOADS it: a copy of a
 * national-ID scan lands on the reader's disk merely because they wanted to check it.
 *
 * A SUBRESOURCE load is exempt from that header — the note in the middleware says so —
 * so an `<img>` or an `<iframe>` pointed at a blob: URL renders the file in place and
 * nothing is written to disk. Opening the viewer therefore never triggers a download.
 * Getting a copy stays possible, but only as an explicit second act: the ดาวน์โหลด
 * button below, pressed on purpose.
 */

import { useEffect, useState } from 'react';
import { fetchDocumentForViewer, type PreviewedDocument } from '@/lib/services/preview-document';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/primitives/dialog';

export interface DocumentViewerFile {
    url: string;
    name: string;
    /** Optional hint; the fetched blob's own type wins when it disagrees. */
    mime?: string;
}

export interface DocumentViewerModalProps {
    file: DocumentViewerFile | null;
    onClose: () => void;
}

export const VIEWER_COPY_TH = Object.freeze({
    title: 'ดูเอกสาร',
    loading: 'กำลังเปิดเอกสาร',
    download: 'ดาวน์โหลด',
    close: 'ปิด',
    failed: 'เปิดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หากยังไม่ได้กรุณาแจ้งเจ้าหน้าที่',
    unsupported: 'ไฟล์ชนิดนี้แสดงในหน้าไม่ได้ คุณสามารถกดดาวน์โหลดเพื่อเปิดด้วยโปรแกรมในเครื่อง',
});

function isImage(mime: string): boolean {
    return mime.startsWith('image/');
}

function isPdf(mime: string): boolean {
    return mime === 'application/pdf' || mime.endsWith('/pdf');
}

export function DocumentViewerModal({ file, onClose }: DocumentViewerModalProps) {
    const [doc, setDoc] = useState<PreviewedDocument | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!file) { setDoc(null); setError(null); return undefined; }
        let cancelled = false;
        let opened: PreviewedDocument | null = null;
        (async () => {
            try {
                const next = await fetchDocumentForViewer(file.url);
                if (cancelled) { next.revoke(); return; }
                opened = next;
                setDoc(next);
                setError(null);
            } catch {
                if (!cancelled) { setError(VIEWER_COPY_TH.failed); }
            }
        })();
        // The object URL is this component's to free. Leaving it alive keeps the whole
        // blob in memory for as long as the tab lives.
        return () => { cancelled = true; opened?.revoke(); };
    }, [file]);

    if (!file) { return null; }

    const mime = doc?.mime || file.mime || '';

    return (
        <Dialog open onOpenChange={(open) => { if (!open) { onClose(); } }}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{file.name || VIEWER_COPY_TH.title}</DialogTitle>
                </DialogHeader>

                {error && <p role="alert" className="py-8 text-center text-sm text-destructive">{error}</p>}

                {!error && !doc && (
                    <p role="status" className="py-8 text-center text-sm text-muted-foreground">
                        {VIEWER_COPY_TH.loading}
                    </p>
                )}

                {!error && doc && isImage(mime) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={doc.objectUrl} alt={file.name} className="max-h-[70vh] w-full object-contain" />
                )}

                {!error && doc && isPdf(mime) && (
                    <iframe src={doc.objectUrl} title={file.name} className="h-[70vh] w-full rounded-lg border border-muted" />
                )}

                {!error && doc && !isImage(mime) && !isPdf(mime) && (
                    <p role="status" className="py-8 text-center text-sm text-muted-foreground">
                        {VIEWER_COPY_TH.unsupported}
                    </p>
                )}

                <DialogFooter>
                    {/* The ONLY thing that puts a copy on the reader's disk, and it takes
                        a deliberate press. Opening the viewer never does. */}
                    {doc && (
                        <a
                            href={doc.objectUrl}
                            download={file.name}
                            className="rounded-lg border border-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                        >
                            {VIEWER_COPY_TH.download}
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg bg-leaf-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-leaf-800"
                    >
                        {VIEWER_COPY_TH.close}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default DocumentViewerModal;
