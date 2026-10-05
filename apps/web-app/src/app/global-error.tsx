'use client';

import { useReportRenderError } from '@/lib/sentry/report-render-error';

/**
 * Global Error Boundary — catches unhandled errors across the entire app.
 * ใช้ 'use client' เพราะ error.tsx ต้องเป็น Client Component เสมอ
 * The error is handed to Sentry when a DSN is baked in (PII-scrubbed).
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useReportRenderError(error);
    return (
        <html lang="th">
            <body>
                <div className="flex min-h-screen items-center justify-center bg-slate-50">
                    <div className="mx-auto w-full max-w-sm px-4">
                        <div className="rounded-xl bg-white p-8 shadow-lg">
                            <div className="flex flex-col items-center gap-4">
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-700">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="12" y1="8" x2="12" y2="12" />
                                        <line x1="12" y1="16" x2="12.01" y2="16" />
                                    </svg>
                                </div>
                                <div className="text-center">
                                    <h2 className="text-xl font-semibold text-gray-900">เกิดข้อผิดพลาด</h2>
                                    <p className="mt-2 text-sm text-gray-500">
                                        ระบบพบปัญหาที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง
                                    </p>
                                </div>
                                <button
                                    onClick={reset}
                                    className="inline-flex items-center justify-center rounded-lg bg-leaf-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-leaf-800"
                                >
                                    ลองใหม่อีกครั้ง
                                </button>
                                <p className="text-xs text-gray-400">
                                    ระบบรับรองมาตรฐาน GACP สมุนไพร
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </body>
        </html>
    );
}
