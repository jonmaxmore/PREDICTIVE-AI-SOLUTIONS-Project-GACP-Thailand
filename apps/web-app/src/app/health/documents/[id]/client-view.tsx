"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { apiClient as api } from "@/lib/api";
import { Spinner } from '@/components/ui/spinner';
import { HEALTH_LOGIN_ROUTE } from "@/lib/constants/auth-routes";
import { getStoredUser } from "@/lib/services/auth-service-session";
import { mapDocumentResponse, type DocumentApiData, type DocumentView } from "./document-view";

export default function DocumentViewerPage() {
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;

    const [document, setDocument] = useState<DocumentView | null>(null);
    // Blob object URL for inline render — /uploads/* ships
    // Content-Disposition:attachment so a raw <iframe src=fileUrl> won't
    // preview; we fetch the file as a blob (credentials+Bearer) and render the
    // object URL. Preserves the PDPA security headers (BUG A/BUG B).
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [zoom, setZoom] = useState(100);
    const [mounted, setMounted] = useState(false);
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        setMounted(true);
        setIsDark(localStorage.getItem("theme") === "dark");

        if (!getStoredUser()) {
            router.replace(HEALTH_LOGIN_ROUTE);
            return;
        }

        let revoked = false;
        let objectUrl: string | null = null;

        const load = async () => {
            if (!id) return;
            setLoading(true);
            setError(null);
            try {
                const result = await api.get<DocumentApiData>(`/documents/${id}`);
                // apiClient strips the envelope → result.data IS the document data.
                const view = result.success ? mapDocumentResponse(result.data) : null;
                if (!view) {
                    // Real error state — NEVER fabricate mock metadata (was the
                    // false-green landmine).
                    setError("ไม่พบเอกสารนี้ หรือคุณไม่มีสิทธิ์เข้าถึง");
                    return;
                }
                setDocument(view);

                // Fetch the file as a blob for inline preview (attachment-header safe).
                const blob = await api.getBlob(view.fileUrl);
                if (!blob) {
                    setError("ไม่สามารถโหลดไฟล์เอกสารได้");
                    return;
                }
                if (revoked) return;
                objectUrl = URL.createObjectURL(blob);
                setPreviewUrl(objectUrl);
            } catch {
                setError("ไม่สามารถโหลดเอกสารได้");
            } finally {
                setLoading(false);
            }
        };

        void load();

        return () => {
            revoked = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [id, router]);

    const handleDownload = () => {
        if (!document || !previewUrl) return;
        const link = window.document.createElement('a');
        link.href = previewUrl;
        link.download = document.name;
        window.document.body.appendChild(link);
        link.click();
        window.document.body.removeChild(link);
    };
    const formatFileSize = (bytes: number) => bytes < 1024 ? bytes + " B" : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + " KB" : (bytes / (1024 * 1024)).toFixed(2) + " MB";

    if (!mounted) return null;
    const isPdf = document?.mimeType === "application/pdf";
    const isImage = document?.mimeType?.startsWith("image/");

    return (
        <div className={`min-h-screen font-sans ${isDark ? 'text-surface-100 bg-slate-900' : 'bg-surface-100 text-slate-900'}`}>
            {/* Header */}
            <header className={`sticky top-0 z-50 flex items-center justify-between border-b px-6 py-3 ${isDark ? 'border-slate-700 bg-slate-800' : 'border-surface-200 bg-card'}`}>
                <div className="flex items-center gap-4">
                    <Link href="/health/applications" className={`flex items-center gap-2 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg> กลับ
                    </Link>
                    {document && (
                        <div className={`border-l pl-4 ${isDark ? 'border-slate-700' : 'border-surface-200'}`}>
                            <h1 className="text-base font-medium">{document.name}</h1>
                            <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{formatFileSize(document.size)}{document.uploadedAt ? ` • อัปโหลดเมื่อ ${new Date(document.uploadedAt).toLocaleDateString('th-TH')}` : ''}</p>
                        </div>
                    )}
                </div>
                {document && previewUrl && (
                    <div className="flex items-center gap-2">
                        <div className={`flex items-center gap-1 rounded-lg border p-1 ${isDark ? 'border-slate-600 bg-slate-700' : 'border-surface-200 bg-card'}`}>
                            <button onClick={() => setZoom(Math.max(50, zoom - 25))} className="hover:bg-surface-100 flex h-8 w-8 items-center justify-center rounded-lg">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                            </button>
                            <span className={`min-w-[40px] text-center text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{zoom}%</span>
                            <button onClick={() => setZoom(Math.min(200, zoom + 25))} className="hover:bg-surface-100 flex h-8 w-8 items-center justify-center rounded-lg">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                            </button>
                        </div>
                        <button onClick={() => window.print()} className={`flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm ${isDark ? 'border-slate-600' : 'border-surface-200'}`}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
                            พิมพ์
                        </button>
                        <button onClick={handleDownload} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            ดาวน์โหลด
                        </button>
                    </div>
                )}
            </header>

            {/* Content */}
            <main className="flex justify-center p-6">
                {loading ? (
                    <div className="flex h-[60vh] flex-col items-center justify-center">
                        <Spinner size="xl" />
                        <p className={`mt-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>กำลังโหลดเอกสาร...</p>
                    </div>
                ) : error ? (
                    <div className={`rounded-2xl border p-16 text-center ${isDark ? 'border-slate-700 bg-slate-800' : 'border-surface-200 bg-card'}`}>
                        <p className="font-medium text-red-500">{error}</p>
                        <Link href="/health/applications" className="mt-4 inline-block rounded-lg bg-primary-600 px-5 py-2.5 text-white">กลับ</Link>
                    </div>
                ) : document && previewUrl ? (
                    <div className="w-full max-w-[900px] transition-transform" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
                        {isPdf ? (
                            <iframe title={`เอกสาร: ${document.name}`} src={previewUrl} className={`h-[80vh] w-full rounded-xl border bg-white ${isDark ? 'border-slate-700' : 'border-surface-200'}`} />
                        ) : isImage ? (
                            <div className={`rounded-xl border p-4 text-center ${isDark ? 'border-slate-700 bg-slate-800' : 'border-surface-200 bg-card'}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={previewUrl} alt={document.name} className="max-w-full rounded-lg" />
                            </div>
                        ) : (
                            <div className={`rounded-2xl border p-16 text-center ${isDark ? 'border-slate-700 bg-slate-800' : 'border-surface-200 bg-card'}`}>
                                <div className={`mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>
                                </div>
                                <h3 className="mb-2 text-lg font-medium">{document.name}</h3>
                                <p className={`mb-5 text-sm ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>ไม่สามารถแสดงตัวอย่างได้</p>
                                <button onClick={handleDownload} className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-3 font-medium text-white">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                    ดาวน์โหลดเพื่อดู
                                </button>
                            </div>
                        )}
                    </div>
                ) : null}
            </main>

            <style dangerouslySetInnerHTML={{ __html: `@media print { header { display: none !important; } main { padding: 0 !important; } }` }} />
        </div>
    );
}
