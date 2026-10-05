'use client';

import * as React from 'react';
import { FINANCE_EMAIL, PRIVACY_EMAIL, SUPPORT_EMAIL } from '@/constants/contact-emails';

/**
 * ContactClient — pre-fill helper for contacting support.
 *
 * Generates a `mailto:` link from form inputs so users can review the
 * draft in their email client before sending. We deliberately do NOT
 * post the form data to any backend route — staying mailto-only keeps
 * scope tight and avoids spinning up a new API endpoint for Iter 28.
 */

const TOPICS = [
    { id: 'application', label: 'การสมัคร / Application' },
    { id: 'payment', label: 'การชำระเงิน / Payment' },
    { id: 'audit', label: 'การตรวจฟาร์ม / Audit' },
    { id: 'certificate', label: 'ใบรับรอง / Certificate' },
    { id: 'refund', label: 'การคืนเงิน / Refund' },
    { id: 'pdpa', label: 'PDPA / ความเป็นส่วนตัว' },
    { id: 'other', label: 'อื่น ๆ' },
] as const;

const TOPIC_TO_EMAIL: Record<string, string> = {
    payment: FINANCE_EMAIL,
    refund: FINANCE_EMAIL,
    pdpa: PRIVACY_EMAIL,
};
const DEFAULT_EMAIL = SUPPORT_EMAIL;

export default function ContactClient() {
    const [topic, setTopic] = React.useState<string>('application');
    const [subject, setSubject] = React.useState<string>('');
    const [body, setBody] = React.useState<string>('');
    const [name, setName] = React.useState<string>('');
    const [appId, setAppId] = React.useState<string>('');

    const to = TOPIC_TO_EMAIL[topic] ?? DEFAULT_EMAIL;
    const fullSubject = subject || `[${topic}] คำถามจากผู้สมัคร GACP`;
    const fullBody = [
        body,
        '',
        'ข้อมูลผู้ส่ง',
        name ? `ชื่อ: ${name}` : null,
        appId ? `เลขที่คำขอ: ${appId}` : null,
    ]
        .filter(Boolean)
        .join('\n');

    const mailto = `mailto:${to}?subject=${encodeURIComponent(fullSubject)}&body=${encodeURIComponent(fullBody)}`;

    return (
        <section
            aria-labelledby="form-heading"
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6"
        >
            <h2 id="form-heading" className="text-sm font-bold text-slate-700">
                แบบฟอร์มร่างอีเมล
            </h2>
            <p className="mt-1 text-xs text-slate-500">
                กรอกข้อมูล แล้วกด &ldquo;เปิดในแอปอีเมล&rdquo; ระบบจะสร้างร่างอีเมลพร้อมใช้งานในโปรแกรมอีเมลของคุณ
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="หัวข้อ" htmlFor="contact-topic">
                    <select
                        id="contact-topic"
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600"
                    >
                        {TOPICS.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.label}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="ชื่อ-นามสกุล (ไม่บังคับ)" htmlFor="contact-name">
                    <input
                        id="contact-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600"
                    />
                </Field>
                <Field label="เลขที่คำขอ (ถ้ามี)" htmlFor="contact-app">
                    <input
                        id="contact-app"
                        type="text"
                        value={appId}
                        onChange={(e) => setAppId(e.target.value)}
                        placeholder="เช่น APP-2026-000123"
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600"
                    />
                </Field>
                <Field label="หัวเรื่อง (ไม่บังคับ)" htmlFor="contact-subject">
                    <input
                        id="contact-subject"
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={`[${topic}] คำถามจากผู้สมัคร GACP`}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600"
                    />
                </Field>
            </div>

            <div className="mt-4">
                <Field label="รายละเอียดคำถาม" htmlFor="contact-body">
                    <textarea
                        id="contact-body"
                        rows={5}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="เล่ารายละเอียดคำถาม สถานการณ์ และสิ่งที่คุณได้ลองทำมาแล้ว..."
                        className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600"
                    />
                </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <span>
                    จะส่งไปยัง:{' '}
                    <strong className="font-mono text-slate-900">{to}</strong>
                </span>
                <a
                    href={mailto}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-leaf-800"
                >
                    เปิดในแอปอีเมล
                </a>
            </div>
        </section>
    );
}

function Field({
    label,
    htmlFor,
    children,
}: {
    label: string;
    htmlFor: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={htmlFor} className="text-xs font-semibold text-slate-700">
                {label}
            </label>
            {children}
        </div>
    );
}
