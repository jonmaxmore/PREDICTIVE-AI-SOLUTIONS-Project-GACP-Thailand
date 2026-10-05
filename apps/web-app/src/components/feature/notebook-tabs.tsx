'use client';

/**
 * NotebookTabs — Wave E.2-E.
 *
 * Form-style tabs for grouping sections of a single record (general info,
 * documents, audit log, etc.) — distinct from the existing pill-style
 * `Tabs` primitive which fits filter-style use cases (Pending / Approved
 * / Rejected views over the same data).
 *
 * Visual: tabs sit on top of a content panel. The active tab has an
 * underline that matches the panel's top edge, suggesting the tab and
 * the panel are one continuous surface — exactly the "notebook tab"
 * metaphor. Inactive tabs are muted; hover lights them up.
 *
 * Why a separate component instead of variants on `Tabs`:
 * - Different visual language → caller intent should be obvious from
 *   the import (NotebookTabs vs Tabs).
 * - Different default content padding (notebook tabs render content
 *   inside their own panel; pill Tabs rely on caller chrome).
 * - Forking now keeps PR-1 clean; if a third style appears later we
 *   can refactor with a `variant` prop on a unified component.
 *
 * Built on `@radix-ui/react-tabs` (already a project dep via the pill
 * Tabs component), so behaviour, focus management, ARIA, keyboard
 * navigation, and controlled/uncontrolled modes match the rest of the
 * design system.
 */
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const NotebookTabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Root
    ref={ref}
    className={cn('flex flex-col', className)}
    {...props}
  />
));
NotebookTabs.displayName = 'NotebookTabs';

/**
 * The strip of tab triggers along the top. Sits above a horizontal
 * border that visually fuses with the active trigger's underline.
 */
const NotebookTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Single bottom border that the active trigger overlaps.
      'flex w-full items-end gap-1 overflow-x-auto border-b border-border',
      className,
    )}
    {...props}
  />
));
NotebookTabsList.displayName = 'NotebookTabsList';

const NotebookTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Base — muted text, no underline.
      'inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors',
      // Hover for inactive — lights up.
      'hover:text-foreground',
      // Bottom border base — transparent so we can swap to primary on active
      // without layout shift.
      '-mb-px border-b-2 border-transparent',
      // Active — primary text + primary underline that overlaps the
      // list's bottom border (creating the "tab merges into panel" look).
      'data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-foreground',
      // Focus ring for keyboard a11y.
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
));
NotebookTabsTrigger.displayName = 'NotebookTabsTrigger';

const NotebookTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      // Top spacing so content doesn't kiss the border line.
      'pt-4',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
));
NotebookTabsContent.displayName = 'NotebookTabsContent';

export { NotebookTabs, NotebookTabsList, NotebookTabsTrigger, NotebookTabsContent };
