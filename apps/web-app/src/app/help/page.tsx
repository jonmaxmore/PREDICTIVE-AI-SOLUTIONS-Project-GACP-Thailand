import type { Metadata } from 'next';
import Link from 'next/link';
import { FAQ_TOPICS, FAQ_COUNT } from '@/components/help/faq-data';
import { th } from '@/lib/i18n/dictionaries/th';
import { HelpBackHomeCrumb } from './help-back-home-crumb';
import { SUPPORT_EMAIL, mailtoHref } from '@/constants/contact-emails';

/**
 * Copy comes from the dictionary, not from literals in this file.
 *
 * `th.health.help.home` already described this page in full, but nothing
 * read it — the page rendered its own hardcoded set, so the two drifted
 * apart in silence and an edit to the dictionary changed nothing on
 * screen. Reading it here makes the dictionary the single source, and
 * `__tests__/help-home-copy.test.tsx` holds them together.
 *
 * This is a server component, so the import costs no client bundle.
 */
const copy = th.health.help.home;

export const metadata: Metadata = {
    title: copy.metaTitle,
    description: copy.metaDesc,
};

const QUICK_LINKS = [
    {
        href: '/help/faq',
        title: copy.shortcutFaqTitle,
        description: copy.shortcutFaqDesc.replace('{count}', String(FAQ_COUNT)),
    },
    {
        href: '/help/contact',
        title: copy.shortcutContactTitle,
        description: copy.shortcutContactDesc,
    },
    {
        href: '/help/glossary',
        title: copy.shortcutGlossaryTitle,
        description: copy.shortcutGlossaryDesc,
    },
    {
        href: '/health/onboarding',
        title: copy.shortcutOnboardingTitle,
        description: copy.shortcutOnboardingDesc,
    },
];

export default function HelpHome() {
    return (
        <main className="min-h-screen w-full bg-slate-50 px-4 py-8 md:px-8 md:py-10">
            <div className="mx-auto max-w-5xl space-y-8">
                <HelpBackHomeCrumb />
                <header className="rounded-2xl border border-leaf-soft bg-leaf-soft p-6 shadow-sm md:p-8">
                    <p className="text-xs font-bold text-leaf-700">{copy.eyebrow}</p>
                    <h1 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">
                        {copy.heroTitle}
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm text-slate-600 md:text-base">
                        {copy.heroBody}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                            href="/help/faq"
                            className="inline-flex h-10 items-center justify-center rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2"
                        >
                            อ่านคำถามที่พบบ่อย
                        </Link>
                        <Link
                            href="/help/contact"
                            className="inline-flex h-10 items-center justify-center rounded-lg border border-leaf-300 bg-white px-4 text-sm font-semibold text-leaf-onSoft hover:bg-leaf-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2"
                        >
                            ติดต่อเจ้าหน้าที่
                        </Link>
                    </div>
                </header>

                <section aria-labelledby="quick-links-heading">
                    <h2
                        id="quick-links-heading"
                        className="mb-3 text-sm font-bold text-slate-700"
                    >
                        ทางลัด
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {QUICK_LINKS.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className="group flex h-full flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-leaf-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2"
                            >
                                <p className="text-sm font-bold text-slate-900 group-hover:text-leaf-700">
                                    {link.title}
                                </p>
                                <p className="text-xs leading-relaxed text-slate-500">{link.description}</p>
                            </Link>
                        ))}
                    </div>
                </section>

                <section aria-labelledby="topics-heading">
                    <div className="mb-3 flex items-end justify-between gap-2">
                        <h2 id="topics-heading" className="text-sm font-bold text-slate-700">
                            หัวข้อทั้งหมด
                        </h2>
                        <Link
                            href="/help/faq"
                            className="rounded text-xs font-semibold text-leaf-700 hover:text-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2"
                            aria-label="ดูคำถามทั้งหมด"
                        >
                            <span aria-hidden="true">ดูทั้งหมด →</span>
                        </Link>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {FAQ_TOPICS.map((topic) => (
                            <Link
                                key={topic.id}
                                href={`/help/faq#${topic.id}`}
                                className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-leaf-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2"
                            >
                                <p className="text-base font-bold text-slate-900">{topic.title}</p>
                                <p className="mt-1 text-xs text-slate-500">{topic.description}</p>
                                <p className="mt-3 text-xs font-medium text-leaf-700">
                                    {topic.items.length} คำถาม
                                </p>
                            </Link>
                        ))}
                    </div>
                </section>

                <section
                    aria-labelledby="contact-heading"
                    className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8"
                >
                    <h2 id="contact-heading" className="text-lg font-bold text-slate-900">
                        ไม่พบคำตอบที่ต้องการ?
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                        ทีมงานช่วยเหลือพร้อมตอบทุกคำถามในเวลาราชการ ส่งอีเมลถึงเรา หรืออ่านอภิธานศัพท์เพิ่มเติม
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                        <a
                            href={mailtoHref(SUPPORT_EMAIL)}
                            className="inline-flex h-10 items-center justify-center rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2"
                        >
                            ส่งอีเมลถึงเรา
                        </a>
                        <Link
                            href="/help/contact"
                            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2"
                        >
                            หน้าติดต่อ
                        </Link>
                        <Link
                            href="/help/glossary"
                            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2"
                        >
                            อภิธานศัพท์
                        </Link>
                    </div>
                </section>
            </div>
        </main>
    );
}
