import type { Metadata } from 'next';
import Link from 'next/link';
import ContactClient from './contact-client';
import { FINANCE_EMAIL, PRIVACY_EMAIL, SUPPORT_EMAIL, mailtoHref } from '@/constants/contact-emails';

export const metadata: Metadata = {
    title: 'ติดต่อเจ้าหน้าที่ | ศูนย์ช่วยเหลือ GACP',
    description:
        `ส่งคำถามถึงทีมช่วยเหลือ อีเมล ${SUPPORT_EMAIL} พร้อมแบบฟอร์มเตรียมร่างก่อนส่ง`,
};

const CONTACT_CARDS = [
    {
        label: 'อีเมลทั่วไป',
        href: mailtoHref(SUPPORT_EMAIL),
        value: SUPPORT_EMAIL,
        description: 'คำถามทั่วไป ขอความช่วยเหลือ',
    },
    {
        label: 'อีเมลความเป็นส่วนตัว',
        href: mailtoHref(PRIVACY_EMAIL),
        value: PRIVACY_EMAIL,
        description: 'PDPA ขอลบบัญชี ขอใช้สิทธิเจ้าของข้อมูล',
    },
    {
        label: 'อีเมลการเงิน',
        href: mailtoHref(FINANCE_EMAIL),
        value: FINANCE_EMAIL,
        description: 'ใบเสร็จ การคืนเงิน การชำระเงิน',
    },
];

export default function ContactPage() {
    return (
        <main className="min-h-screen w-full bg-slate-50 px-4 py-8 md:px-8 md:py-10">
            <div className="mx-auto max-w-3xl space-y-6">
                <header>
                    <p className="text-xs font-bold text-leaf-700">
                        ศูนย์ช่วยเหลือ · ติดต่อเจ้าหน้าที่
                    </p>
                    <h1 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">
                        ติดต่อทีมช่วยเหลือ
                    </h1>
                    <p className="mt-1 text-sm text-slate-600">
                        ส่งอีเมลโดยตรง หรือใช้แบบฟอร์มด้านล่างเพื่อร่างข้อความก่อนส่ง ทีมงานตอบกลับภายใน
                        2 วันทำการ
                    </p>
                </header>

                <section aria-labelledby="emails-heading">
                    <h2 id="emails-heading" className="mb-2 text-sm font-bold text-slate-700">
                        ช่องทางอีเมล
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-3">
                        {CONTACT_CARDS.map((c) => (
                            <a
                                key={c.href}
                                href={c.href}
                                className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-leaf-300 hover:bg-leaf-soft/40"
                            >
                                <p className="text-xs font-semibold text-slate-500">
                                    {c.label}
                                </p>
                                <p className="mt-1 break-all text-sm font-bold text-leaf-700">
                                    {c.value}
                                </p>
                                <p className="mt-2 text-xs text-slate-500">{c.description}</p>
                            </a>
                        ))}
                    </div>
                </section>

                <ContactClient />

                <section
                    aria-labelledby="address-heading"
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                    <h2 id="address-heading" className="text-sm font-bold text-slate-700">
                        ที่อยู่
                    </h2>
                    <p className="mt-2 text-sm text-slate-700">กรมการแพทย์แผนไทยและการแพทย์ทางเลือก</p>
                    <p className="text-sm text-slate-600">
                        88/23 หมู่ 4 ถ. ติวานนท์ ต. ตลาดขวัญ อ. เมือง จ. นนทบุรี 11000
                    </p>
                    <p className="mt-2 text-xs text-slate-500">เปิดทำการ จันทร์ - ศุกร์ 08:30 - 16:30 น.</p>
                </section>

                <p className="text-center text-xs text-slate-500">
                    ก่อนติดต่อ ลองค้นหาคำตอบใน{' '}
                    <Link href="/help/faq" className="font-semibold text-leaf-700 hover:underline">
                        คำถามที่พบบ่อย
                    </Link>{' '}
                    ก่อน เพื่อความรวดเร็ว
                </p>
            </div>
        </main>
    );
}
