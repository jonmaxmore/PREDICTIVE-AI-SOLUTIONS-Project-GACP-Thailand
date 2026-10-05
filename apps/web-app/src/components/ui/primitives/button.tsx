import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// GACP Thailand Design System ui_kit (redesign 2026-06-08): pill buttons,
// fresh `leaf` action green + soft green shadow. The deep forest `primary`
// token stays for text/links/depth elsewhere; `leaf` is the action voice.

// Shared card-like surface for the four bordered variants. Dark side uses the
// theme tokens (border/muted flip via .dark in globals.css), not zinc grays.
const CARD_SURFACE =
  'border border-primary-100 bg-card hover:bg-mint-soft dark:border-border dark:hover:bg-muted';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // W3-B: solid action buttons sit on leaf-700/800 — bare `leaf`
        // (#34b56a) is 2.64:1 under white label text and `leaf-600` 3.57:1,
        // both axe-serious. 700 = 5.0:1, 800 hover = 7.3:1.
        filled: 'bg-leaf-700 text-white shadow-leaf-btn hover:bg-leaf-800',
        primary: 'bg-leaf-700 text-white shadow-leaf-btn hover:bg-leaf-800',
        light: 'bg-leaf-soft text-leaf-onSoft hover:bg-leaf-soft/70',
        subtle: 'bg-transparent text-foreground hover:bg-mint-soft',
        default: `${CARD_SURFACE} text-leaf-700 dark:text-leaf`,
        secondary: `${CARD_SURFACE} text-leaf-700 dark:text-leaf`,
        outline: `${CARD_SURFACE} text-foreground`,
        ghost: 'text-foreground hover:bg-mint-soft',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        gradient: 'bg-leaf-700 text-white shadow-leaf-btn hover:bg-leaf-800',
        dashed: 'border border-dashed border-primary-200 bg-transparent text-foreground hover:bg-mint-soft',
        transparent: 'bg-transparent text-foreground hover:bg-mint-soft',
        white: `${CARD_SURFACE} text-leaf-700 shadow-sm dark:text-leaf`,
      },
      // ═══ ขนาดเป้ากด — ยกทั้งชุด 2026-09-10 ═══
      //
      // operator: "ใช้งานยาก กดไม่ค่อยถูก" · วัดจริงก่อนแก้: ไม่มีขนาดไหนถึง 48px เลย
      // แม้แต่ตัวใหญ่สุด · และขนาดที่ใช้จริงมากที่สุดคือ sm (234 จุด) ซึ่งสูงแค่ 36px
      // ไม่ใช่ md ที่เป็นค่าเริ่มต้น (164 จุด) ⇒ "ปุ่มของแอปนี้" คือ 36px มาตลอด
      //
      // เกณฑ์: 48px ตาม directive · 44px คือพื้น WCAG AA ที่โปรเจกต์นี้เคยใช้อยู่แล้ว
      // ในงาน tap-target รอบก่อน (min-h-[44px] override รายจุด) — ยกที่ primitive
      // แปลว่า override รายจุดเหล่านั้นไม่ต้องมีอีกในของใหม่
      size: {
        sm: 'h-11 px-4',   // 44px — พื้น WCAG AA · ปุ่มรองในแถว
        md: 'h-12 px-5',   // 48px — ค่าเริ่มต้น ตรงตาม directive
        lg: 'h-14 px-6',   // 56px — ปุ่มหลักของหน้า
        icon: 'h-12 w-12', // 48px
        // ── ด้านล่างนี้ **ไม่ใช่เป้ากดหลัก** ──
        // ใช้กับชิป/แท็ก/ปุ่มในตารางหนาแน่นเท่านั้น · ถ้าเป็นสิ่งที่ผู้ใช้ต้องกดให้ถูก
        // ในครั้งเดียว อย่าใช้ขนาดพวกนี้ — ใช้ sm ขึ้นไป
        'compact-xs': 'h-8 px-2 text-xs',
        'compact-sm': 'h-9 px-2.5 text-xs',
        'compact-md': 'h-10 px-3 text-sm',
        xs: 'h-9 px-3 text-xs',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color">,
  Omit<VariantProps<typeof buttonVariants>, "variant" | "size"> {
  variant?: 'filled' | 'primary' | 'light' | 'subtle' | 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'gradient' | 'dashed' | 'transparent' | 'white' | null;
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'compact-xs' | 'compact-sm' | 'compact-md' | 'xs' | null;
  asChild?: boolean;
  color?: string;
  loading?: boolean;
  leftSection?: React.ReactNode;
  rightSection?: React.ReactNode;
  href?: string;
  target?: string;
  rel?: string;
  component?: React.ElementType | string;
  styles?: Record<string, unknown>;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, color: _color, loading, leftSection, rightSection, children, disabled, href, target, rel, component, styles: _styles, ...props }, ref) => {
    // If href provided, render as anchor tag
    if (href) {
      return (
        <a
          href={href}
          target={target}
          rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
          className={cn(buttonVariants({ variant, size, className }), disabled && 'pointer-events-none opacity-50')}
        >
          {leftSection && <span className="mr-1.5 flex-shrink-0">{leftSection}</span>}
          {children}
          {rightSection && <span className="ml-1.5 flex-shrink-0">{rightSection}</span>}
        </a>
      );
    }
    // When asChild, clone the single child element and merge button styling
    if (asChild) {
      const child = React.Children.only(children as React.ReactElement);
      return React.cloneElement(child as React.ReactElement, {
        className: cn(buttonVariants({ variant, size }), (child as React.ReactElement).props?.className, className),
        ref,
        ...(disabled || loading ? { 'aria-disabled': true } : {}),
        ...props,
      });
    }
    const Component = (component ?? 'button') as React.ElementType;
    return (
      <Component
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="-ml-1 mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {leftSection && <span className="mr-1.5 flex-shrink-0">{leftSection}</span>}
        {children}
        {rightSection && <span className="ml-1.5 flex-shrink-0">{rightSection}</span>}
      </Component>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
