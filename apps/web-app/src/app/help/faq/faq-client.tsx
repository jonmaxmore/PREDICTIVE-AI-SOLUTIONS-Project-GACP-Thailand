'use client';

import * as React from 'react';
import Link from 'next/link';
import { FaqAccordion } from '@/components/help/FaqAccordion';
import { HelpSearchBar } from '@/components/help/HelpSearchBar';
import { FAQ_COUNT, FAQ_TOPICS, buildFaqTopics, flattenFaqItems } from '@/components/help/faq-data';
import { usePricing } from '@/hooks/use-pricing';
import { useLanguage } from '@/lib/i18n/language-context';

/**
 * FaqClient — interactive FAQ page.
 *
 * Renders topic tabs + an expandable Q&A accordion. The search field
 * filters across question, answer, and keywords. When a query is
 * active the topic switcher is hidden and search results from every
 * topic are merged into a single list.
 */
export default function FaqClient() {
    const { dict } = useLanguage();
    const copy = dict.health.help.faq;
    // Fee answers carry the served amounts (GET /api/pricing/fees), or the
    // notice and no number while loading or when they cannot be read.
    const { state: feesState } = usePricing();
    const topics = React.useMemo(() => buildFaqTopics(feesState), [feesState]);
    const allItems = React.useMemo(() => flattenFaqItems(topics), [topics]);
    const [activeTopic, setActiveTopic] = React.useState<string>(FAQ_TOPICS[0]?.id ?? '');
    const [query, setQuery] = React.useState<string>('');

    // React to hash on first render so /help/faq#audit jumps directly
    // to the audit topic (used by the help home topic cards).
    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const hash = window.location.hash.replace('#', '');
        if (hash && FAQ_TOPICS.some((t) => t.id === hash)) {
            setActiveTopic(hash);
        }
    }, []);

    const normalizedQuery = query.trim().toLowerCase();
    const isSearching = normalizedQuery.length > 0;

    const searchResults = React.useMemo(() => {
        if (!isSearching) return [];
        return allItems.filter((item) => {
            const haystacks: string[] = [item.question, item.answer, ...(item.keywords ?? [])];
            return haystacks.some((h) => h.toLowerCase().includes(normalizedQuery));
        });
    }, [isSearching, normalizedQuery, allItems]);

    const currentTopic = topics.find((t) => t.id === activeTopic) ?? topics[0];

    return (
        <>
            <header>
                <p className="text-xs font-bold text-leaf-700">{copy.eyebrow}</p>
                <h1 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">
                    {copy.title.replace('{count}', String(FAQ_COUNT))}
                </h1>
                <p className="mt-1 text-sm text-slate-600">{copy.description}</p>
            </header>

            <HelpSearchBar value={query} onChange={setQuery} />

            {!isSearching ? (
                // X6-B: dropped <nav role="tablist"> → <div role="tablist">.
                // jsx-a11y/no-noninteractive-element-to-interactive-role flagged
                // <nav> (a landmark) carrying the interactive tablist role.
                // The WAI-ARIA APG §3.13 tabs pattern doesn't require <nav>;
                // a plain container with role="tablist" is canonical. The
                // aria-label is preserved so AT users still hear "หัวข้อคำถาม".
                <div
                    role="tablist"
                    aria-label={copy.tabListLabel}
                    className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm"
                >
                    {topics.map((topic) => {
                        const active = topic.id === activeTopic;
                        return (
                            <button
                                key={topic.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setActiveTopic(topic.id)}
                                data-testid={`faq-topic-${topic.id}`}
                                className={
                                    active
                                        ? 'inline-flex h-9 items-center rounded-lg bg-leaf-800 px-3 text-sm font-semibold text-white shadow-sm'
                                        : 'inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100'
                                }
                            >
                                {topic.title}
                                <span className="ml-1.5 text-xs tabular-nums opacity-90">
                                    ({topic.items.length})
                                </span>
                            </button>
                        );
                    })}
                </div>
            ) : null}

            {isSearching ? (
                <section aria-labelledby="search-results-heading">
                    <h2 id="search-results-heading" className="mb-2 text-sm font-semibold text-slate-700">
                        {copy.searchHeading
                            .replace('{query}', query)
                            .replace('{count}', String(searchResults.length))}
                    </h2>
                    <FaqAccordion items={searchResults} ariaLabelledBy="search-results-heading" />
                </section>
            ) : (
                <section aria-labelledby={`topic-${currentTopic?.id}-heading`}>
                    <h2
                        id={`topic-${currentTopic?.id}-heading`}
                        className="mb-2 text-lg font-bold text-slate-900"
                    >
                        {currentTopic?.title}
                    </h2>
                    <p className="mb-3 text-sm text-slate-500">{currentTopic?.description}</p>
                    <FaqAccordion
                        items={currentTopic?.items ?? []}
                        ariaLabelledBy={`topic-${currentTopic?.id}-heading`}
                    />
                </section>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">{copy.stillNeedHelpTitle}</h3>
                <p className="mt-1 text-xs text-slate-600">{copy.stillNeedHelpBody}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                        href="/help/contact"
                        className="inline-flex h-9 items-center justify-center rounded-lg bg-leaf-700 px-3 text-xs font-semibold text-white hover:bg-leaf-800"
                    >
                        {copy.contactCta}
                    </Link>
                    <Link
                        href="/help/glossary"
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        {copy.glossaryCta}
                    </Link>
                </div>
            </div>
        </>
    );
}
