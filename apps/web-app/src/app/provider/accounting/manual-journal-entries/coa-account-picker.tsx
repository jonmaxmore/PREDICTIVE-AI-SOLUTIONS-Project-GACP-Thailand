'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AccountingService,
    FALLBACK_CHART_OF_ACCOUNTS,
    type AccountSummary,
} from '@/lib/services/accounting-service';
import { cn } from '@/lib/utils';

/**
 * Chart-of-Accounts picker — combobox over the canonical chart of
 * accounts used by Manual Journal Entry line rows. R1-C, 2026-05-17.
 *
 * Behaviour:
 *   - Fetches the canonical CoA via AccountingService.getChartOfAccounts()
 *     on first mount (cached at the module level so reopening modals is
 *     instant). Falls back to FALLBACK_CHART_OF_ACCOUNTS on error.
 *   - Renders a text input that filters the dropdown live (matching
 *     either accountCode or accountNameTh, case-insensitive).
 *   - Selecting a row stamps the canonical 4-digit code into the input
 *     and fires `onChange({ accountCode, accountName })`.
 *   - Free text that doesn't match an account is allowed; the parent
 *     keeps it and the backend `UNKNOWN_ACCOUNT_CODE` validator catches
 *     typos with a Thai error message.
 *
 * The picker is intentionally read-only — no editing of the CoA from
 * here. R1-C boundary forbids touching accounting-service.ts.
 */

let cachedAccounts: AccountSummary[] | null = null;
let cachePromise: Promise<AccountSummary[]> | null = null;

async function loadAccounts(): Promise<AccountSummary[]> {
    if (cachedAccounts) return cachedAccounts;
    if (!cachePromise) {
        cachePromise = AccountingService.getChartOfAccounts()
            .then((rows) => {
                cachedAccounts = rows && rows.length > 0 ? rows : FALLBACK_CHART_OF_ACCOUNTS;
                return cachedAccounts;
            })
            .catch(() => {
                cachedAccounts = FALLBACK_CHART_OF_ACCOUNTS;
                return cachedAccounts;
            });
    }
    return cachePromise;
}

export interface CoaAccountPickerProps {
    /** Currently selected accountCode, or empty string for unset. */
    value: string;
    /** Called when the user picks an account from the dropdown. */
    onChange: (next: { accountCode: string; accountName: string }) => void;
    /** Optional id attribute (paired with an external <label>). */
    id?: string;
    /** Disable the input — used while submitting. */
    disabled?: boolean;
    /** Visual hint for invalid selections. */
    invalid?: boolean;
    /** Custom placeholder. */
    placeholder?: string;
    className?: string;
}

export function CoaAccountPicker({
    value,
    onChange,
    id,
    disabled = false,
    invalid = false,
    placeholder = 'พิมพ์รหัสบัญชี หรือชื่อบัญชี',
    className,
}: CoaAccountPickerProps) {
    const [accounts, setAccounts] = useState<AccountSummary[]>(
        () => cachedAccounts ?? FALLBACK_CHART_OF_ACCOUNTS,
    );
    const [query, setQuery] = useState<string>('');
    const [open, setOpen] = useState<boolean>(false);
    const [highlighted, setHighlighted] = useState<number>(0);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Load canonical CoA from the backend once per session. Cache the
    // result module-side so reopening this picker (e.g., adding a new
    // row to the draft) doesn't re-fetch.
    useEffect(() => {
        let cancelled = false;
        loadAccounts().then((rows) => {
            if (!cancelled) {
                setAccounts(rows);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Sync the display query when an external value change occurs (e.g.,
    // parent reset). When the value matches a known account, show
    // "{code} — {nameTh}"; otherwise show the raw code.
    useEffect(() => {
        if (!value) {
            setQuery('');
            return;
        }
        const found = accounts.find((a) => a.accountCode === value);
        setQuery(found ? `${found.accountCode} — ${found.accountNameTh}` : value);
    }, [value, accounts]);

    // Close the dropdown when the user clicks outside.
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return accounts;
        return accounts.filter((a) => {
            return (
                a.accountCode.toLowerCase().includes(q)
                || a.accountNameTh.toLowerCase().includes(q)
                || (a.accountNameEn?.toLowerCase().includes(q) ?? false)
            );
        });
    }, [query, accounts]);

    const handleSelect = (acc: AccountSummary) => {
        onChange({ accountCode: acc.accountCode, accountName: acc.accountNameTh });
        setQuery(`${acc.accountCode} — ${acc.accountNameTh}`);
        setOpen(false);
        setHighlighted(0);
    };

    const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            setOpen(true);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const acc = filtered[highlighted];
            if (acc) handleSelect(acc);
        } else if (e.key === 'Tab') {
            setOpen(false);
        }
    };

    return (
        <div ref={wrapperRef} className={cn('relative', className)}>
            <input
                id={id}
                type="text"
                value={query}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                    setHighlighted(0);
                    // If the typed value is exactly an existing accountCode,
                    // sync upward immediately so the row reflects it without
                    // requiring a click.
                    const exact = accounts.find((a) => a.accountCode === e.target.value.trim());
                    if (exact) {
                        onChange({
                            accountCode: exact.accountCode,
                            accountName: exact.accountNameTh,
                        });
                    } else {
                        // Pass raw input upward so the parent can show
                        // UNKNOWN_ACCOUNT_CODE on submit if needed.
                        onChange({
                            accountCode: e.target.value.trim(),
                            accountName: '',
                        });
                    }
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={handleKey}
                aria-autocomplete="list"
                aria-controls={id ? `${id}-listbox` : undefined}
                aria-expanded={open}
                aria-invalid={invalid}
                role="combobox"
                className={cn(
                    'h-10 w-full rounded-lg border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
                    invalid
                        ? 'border-rose-400 focus:ring-rose-300'
                        : 'border-border',
                    disabled && 'cursor-not-allowed bg-muted text-muted-foreground',
                )}
            />
            {open && filtered.length > 0 ? (
                // X6-B: the <ul role="listbox"> + <li role="option"> pair is the
                // canonical WAI-ARIA combobox-with-listbox contract (APG §3.6).
                // The combobox input above owns the keyboard model (ArrowUp/Down/Enter
                // via handleKey) and references this listbox via aria-controls,
                // so role="listbox" is REQUIRED on <ul> and role="option" is
                // REQUIRED on every <li>. We deliberately keep the native list
                // elements (semantic structure for crawlers + fall-back styling)
                // rather than dropping to <div>s — hence the targeted disable.
                <ul
                    id={id ? `${id}-listbox` : undefined}
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- reason: WAI-ARIA combobox listbox per APG §3.6 (input above is the interactive control).
                    role="listbox"
                    className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
                >
                    {filtered.map((acc, idx) => (
                        <li
                            key={acc.accountCode}
                            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- reason: WAI-ARIA combobox option per APG §3.6 (parent listbox + sibling combobox input own keyboard interaction).
                            role="option"
                            aria-selected={idx === highlighted}
                            onMouseDown={(e) => {
                                // Prevent the blur from firing before the click.
                                e.preventDefault();
                                handleSelect(acc);
                            }}
                            onMouseEnter={() => setHighlighted(idx)}
                            className={cn(
                                'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm',
                                idx === highlighted ? 'bg-muted' : 'hover:bg-muted',
                            )}
                        >
                            <span className="font-mono text-xs font-semibold text-foreground">
                                {acc.accountCode}
                            </span>
                            <span className="flex-1 truncate text-foreground">
                                {acc.accountNameTh}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {acc.category}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
            {open && filtered.length === 0 ? (
                <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground shadow-lg">
                    ไม่พบรหัสบัญชีที่ตรงกับคำค้น
                </div>
            ) : null}
        </div>
    );
}

export default CoaAccountPicker;
