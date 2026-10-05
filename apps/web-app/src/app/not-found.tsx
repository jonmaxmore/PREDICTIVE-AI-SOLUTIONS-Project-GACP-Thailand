import Link from 'next/link';

/**
 * Custom 404 Page — Server Component (no 'use client')
 * Uses plain HTML + Next.js Link to avoid Radix/shadcn component 
 * issues during build-time prerendering.
 */
export default function NotFound() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
            <div className="mx-auto w-full max-w-sm px-4">
                <div className="rounded-xl bg-card p-8 shadow-lg">
                    <div className="flex flex-col items-center gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-leaf-soft text-leaf-onSoft">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8" />
                                <path d="m21 21-4.3-4.3" />
                            </svg>
                        </div>

                        <div className="text-center">
                            <p className="text-5xl font-black text-green-700">404</p>
                            <h2 className="mt-2 text-xl font-semibold text-foreground">ไม่พบหน้าที่ต้องการ</h2>
                        </div>

                        <p className="text-center text-sm text-muted-foreground">
                            หน้าที่คุณกำลังค้นหาอาจถูกย้าย ลบ หรือไม่เคยมีอยู่
                            <br />
                            กรุณาตรวจสอบ URL อีกครั้ง
                        </p>

                        <div className="mt-3 flex items-center gap-3">
                            <Link
                                href="/"
                                className="inline-flex items-center justify-center rounded-lg bg-leaf-700 px-5 py-2.5 text-sm font-semibold text-white no-underline transition hover:bg-leaf-800"
                            >
                                กลับหน้าแรก
                            </Link>
                            <Link
                                href="/health/home"
                                className="inline-flex items-center justify-center rounded-lg border border-border bg-muted px-5 py-2.5 text-sm font-semibold text-foreground no-underline transition hover:bg-muted/70"
                            >
                                หน้าหลัก
                            </Link>
                        </div>

                        <div className="mt-4 w-full border-t border-border pt-6">
                            <div className="flex flex-col items-center">
                                <p className="text-xs text-muted-foreground">ระบบรับรองมาตรฐาน GACP</p>
                                <p className="text-xs text-muted-foreground">ระบบรับรองมาตรฐาน GACP สมุนไพร</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
