'use client';

/**
 * /health/workspaces/new — create a JURISTIC or COMMUNITY_ENTERPRISE
 * workspace.
 *
 * Wave C PR-4. Minimal surface for the first version: type picker
 * (บริษัท / วิสาหกิจชุมชน) + the small set of fields the backend
 * `applicant-validation.js` requires (taxId + companyName for JURISTIC,
 * communityRegNumber + communityName for COMMUNITY).
 *
 * The full director / president / contact form lands in the wizard
 * step-4 refactor (PR C-5) — at that point this create flow can grow
 * to share `general-step-applicant-sections.tsx`.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Users as UsersIcon, ArrowLeft, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/api-client';
import { useMyEntities } from '@/lib/services/my-entities-provider';
import { SummaryHeader } from '@/components/feature';

type WorkspaceType = 'JURISTIC' | 'COMMUNITY_ENTERPRISE';

interface CreateResponse {
    id: string;
    slug: string | null;
    type: WorkspaceType;
    displayName: string;
}

export default function NewWorkspacePage() {
    const router = useRouter();
    const { refresh } = useMyEntities();

    const [type, setType] = useState<WorkspaceType>('JURISTIC');
    const [companyName, setCompanyName] = useState('');
    const [taxId, setTaxId] = useState('');
    const [communityName, setCommunityName] = useState('');
    const [communityRegNumber, setCommunityRegNumber] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        setError(null);
        if (type === 'JURISTIC' && (!companyName.trim() || !/^0\d{12}$/.test(taxId))) {
            setError('กรอกชื่อบริษัทและเลขทะเบียนนิติบุคคล 13 หลัก (ขึ้นต้นด้วย 0) ให้ครบ');
            return;
        }
        if (type === 'COMMUNITY_ENTERPRISE' && (!communityName.trim() || !/^\d{11}$/.test(communityRegNumber))) {
            setError('กรอกชื่อวิสาหกิจชุมชนและเลขทะเบียน 11 หลัก ให้ครบ');
            return;
        }

        const applicantData =
            type === 'JURISTIC'
                ? { applicantType: 'JURISTIC', companyName: companyName.trim(), taxId: taxId.trim() }
                : { applicantType: 'COMMUNITY', communityName: communityName.trim(), communityRegNumber: communityRegNumber.trim() };

        try {
            setSubmitting(true);
            const res = await apiClient.post<CreateResponse>('/entities', { type, applicantData });
            if (!res.success || !res.data) {
                setError(res.error || 'ไม่สามารถสร้างนิติบุคคลหรือวิสาหกิจชุมชนได้');
                return;
            }
            await refresh();
            // Created from step 1 of a new application (?from=application): go
            // back there with the new entity preselected as the applicant.
            const fromApplication = new URLSearchParams(window.location.search).get('from') === 'application';
            const target = fromApplication
                ? `/health/applications/new?holder=${encodeURIComponent(res.data.id)}`
                : res.data.slug
                    ? `/health/workspaces/${res.data.slug}/members`
                    : '/health/workspaces';
            router.push(target);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการสร้างนิติบุคคลหรือวิสาหกิจชุมชน');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        // Wave E.2-B (batch 7): SummaryHeader replaces inline h1+p.
        // Back link sits above the SummaryHeader. Full-width sweep
        // (2026-06-10): page-level max-w-2xl dropped for PC full-width.
        <div className="w-full space-y-6">
            <Link
                href="/health/workspaces"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="h-4 w-4" />
                กลับ
            </Link>

            <SummaryHeader
                eyebrow="ผู้ขอรับรอง"
                title="สร้างนิติบุคคลหรือวิสาหกิจชุมชนใหม่"
                description="เลือกประเภทที่ตรงกับผู้ที่จะยื่นขอใบอนุญาต"
            />

            <div className="grid gap-3 sm:grid-cols-2">
                <TypeCard
                    active={type === 'JURISTIC'}
                    onClick={() => setType('JURISTIC')}
                    icon={Building2}
                    label="นิติบุคคล"
                    sub="บริษัทจำกัด / ห้างหุ้นส่วน / สหกรณ์"
                />
                <TypeCard
                    active={type === 'COMMUNITY_ENTERPRISE'}
                    onClick={() => setType('COMMUNITY_ENTERPRISE')}
                    icon={UsersIcon}
                    label="วิสาหกิจชุมชน"
                    sub="กลุ่มเกษตรกรจดทะเบียน DOAE"
                />
            </div>

            <div className="space-y-4 rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
                {type === 'JURISTIC' ? (
                    <>
                        <Field label="ชื่อบริษัท / ห้างหุ้นส่วน">
                            <input
                                type="text"
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                className="w-full rounded-lg border border-zinc-200 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/20 dark:border-zinc-700"
                                placeholder="เช่น บริษัท ABC จำกัด"
                            />
                        </Field>
                        <Field label="เลขทะเบียนนิติบุคคล (13 หลัก ขึ้นต้นด้วย 0)">
                            <input
                                type="text"
                                value={taxId}
                                onChange={(e) => setTaxId(e.target.value.replace(/\D/g, '').slice(0, 13))}
                                className="w-full rounded-lg border border-zinc-200 bg-card px-3 py-2 font-mono text-sm text-foreground transition-colors focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/20 dark:border-zinc-700"
                                placeholder="0105561234560"
                                maxLength={13}
                            />
                        </Field>
                    </>
                ) : (
                    <>
                        <Field label="ชื่อวิสาหกิจชุมชน">
                            <input
                                type="text"
                                value={communityName}
                                onChange={(e) => setCommunityName(e.target.value)}
                                className="w-full rounded-lg border border-zinc-200 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/20 dark:border-zinc-700"
                                placeholder="เช่น วิสาหกิจชุมชนสมุนไพรบ้านสวน"
                            />
                        </Field>
                        <Field label="เลขทะเบียน DOAE (11 หลัก)">
                            <input
                                type="text"
                                value={communityRegNumber}
                                onChange={(e) => setCommunityRegNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                                className="w-full rounded-lg border border-zinc-200 bg-card px-3 py-2 font-mono text-sm text-foreground transition-colors focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/20 dark:border-zinc-700"
                                placeholder="12345678901"
                                maxLength={11}
                            />
                        </Field>
                    </>
                )}
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <div className="flex justify-end gap-3">
                <Link
                    href="/health/workspaces"
                    className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/40"
                >
                    ยกเลิก
                </Link>
                <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-leaf-800 disabled:opacity-50"
                >
                    {submitting ? 'กำลังสร้าง…' : 'สร้าง'}
                </button>
            </div>
        </div>
    );
}

interface TypeCardProps {
    active: boolean;
    onClick: () => void;
    icon: React.ComponentType<{ className?: string | undefined }>;
    label: string;
    sub: string;
}

function TypeCard({ active, onClick, icon: Icon, label, sub }: TypeCardProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all duration-200',
                active
                    ? 'border-primary bg-primary/5 dark:border-primary dark:bg-primary/15'
                    : 'border-transparent bg-muted hover:border-border hover:bg-card',
            )}
        >
            <div className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                active
                    ? 'bg-leaf-soft text-leaf-onSoft dark:bg-leaf-800/40 dark:text-leaf'
                    : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800',
            )}>
                <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{label}</p>
                <p className="text-xs leading-snug text-muted-foreground">{sub}</p>
            </div>
        </button>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground">{label}</span>
            {children}
        </label>
    );
}
