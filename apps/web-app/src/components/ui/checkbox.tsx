import React, { forwardRef } from 'react';
import { Checkbox as PrimitiveCheckbox } from '@/components/ui/primitives/checkbox';
import { FormField } from '@/components/ui/primitives/form-field';
import { cn } from '@/lib/utils';

export interface CheckboxProps {
  id?: string | undefined;
  className?: string | undefined;
  label?: React.ReactNode;
  error?: string | undefined;
  helperText?: string | undefined;
  description?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  value?: string | undefined;
  name?: string | undefined;
  onCheckedChange?: (checked: boolean) => void;
  color?: string | undefined;
  size?: string | undefined;
  indeterminate?: boolean | undefined;
  styles?: Record<string, unknown> | undefined;
  style?: React.CSSProperties | undefined;
  onChange?: (e: unknown) => void;
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, label, error, helperText, description, id, required, disabled, checked, defaultChecked, value, name, onCheckedChange, color: _color, size: _size, indeterminate: _ind, styles: _styles, style, onChange: _onChange }, ref) => {
    const generatedId = React.useId();
    const checkboxId = id || generatedId;

    return (
      <FormField
        description={description}
        helper={helperText}
        error={error}
        disabled={disabled}
        className={className}
      >
        <label htmlFor={checkboxId} className={cn('inline-flex min-h-11 items-start gap-3 text-sm text-foreground', disabled && 'cursor-not-allowed')}>
          <PrimitiveCheckbox
            ref={ref as React.Ref<HTMLButtonElement>}
            id={checkboxId}
            {...(disabled !== undefined ? { disabled } : {})}
            {...(required !== undefined ? { required } : {})}
            {...(checked !== undefined ? { checked } : {})}
            {...(defaultChecked !== undefined ? { defaultChecked } : {})}
            {...(value !== undefined ? { value } : {})}
            {...(name !== undefined ? { name } : {})}
            {...(style !== undefined ? { style } : {})}
            onCheckedChange={(ch) => onCheckedChange?.(ch === true)}
            className="mt-1 h-5 w-5 rounded-md"
          />
          {label ? (
            <span className="leading-6">
              <span className="font-medium">{label}</span>
              {required ? <span className="ml-1 text-destructive">*</span> : null}
            </span>
          ) : null}
        </label>
      </FormField>
    );
  },
);

Checkbox.displayName = 'Checkbox';

export default Checkbox;
