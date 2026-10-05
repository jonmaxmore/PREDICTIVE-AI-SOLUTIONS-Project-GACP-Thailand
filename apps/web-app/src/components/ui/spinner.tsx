import React from 'react';
import { cn } from '@/lib/utils';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: SpinnerSize | number;
  color?: 'primary' | 'white' | 'gray' | string;
  type?: string;
  /**
   * X1-FIX-D / M-15 — Optional screen-reader label. Defaults to the Thai
   * "กำลังโหลด..." (Loading...). Callers can override with a context-specific
   * message (e.g. "กำลังบันทึก..." while submitting a form).
   */
  label?: string;
}

/**
 * X1-FIX-D / M-15 — Spinner now announces loading state to assistive
 * tech via `role="status"` + `aria-live="polite"` + an `sr-only`
 * label. Prior to this fix the spinner was a purely visual cue and
 * screen readers said nothing while requests were in flight.
 * WCAG 4.1.2 Name, Role, Value (AA).
 */
export const Spinner: React.FC<SpinnerProps> = ({
  className,
  size = 'md',
  color = 'primary',
  type: _type,
  label = 'กำลังโหลด...',
  ...props
}) => {
  const sizeClasses: Record<SpinnerSize, string> = {
    xs: 'w-3 h-3 border-2',
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3',
    xl: 'w-12 h-12 border-4',
  };

  const knownColorClasses: Record<string, string> = {
    primary: 'border-primary-500 border-t-transparent',
    white: 'border-white border-t-transparent',
    gray: 'border-gray-400 border-t-transparent',
    green: 'border-green-500 border-t-transparent',
    teal: 'border-teal-500 border-t-transparent',
    blue: 'border-blue-500 border-t-transparent',
  };

  const colorClass = knownColorClasses[color] ?? 'border-primary border-t-transparent';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'animate-spin rounded-full',
        sizeClasses[size as SpinnerSize] ?? sizeClasses.md,
        colorClass,
        className
      )}
      {...props}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
};

export default Spinner;
