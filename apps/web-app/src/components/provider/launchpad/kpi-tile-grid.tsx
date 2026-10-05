import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * KpiTileGrid — responsive grid wrapper for `KpiTile`s (B1).
 *
 * Dense launchpad rhythm: 2 columns on mobile, 3 on md, 4 on xl. Pure
 * layout — accepts the tiles as children.
 */
export interface KpiTileGridProps {
  children: React.ReactNode;
  className?: string;
}

export function KpiTileGrid({ children, className }: KpiTileGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4', className)}>{children}</div>
  );
}
