import * as React from 'react';
import { cn } from '@/lib/utils';

// GACP Thailand Design System ui_kit (redesign 2026-06-08): soft, generously
// rounded cards (22px) with a green-tinted resting shadow.
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-[1.375rem] bg-card text-card-foreground shadow-leaf-card',
      className,
    )}
    {...props}
  />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col space-y-1.5 p-5 sm:p-6', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';

// X6-B: jsx-a11y/heading-has-content required us to guarantee non-empty heading
// content. If a consumer renders `<CardTitle />` with no children, fall back to
// rendering nothing — empty headings are an SR-Reader anti-pattern (they
// announce as "heading level 3" with no text). All ~150 existing callsites
// pass children, so this is a defensive guard only.
const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => {
    if (children === undefined || children === null || children === false || children === '') {
      return null;
    }
    return (
      <h3
        ref={ref}
        className={cn('text-base font-semibold leading-tight tracking-tight text-foreground', className)}
        {...props}
      >
        {children}
      </h3>
    );
  },
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };

