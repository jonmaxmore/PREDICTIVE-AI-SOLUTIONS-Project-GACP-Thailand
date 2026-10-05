'use client';

import { cn } from '@/lib/utils';

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  label?: string;
  description?: string;
  className?: string;
}

export function Switch({ checked, onChange, onCheckedChange, disabled, label, description, className }: SwitchProps) {
  const handleChange = (val: boolean) => { onChange?.(val); onCheckedChange?.(val); };
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2', disabled && 'cursor-not-allowed opacity-50', className)}>
      <div>
        <div className="relative">
          <input
            type="checkbox"
            className="sr-only"
            checked={checked}
            disabled={disabled}
            onChange={(e) => handleChange(e.currentTarget.checked)}
          />
          <div
            className={cn(
              'h-6 w-11 rounded-full transition-colors',
              checked ? 'bg-green-500' : 'bg-slate-200'
            )}
          />
          <div
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform',
              checked ? 'translate-x-5' : 'translate-x-0.5'
            )}
          />
        </div>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {label && <span className="text-sm text-foreground">{label}</span>}
    </label>
  );
}

export default Switch;
