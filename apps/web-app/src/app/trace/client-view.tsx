'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import {
    Search, QrCode, ShieldCheck, Leaf,
    FlaskConical} from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { useLanguage } from '@/lib/i18n/language-context';
import { copyrightLine } from '@/lib/i18n/copyright';

export default function TraceIndexPage() {
    const router = useRouter();
    const { dict, language } = useLanguage();
    const [searchValue, setSearchValue] = useState('');
    const [isSearching, setIsSearching] = useState(false);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = searchValue.trim();
        if (!trimmed) return;

        setIsSearching(true);
        router.push(`/trace/${encodeURIComponent(trimmed)}`);
    };

    return (
        <div className="flex min-h-screen flex-col bg-mint-bg">
            {/* Header */}
            <header className="sticky top-0 z-50 border-b border-primary-100 bg-card">
                <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                            <Leaf className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-bold tracking-tight text-primary">ระบบตรวจสอบย้อนกลับ GACP</p>
                            <p className="text-[11px] font-medium text-muted-foreground">กรมการแพทย์แผนไทยและการแพทย์ทางเลือก</p>
                        </div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => router.push('/auth/health/login')}>
                        เข้าสู่ระบบสมาชิก
                    </Button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1">
                {/* Hero */}
                <section className="px-4 pt-8 sm:px-6 sm:pt-10">
                    <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[24px] bg-gradient-to-br from-primary to-leaf px-6 py-16 text-center text-white">
                        <div className="pointer-events-none absolute inset-0 opacity-10">
                            <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-white blur-3xl" />
                            <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-white blur-3xl" />
                        </div>

                        <div className="relative z-10 mx-auto max-w-3xl space-y-6">
                            <div className="animate-fade-in mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-white/30 bg-white/20">
                                <ShieldCheck size={40} className="text-white" />
                            </div>
                            {/* leading-tight (1.25) clips the Thai mark stack on a wrapped heading. */}
                            <h1 className="text-3xl font-bold leading-[1.45] tracking-tight md:text-5xl">
                                ตรวจสอบแหล่งที่มาสมุนไพร <br />
                                <span className="text-white/80">มาตรฐาน GACP Digital</span>
                            </h1>
                            <p className="mx-auto max-w-xl text-lg font-medium leading-relaxed text-white/90">
                                สแกน QR Code หรือกรอกรหัสผลิตภัณฑ์เพื่อยืนยันความปลอดภัย และตรวจสอบประวัติการปลูกจนถึงเก็บเกี่ยว
                            </p>
                        </div>
                    </div>
                </section>

                {/* Search Area */}
                <section className="-mt-8 px-4 pb-20 sm:px-6">
                    <div className="mx-auto max-w-2xl">
                        <form onSubmit={handleSearch} className="animate-fade-in-up">
                            <Card className="overflow-hidden rounded-[1.375rem] p-2">
                                <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4 sm:py-2">
                                    <div className="flex flex-1 items-center gap-3">
                                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                                            <Search size={22} />
                                        </div>
                                        <input
                                            type="text"
                                            value={searchValue}
                                            onChange={(e) => setSearchValue(e.currentTarget.value)}
                                            placeholder="สแกน QR หรือกรอกรหัส Lot / Batch..."
                                            aria-label="ค้นหาด้วยรหัสล็อต รหัสแบทช์ หรือสแกนคิวอาร์โค้ด"
                                            className="min-w-0 flex-1 rounded-lg bg-transparent py-2 text-lg font-semibold text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf focus-visible:ring-offset-2"
                                            // X6-B: this is the only input on the public trace landing page —
                                            // the page exists solely so a consumer can scan/enter a lot ID,
                                            // so focusing it on load is unambiguously what every user wants.
                                            // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: primary input on a dedicated single-purpose page (per WAI-ARIA APG single-action page guidance).
                                            autoFocus
                                        />
                                    </div>
                                    <Button
                                        type="submit"
                                        size="lg"
                                        variant="primary"
                                        disabled={!searchValue.trim() || isSearching}
                                        loading={isSearching}
                                        className="w-full sm:w-auto"
                                    >
                                        {isSearching ? '...' : 'ตรวจสอบ'}
                                    </Button>
                                </div>
                            </Card>
                        </form>

                        <div className="animate-fade-in mt-10 grid grid-cols-1 gap-6 delay-200 md:grid-cols-3">
                            <Card className="rounded-[1.375rem]">
                                <CardContent className="space-y-4 p-6 text-center">
                                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                                        <Leaf size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-primary">แหล่งปลูกคุณภาพ</h3>
                                        <p className="mt-1 text-xs font-medium text-muted-foreground">ยืนยันพิกัดแปลงและรอบการปลูกที่ได้รับการรับรอง</p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="rounded-[1.375rem]">
                                <CardContent className="space-y-4 p-6 text-center">
                                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                                        <FlaskConical size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-primary">วิเคราะห์คุณภาพ</h3>
                                        <p className="mt-1 text-xs font-medium text-muted-foreground">แสดงผลตรวจ Lab, สารสำคัญ และความปลอดภัย</p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="rounded-[1.375rem]">
                                <CardContent className="space-y-4 p-6 text-center">
                                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                                        <QrCode size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-primary">ฉลากอัจฉริยะ (Smart Label)</h3>
                                        <p className="mt-1 text-xs font-medium text-muted-foreground">เชื่อมต่อข้อมูลแบบ Real-time ตลอดห่วงโซ่อุปทาน</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="border-t border-primary-100 bg-mint-soft px-6 py-8 text-center">
                <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 md:flex-row">
                    <p className="text-[11px] font-semibold text-muted-foreground">
                        {copyrightLine(dict.footer.copyright, language)}
                    </p>
                    <div className="flex gap-6">
                        <Link href="/terms" className="text-[11px] font-medium text-muted-foreground hover:text-leaf-700">ข้อกำหนดการใช้งาน</Link>
                        <Link href="/privacy" className="text-[11px] font-medium text-muted-foreground hover:text-leaf-700">นโยบายความเป็นส่วนตัว</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
