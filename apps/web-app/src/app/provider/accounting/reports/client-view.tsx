'use client';

import { useState } from 'react';
import {
    IconArrowLeft,
    IconBuildingBank,
    IconFileSpreadsheet,
    IconNotebook,
    IconReceiptTax,
    IconScale,
} from '@tabler/icons-react';
import ProviderLayout from '../../components/provider-layout';
import { PageToolbar, TabNav, type TabItem } from '@/components/finance';
import { useAuth } from '@/lib/services/auth-provider';
import { canViewAccounting } from '@/lib/constants/canonical-roles';
import { TrialBalanceTable } from './TrialBalanceTable';
import { ProfitAndLossStatement } from './ProfitAndLossStatement';
import { BalanceSheetStatement } from './BalanceSheetStatement';
import { GeneralLedgerViewer } from './GeneralLedgerViewer';
import { OutputVatReport } from './OutputVatReport';

/**
 * Five-tab Finance Dashboard. Tab labels are in Thai; the order
 * matches the natural accounting workflow (TB → P&L → BS → GL →
 * VAT). Mobile (< 768px) collapses the tab row to a select so
 * it fits comfortably on phones.
 */
const TABS = [
    { id: 'trial-balance', label: 'งบทดลอง', Icon: IconScale },
    { id: 'profit-and-loss', label: 'งบกำไรขาดทุน', Icon: IconFileSpreadsheet },
    { id: 'balance-sheet', label: 'งบดุล', Icon: IconBuildingBank },
    { id: 'general-ledger', label: 'สมุดบัญชีแยกประเภท', Icon: IconNotebook },
    { id: 'output-vat', label: 'รายงานภาษีขาย (ภ.พ.30)', Icon: IconReceiptTax },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ClientView() {
    const { user, isLoading } = useAuth();
    const canRead = canViewAccounting(user?.role);
    const [activeTab, setActiveTab] = useState<TabId>('trial-balance');

    // Auth session loads post-mount (AuthProvider W1-HYDRATION), so the
    // role is unknown while isLoading — show a loading state instead of
    // flashing the 403 callout at legitimately authorized finance staff.
    if (isLoading) {
        return (
            <ProviderLayout>
                <div className="mx-auto max-w-2xl p-6">
                    <p
                        role="status"
                        aria-live="polite"
                        className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
                    >
                        กำลังตรวจสอบสิทธิ์การเข้าถึง...
                    </p>
                </div>
            </ProviderLayout>
        );
    }

    // Read gate — both finance roles read the same reports (operator 2026-09-11).
    if (!canRead) {
        return (
            <ProviderLayout>
                <div className="mx-auto max-w-2xl p-6">
                    <div className="rounded-lg border border-rose-300 bg-rose-50 p-8 text-center">
                        <h2 className="text-xl font-bold text-rose-900">
                            ไม่มีสิทธิ์เข้าถึง
                        </h2>
                        <p className="mt-3 text-sm text-rose-800">
                            หน้านี้สำหรับเจ้าหน้าที่การเงินเท่านั้น
                        </p>
                    </div>
                </div>
            </ProviderLayout>
        );
    }

    const tabItems: ReadonlyArray<TabItem<TabId>> = TABS.map((tab) => ({
        id: tab.id,
        label: tab.label,
        icon: <tab.Icon size={16} />,
    }));

    return (
        <ProviderLayout>
            <div className="space-y-5 p-4 md:p-6">
                <PageToolbar
                    eyebrow="บัญชี · รายงานการเงิน"
                    title="รายงานบัญชี"
                    subtitle="รายงานบัญชีมาตรฐานสำหรับเจ้าหน้าที่การเงินฝั่งแพลตฟอร์ม งบทดลอง, งบกำไรขาดทุน, งบดุล, สมุดบัญชีแยกประเภท และรายงานภาษีขาย (ภ.พ.30)"
                    actions={[
                        {
                            key: 'back',
                            label: 'กลับไปบัญชีและใบเสร็จ',
                            href: '/provider/accounting',
                            icon: <IconArrowLeft size={16} />,
                            variant: 'ghost',
                        },
                    ]}
                />

                {/* Tabs — desktop */}
                <div className="hidden md:block">
                    <TabNav
                        tabs={tabItems}
                        activeId={activeTab}
                        onChange={setActiveTab}
                        ariaLabel="รายงาน"
                    />
                </div>

                {/* Tabs — mobile (collapsed to select) */}
                <div className="md:hidden print:hidden">
                    <label
                        htmlFor="report-tab-select"
                        className="mb-2 block text-sm font-semibold text-foreground"
                    >
                        เลือกรายงาน
                    </label>
                    <select
                        id="report-tab-select"
                        aria-label="เลือกรายงาน"
                        value={activeTab}
                        onChange={(e) => setActiveTab(e.target.value as TabId)}
                        className="w-full rounded-xl border border-border bg-card px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        {TABS.map((tab) => (
                            <option key={tab.id} value={tab.id}>
                                {tab.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Panel */}
                <div
                    role="tabpanel"
                    id={`panel-${activeTab}`}
                    aria-labelledby={`tab-${activeTab}`}
                >
                    {activeTab === 'trial-balance' ? <TrialBalanceTable /> : null}
                    {activeTab === 'profit-and-loss' ? <ProfitAndLossStatement /> : null}
                    {activeTab === 'balance-sheet' ? <BalanceSheetStatement /> : null}
                    {activeTab === 'general-ledger' ? <GeneralLedgerViewer /> : null}
                    {activeTab === 'output-vat' ? <OutputVatReport /> : null}
                </div>
            </div>

            {/* Print-friendly CSS — hide navigation chrome when printing. */}
            <style jsx global>{`
                @media print {
                    @page {
                        size: A4 portrait;
                        margin: 12mm;
                    }
                    nav,
                    aside,
                    header.sticky,
                    .print\\:hidden {
                        display: none !important;
                    }
                    .print\\:bg-white {
                        background: white !important;
                    }
                    main {
                        padding: 0 !important;
                    }
                    body {
                        color: black !important;
                        background: white !important;
                    }
                }
            `}</style>
        </ProviderLayout>
    );
}
