'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const _Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn('z-50 overflow-hidden rounded-xl bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-card', className)}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;



// Mantine-compatible Tooltip that accepts label prop
interface CompatTooltipProps {
  label?: React.ReactNode;
  children: React.ReactNode;
  position?: string;
  withArrow?: boolean;
  disabled?: boolean;
  [key: string]: unknown;
}
const CompatTooltip: React.FC<CompatTooltipProps> = ({ label, children, position: _p, withArrow: _w, disabled, ...props }) => {
  if (!label || disabled) return <>{children}</>;
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root>
        <TooltipTrigger asChild><span style={{ display: 'contents' }}>{children}</span></TooltipTrigger>
        <TooltipContent {...props}>{label}</TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  );
};
CompatTooltip.displayName = 'Tooltip';

export { CompatTooltip as Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
