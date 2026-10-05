'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/primitives/input';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { cn } from '@/lib/utils';

interface FilterOption {
  key: string;
  label: string;
  count: number;
}

interface FilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  sortBy: 'newest' | 'oldest';
  onSortByChange: (value: 'newest' | 'oldest') => void;
  activeFilter: string;
  onFilterChange: (value: string) => void;
  options: FilterOption[];
}

export function FilterBar({
  query,
  onQueryChange,
  sortBy,
  onSortByChange,
  activeFilter,
  onFilterChange,
  options,
}: FilterBarProps) {
  return (
    <section className="surface-card p-4 sm:p-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative w-full xl:max-w-3xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="ค้นหาด้วยเลขคำขอ ชื่อฟาร์ม หรือชื่อพืช"
            className="pl-10"
          />
        </div>

        <div className="inline-flex rounded-lg bg-[hsl(var(--field-muted-surface))] p-1">
          <Button
            variant={sortBy === 'newest' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onSortByChange('newest')}
            className="h-11 rounded-lg sm:h-9"
          >
            ใหม่สุด
          </Button>
          <Button
            variant={sortBy === 'oldest' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onSortByChange('oldest')}
            className="h-11 rounded-lg sm:h-9"
          >
            เก่าสุด
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-[hsl(var(--field-muted-surface))] p-2">
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const isActive = activeFilter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => onFilterChange(option.key)}
                className={cn(
                  // 44px on a phone, compact from sm: up. Measured on /health/applications
                  // at 390px: 12 of 33 interactive targets were under Apple's 44x44pt
                  // minimum and these chips were 36px tall
                  // (evidence/apple-qa-audit-2026-09-07).
                  'inline-flex h-11 items-center rounded-lg px-3 text-sm font-semibold transition sm:h-9',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-card text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                {option.label}
                <Badge
                  tone={isActive ? 'neutral' : 'primary'}
                  className={cn('ml-2 border-0 px-2 py-0.5 text-[11px]', isActive ? 'bg-white/20 text-inherit' : 'bg-primary/12 text-primary')}
                >
                  {option.count.toLocaleString('th-TH')}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
