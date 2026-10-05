'use client';

/**
 * EntitySwitcher — Wave C PR-3
 *
 * Workspace dropdown that lives in the dashboard header. Mirrors the
 * Google Ads / Stripe / Notion / Linear pattern: a pill on the left of
 * the user avatar showing the currently-active entity, expanding into
 * a list of all workspaces the user is a member of.
 *
 * Single-membership users (the common case for individual farmers) see
 * a non-interactive pill. The "+ สร้าง workspace ใหม่" CTA is reachable
 * via the dropdown but not the only thing in there — discoverability
 * matters even for single-entity users.
 *
 * Read state from useActiveEntity() (apps/web-app/src/lib/services/active-entity-provider.tsx);
 * switching writes localStorage + posts /api/entities/me/switch for the
 * audit trail.
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Building2, ChevronDown, User as UserIcon, Users, Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActiveEntity, EntityMembership } from '@/lib/services/active-entity-provider';

/** Wave C PR-6 — paths where switching workspace would invalidate
 *  the user's in-progress work. Triggers a confirmation modal. */
const GUARDED_PATH_PREFIXES = ['/health/applications/new'];

const ROLE_BADGE_CLASS: Record<EntityMembership['role'], string> = {
    OWNER:   'bg-leaf-soft text-leaf-onSoft dark:bg-primary-900/40 dark:text-primary-300',
    ADMIN:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    MANAGER: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    VIEWER:  'bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300',
};

const ROLE_LABEL_TH: Record<EntityMembership['role'], string> = {
    OWNER:   'เจ้าของ',
    ADMIN:   'ผู้ดูแล',
    MANAGER: 'ผู้จัดการ',
    VIEWER:  'ผู้ดู',
};

const TYPE_LABEL_TH: Record<EntityMembership['type'], string> = {
    INDIVIDUAL:           'บุคคลธรรมดา',
    JURISTIC:             'นิติบุคคล',
    COMMUNITY_ENTERPRISE: 'วิสาหกิจชุมชน',
};

function TypeIcon({ type, className }: { type: EntityMembership['type']; className?: string }) {
    if (type === 'INDIVIDUAL') return <UserIcon className={className} />;
    if (type === 'JURISTIC') return <Building2 className={className} />;
    return <Users className={className} />;
}

interface EntitySwitcherProps {
    /** Hide entirely on provider role (providers scope by Application). */
    hidden?: boolean;
}

export function EntitySwitcher({ hidden = false }: EntitySwitcherProps) {
    const { entities, activeEntity, isLoading, setActiveEntity, refresh } = useActiveEntity();
    const [open, setOpen] = useState(false);
    const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
    const router = useRouter();
    const pathname = usePathname();
    const ref = useRef<HTMLDivElement | null>(null);

    // Close on outside click.
    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [open]);

    // a11y — close popover and modal on Escape (WCAG 2.1 KB / 2.4.3).
    useEffect(() => {
        if (!open && !pendingSwitchId) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (pendingSwitchId) setPendingSwitchId(null);
                else if (open) setOpen(false);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, pendingSwitchId]);

    if (hidden) return null;
    // Decouple "loading" from "loaded but no active workspace" so the pill can
    // never show "loading" forever after the fetch resolves (the provider now
    // falls back to the first ACTIVE membership, so this empty state only means
    // the user genuinely has no ACTIVE workspace).
    if (isLoading) {
        return (
            <div className="flex h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-xs text-white/60">
                <Building2 className="h-3.5 w-3.5" />
                กำลังโหลด…
            </div>
        );
    }
    if (!activeEntity) {
        // design-cleanup-2026-08-21 U4 — every health user has exactly one
        // personal INDIVIDUAL entity by design (Phase-68 invariant, self-
        // healed at register), so landing here after loading finishes always
        // means either the `/entities/mine` fetch failed, or every
        // membership came back non-ACTIVE — never a legitimate "you truly
        // have no workspace" state. Claiming that ("ไม่มีพื้นที่ใช้งาน") was
        // dishonest and gave the user nothing to do about it. State the real
        // cause and offer retry instead (thai-ui-copy rule: errors name
        // cause + next action). general-step.tsx (the wizard's applicant-
        // type step) mirrors this exact copy — one truth, two surfaces.
        return (
            <div className="flex h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-xs text-white/60">
                <Building2 className="h-3.5 w-3.5" />
                โหลดพื้นที่ทำงานไม่สำเร็จ
                <button
                    type="button"
                    data-testid="entity-switcher-retry"
                    onClick={() => { void refresh(); }}
                    className="font-semibold text-white underline underline-offset-2 hover:text-white/80"
                >
                    ลองใหม่
                </button>
            </div>
        );
    }

    const isMulti = entities.length > 1;
    const isGuardedPath = GUARDED_PATH_PREFIXES.some((p) => pathname?.startsWith(p));

    const performSwitch = async (entityId: string) => {
        setOpen(false);
        await setActiveEntity(entityId);
        router.refresh();
    };

    const onSwitch = async (entityId: string) => {
        if (entityId === activeEntity.id) { setOpen(false); return; }
        // Wave C PR-6 — path-aware guard. Switching while inside the
        // application wizard would orphan the in-progress draft on the
        // old entity. Force an explicit "discard and switch" choice.
        if (isGuardedPath) {
            setOpen(false);
            setPendingSwitchId(entityId);
            return;
        }
        await performSwitch(entityId);
    };

    const cancelPending = () => setPendingSwitchId(null);
    const confirmPending = async () => {
        const target = pendingSwitchId;
        setPendingSwitchId(null);
        if (target) await performSwitch(target);
    };

    const pendingTarget = pendingSwitchId
        ? entities.find((e) => e.id === pendingSwitchId) || null
        : null;

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => isMulti && setOpen((v) => !v)}
                disabled={!isMulti}
                className={cn(
                    // 44px on a phone (Apple HIG minimum), compact from sm: up. This pill is a real
                    // menu trigger whenever the user has more than one workspace.
                    'flex h-11 items-center gap-2 rounded-full px-3 text-xs font-medium text-white transition-colors sm:h-9',
                    isMulti
                        ? 'cursor-pointer bg-white/15 hover:bg-white/25'
                        : 'cursor-default bg-white/10',
                )}
                aria-haspopup={isMulti ? 'menu' : undefined}
                aria-expanded={isMulti ? open : undefined}
                title={`${TYPE_LABEL_TH[activeEntity.type]}: ${activeEntity.displayName}`}
                // design-cleanup-2026-08-21 U3 — the visible pill used to show
                // ONLY the entity display name, right next to the user's own
                // name in the avatar dropdown, with nothing telling the user
                // which one is "the workspace you're submitting as" (that
                // context lived in `title=`, hover-only, invisible on touch).
                // aria-label always carries the explicit "ยื่นในนาม" framing
                // regardless of viewport truncation; isMulti additionally
                // marks this as a switcher, not just a label.
                aria-label={
                    isMulti
                        ? `ยื่นในนาม ${activeEntity.displayName} กดเพื่อสลับ workspace`
                        : `ยื่นในนาม ${activeEntity.displayName}`
                }
            >
                <TypeIcon type={activeEntity.type} className="h-3.5 w-3.5 shrink-0 text-white/80" />
                <span className="hidden shrink-0 text-[10px] font-medium text-white/60 sm:inline">
                    ยื่นในนาม
                </span>
                <span className="max-w-[12ch] truncate sm:max-w-[18ch]">
                    {activeEntity.displayName}
                </span>
                <span className={cn(
                    'hidden rounded-md px-2 py-0.5 text-[11px] font-semibold sm:inline-block',
                    ROLE_BADGE_CLASS[activeEntity.role],
                )}>
                    {ROLE_LABEL_TH[activeEntity.role]}
                </span>
                {isMulti && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/60" />}
            </button>

            {/* Dropdown — entity list + create CTA */}
            {open && isMulti && (
                <div
                    role="menu"
                    className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-card shadow-xl dark:border-zinc-700"
                >
                    <div className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                        Workspace ของคุณ
                    </div>
                    <ul className="max-h-72 overflow-y-auto">
                        {entities.map((e) => {
                            const isActive = e.id === activeEntity.id;
                            return (
                                <li key={e.id}>
                                    <button
                                        type="button"
                                        onClick={() => onSwitch(e.id)}
                                        className={cn(
                                            'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                                            isActive
                                                ? 'bg-leaf-soft dark:bg-primary-900/20'
                                                : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40',
                                        )}
                                    >
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                            <TypeIcon type={e.type} className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-semibold text-foreground">
                                                {e.displayName}
                                            </p>
                                            <p className="truncate text-xs text-muted-foreground">
                                                {TYPE_LABEL_TH[e.type]}
                                            </p>
                                        </div>
                                        <span className={cn(
                                            'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold',
                                            ROLE_BADGE_CLASS[e.role],
                                        )}>
                                            {ROLE_LABEL_TH[e.role]}
                                        </span>
                                        {isActive && <Check className="h-4 w-4 shrink-0 text-leaf-700" />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {/* Task 7 (tile-home-nav, N2 "ตัดแถวลิงก์เมนูบนหัวออกทั้งหมด"):
                        the "+ สร้าง workspace ใหม่" navigation Link that lived here
                        is removed — it was a menu link in the slim bar, which N2
                        reserves for entity SWITCHING only. The entity list above
                        (plain <button>s, not <Link>s) is unaffected — it changes
                        context, it doesn't navigate. The create flow is still
                        reachable from the "ทีมงาน" tile → /health/workspaces →
                        its own "+ new" button (page untouched). */}
                </div>
            )}

            {/* Wave C PR-6 — discard-and-switch confirmation modal. Fires
                only when the user is on a guarded path (the application
                wizard) and has just clicked a different workspace.
                X6-B: W5-C `<button>` backdrop + `<div role="dialog">` split
                gives a real interactive backdrop with keyboard activation
                (Space/Enter close) and zero non-interactive-element-with-click
                warnings. Mirrors X5-FIX-B H-9 pattern. */}
            {pendingTarget && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
                    <button
                        type="button"
                        aria-label="ปิดหน้าต่าง"
                        className="absolute inset-0 cursor-default bg-black/60"
                        onClick={cancelPending}
                    />
                    <div
                        className="relative w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="entity-switch-title"
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                <AlertTriangle className="h-5 w-5" aria-hidden="true" focusable="false" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h2 id="entity-switch-title" className="text-base font-bold text-foreground">เปลี่ยน workspace?</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    คุณกำลังกรอกใบสมัครในนาม
                                    {' '}<strong className="text-foreground">{activeEntity.displayName}</strong>{' '}
                                    การเปลี่ยน workspace ไปยัง
                                    {' '}<strong className="text-foreground">{pendingTarget.displayName}</strong>{' '}
                                    จะทำให้ใบสมัครฉบับร่างนี้อาจไม่ถูกบันทึก
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    ต้องการดำเนินการต่อหรือไม่?
                                </p>
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={cancelPending}
                                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/40"
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="button"
                                onClick={confirmPending}
                                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
                            >
                                เปลี่ยน workspace ต่อไป
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
