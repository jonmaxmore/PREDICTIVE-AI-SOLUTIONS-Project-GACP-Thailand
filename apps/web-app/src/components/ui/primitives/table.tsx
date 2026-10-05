import * as React from 'react';
import { cn } from '@/lib/utils';

const TableRoot = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
  ),
);
TableRoot.displayName = 'Table';

const TableScrollContainer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('w-full overflow-auto rounded-2xl border border-border bg-card', className)} {...props} />
  ),
);
TableScrollContainer.displayName = 'TableScrollContainer';

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('bg-[hsl(var(--primary))] text-primary-foreground', className)} {...props} />
  ),
);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  ),
);
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn('border-t border-border bg-muted/45 font-medium', className)} {...props} />
  ),
);
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/35 data-[state=selected]:bg-accent/50',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, scope = 'col', ...props }, ref) => (
    // X4-FIX-B (X4-C primitive a11y win): default scope="col" so every
    // caller (Mantine-port Table.Th + finance DataTable + main
    // accounting dashboard table + every HEALTH consumer) gets the
    // explicit scope for free. Callers can still override via the
    // `scope` prop when they need scope="row" or scope="rowgroup".
    <th
      ref={ref}
      scope={scope}
      className={cn('h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-[0.08em]', className)}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('px-4 py-3 align-middle text-sm text-foreground', className)} {...props} />
  ),
);
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  ),
);
TableCaption.displayName = 'TableCaption';

export const Table = Object.assign(TableRoot, {
  ScrollContainer: TableScrollContainer,
  Header: TableHeader,
  Body: TableBody,
  Footer: TableFooter,
  Row: TableRow,
  Head: TableHead,
  Cell: TableCell,
  Caption: TableCaption,
  // Mantine compound aliases
  Thead: TableHeader,
  Tbody: TableBody,
  Tr: TableRow,
  Th: TableHead,
  Td: TableCell,
});

// Named exports for direct usage
export { TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption, TableScrollContainer };
