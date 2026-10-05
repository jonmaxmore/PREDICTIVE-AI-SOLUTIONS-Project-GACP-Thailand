'use client';

import Link from 'next/link';
import { GLOSSARY_ENTRIES } from '@/components/help/faq-data';
import { useLanguage } from '@/lib/i18n/language-context';

/**
 * The glossary body, split out of `page.tsx` so it can read the language.
 *
 * The page kept its copy in literals and rendered the same Thai whichever
 * language was selected — 1,281 Thai characters under `<html lang="en">`.
 * Reading the dictionary from the server component would not have fixed
 * that: the language lives in localStorage, so only the client knows it.
 * Hence this split, which is the same shape `help/contact` already uses.
 *
 * The entries live in `faq-data.ts` and are now authored in both
 * languages, so this picks the side matching the active choice. Terms
 * lead in Thai on the Thai side; only GACP and PDPA keep an acronym,
 * because those are the names printed on the certificate and in the Act
 * that a reader has to match against.
 */
const CATEGORY_ORDER = ['gacp', 'audit', 'finance', 'general'] as const;

export default function GlossaryClient() {
    const { dict, language } = useLanguage();
    const copy = dict.health.help.glossary;
    const isEnglish = language === 'en';

    const grouped = CATEGORY_ORDER.map((category) => ({
        category,
        label: copy.categories[category] ?? category,
        entries: GLOSSARY_ENTRIES.filter((e) => e.category === category),
    })).filter((g) => g.entries.length > 0);

    return (
        <main className="min-h-screen w-full bg-slate-50 px-4 py-8 md:px-8 md:py-10">
            <div className="mx-auto max-w-4xl space-y-6">
                <header>
                    <p className="text-xs font-bold text-leaf-700">{copy.eyebrow}</p>
                    <h1 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">
                        {copy.title.replace('{count}', String(GLOSSARY_ENTRIES.length))}
                    </h1>
                    <p className="mt-1 text-sm text-slate-600">{copy.description}</p>
                </header>

                {grouped.map((group) => (
                    <section
                        key={group.category}
                        aria-labelledby={`glossary-${group.category}`}
                        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6"
                    >
                        <h2
                            id={`glossary-${group.category}`}
                            className="text-sm font-bold text-leaf-700"
                        >
                            {group.label}
                        </h2>
                        <dl className="mt-3 divide-y divide-slate-100">
                            {group.entries.map((entry) => (
                                <div key={entry.id} className="py-3">
                                    <dt className="text-sm font-bold text-slate-900">
                                        {isEnglish ? entry.termEn : entry.term}
                                    </dt>
                                    <dd className="mt-1 text-sm leading-relaxed text-slate-600">
                                        {isEnglish ? entry.definitionEn : entry.definition}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                ))}

                <p className="text-center text-xs text-slate-500">
                    {copy.notInListPrefix}{' '}
                    <Link href="/help/contact" className="font-semibold text-leaf-700 hover:underline">
                        {copy.notInListLink}
                    </Link>
                </p>
            </div>
        </main>
    );
}
