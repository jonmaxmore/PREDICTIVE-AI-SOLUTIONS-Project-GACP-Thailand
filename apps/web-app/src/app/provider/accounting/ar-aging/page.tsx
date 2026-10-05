'use client';

import { IconArrowLeft } from '@tabler/icons-react';
import ProviderLayout from '../../components/provider-layout';
import { ArAgingReport } from '../reports/ArAgingReport';

/**
 * AR Aging dashboard (รายงานลูกหนี้ค้างชำระ) — B20-D, 2026-05-16.
 *
 * Standalone page (its own tab in the accounting sub-nav). Every viewer who
 * can open /provider/accounting sees the same report and picks the book side
 * themselves — the two finance roles get one view (operator 2026-09-11).
 */
export default function ArAgingPage() {
    return (
        <ProviderLayout>
            <div className="space-y-5 p-4 md:p-6 print:p-0">
                <div className="flex items-center gap-2 print:hidden">
                    <a
                        href="/provider/accounting"
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted"
                    >
                        <IconArrowLeft size={16} />
                        กลับไปบัญชีและใบเสร็จ
                    </a>
                </div>

                <ArAgingReport />

                <style jsx global>{`
                    @media print {
                        @page { size: A4 landscape; margin: 10mm; }
                        nav, aside, header.sticky, .print\\:hidden { display: none !important; }
                        body { background: white !important; }
                        main { padding: 0 !important; }
                    }
                `}</style>
            </div>
        </ProviderLayout>
    );
}
