import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// GACP Thailand Design System ui_kit (redesign 2026-06-08): pill status chips.
const badgeVariants = cva('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground',
      success: 'bg-leaf-soft text-leaf-onSoft',
      warning: 'bg-amber-50 text-amber-700',
      info: 'bg-sky-50 text-sky-700',
      danger: 'bg-red-50 text-red-700',
      primary: 'bg-primary/10 text-primary',
    },
  },
  defaultVariants: {
    tone: 'neutral',
  },
});

type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

// Maps Mantine color names to tone variants
const colorToTone: Record<string, BadgeTone> = {
  green: 'success', teal: 'success', emerald: 'success',
  red: 'danger', pink: 'danger',
  yellow: 'warning', orange: 'warning', amber: 'warning',
  blue: 'info', cyan: 'info', indigo: 'info',
  gray: 'neutral', dark: 'neutral',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  color?: string;
  variant?: string;
  size?: string;
  leftSection?: React.ReactNode;
  circle?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ className, tone, color, variant: _variant, size: _size, leftSection: _ls, circle: _circle, ...props }, ref) => {
  const resolvedTone = tone ?? (color ? colorToTone[color] : undefined);
  return <span ref={ref} className={cn(badgeVariants({ tone: resolvedTone }), className)} {...props} />;
});
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
