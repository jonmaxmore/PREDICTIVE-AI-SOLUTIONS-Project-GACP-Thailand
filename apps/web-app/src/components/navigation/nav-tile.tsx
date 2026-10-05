import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { NavItem } from '@/lib/navigation/nav-config';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/primitives/card';

export interface NavTileProps {
  /** Nav entry to render (from nav-config.ts — key/path/label/icon/chipSource/lock). */
  item: NavItem;
  /** Precomputed chip text, or null to hide the chip (never show "0 รายการ"). */
  chipText: string | null;
  /**
   * Presentation-only lock state. Locking is NOT the security gate — the
   * destination page still enforces its own access rule; this only decides
   * whether the tile renders as a clickable link or an inert, dashed card.
   */
  locked: boolean;
  /**
   * Color accent — 'leaf' (default, farmer /health/home) or 'officer' (teal,
   * provider/admin /provider/home — task-4 tile-home-redesign). Mirrors the
   * ACCENT table in app/auth/_components/login-chooser.tsx: officer swaps
   * leaf-soft/leaf-700 for officer-soft/officer-700 on the icon box, chip,
   * and focus ring. The locked (dashed/muted) state is theme-independent.
   */
  theme?: 'leaf' | 'officer';
}

const TILE_THEME: Record<'leaf' | 'officer', { iconWrap: string; hover: string; ring: string; chip: string }> = {
  leaf: {
    iconWrap: 'bg-leaf-soft text-leaf-onSoft',
    hover: 'hover:bg-mint-soft',
    ring: 'focus-visible:ring-leaf',
    chip: 'bg-leaf-soft text-leaf-onSoft',
  },
  officer: {
    iconWrap: 'bg-officer-soft text-officer-onSoft',
    hover: 'hover:bg-officer-soft',
    ring: 'focus-visible:ring-officer-700',
    chip: 'bg-officer-soft text-officer-onSoft',
  },
};

// Built on the Card primitive (bg-card/shadow-leaf-card, see
// components/ui/primitives/card.tsx) rather than a hand-rolled surface.
// Card itself can't be the clickable element (it's a plain div, not
// polymorphic), so the unlocked tile wraps a Card INSIDE next/link instead
// of applying card tokens straight onto the <a> — same primitive either way.
const TILE_BASE = 'flex h-full gap-4 rounded-lg border p-6 text-left transition-colors';

const ICON_BOX_BASE =
  'flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[13px]';

const CHIP_BASE = 'mt-1 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[12.5px] font-semibold';

export function NavTile({ item, chipText, locked, theme = 'leaf' }: NavTileProps) {
  const Icon = item.icon;
  const themeTokens = TILE_THEME[theme];

  if (locked) {
    return (
      <Card
        aria-disabled="true"
        className={cn(TILE_BASE, 'cursor-not-allowed border-dashed border-border bg-muted/40 shadow-none')}
      >
        <span className={cn(ICON_BOX_BASE, 'bg-muted text-muted-foreground')}>
          <Icon className="h-[26px] w-[26px]" aria-hidden="true" focusable="false" />
        </span>
        <div className="flex flex-col items-start gap-1.5">
          <span className="flex items-center gap-2 text-lg font-bold text-muted-foreground">
            {item.labelTH}
            <Lock className="h-[15px] w-[15px]" aria-hidden="true" focusable="false" />
          </span>
          <span className="text-sm text-muted-foreground">{item.descTH}</span>
          {item.lock?.reasonTH && (
            <span className={cn(CHIP_BASE, 'bg-muted text-muted-foreground')}>{item.lock.reasonTH}</span>
          )}
        </div>
      </Card>
    );
  }

  // chipSource-driven tone: 'unpaid' (money due) reads as a warning; anything
  // else (e.g. 'pendingActions') stays the default theme-accent/informational tone.
  const chipToneClass = item.chipSource === 'unpaid' ? 'bg-amber-50 text-amber-700' : themeTokens.chip;

  return (
    <Link
      href={item.path}
      className={cn(
        'block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        themeTokens.ring,
      )}
    >
      <Card className={cn(TILE_BASE, 'border-border', themeTokens.hover)}>
        <span className={cn(ICON_BOX_BASE, themeTokens.iconWrap)}>
          <Icon className="h-[26px] w-[26px]" aria-hidden="true" focusable="false" />
        </span>
        <div className="flex flex-col items-start gap-1">
          <span className="text-lg font-bold text-foreground">{item.labelTH}</span>
          <span className="text-sm text-muted-foreground">{item.descTH}</span>
          {chipText && <span className={cn(CHIP_BASE, chipToneClass)}>{chipText}</span>}
        </div>
      </Card>
    </Link>
  );
}

export default NavTile;
