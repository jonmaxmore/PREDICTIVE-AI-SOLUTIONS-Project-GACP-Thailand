import React, { forwardRef } from 'react';
import { Input as PrimitiveInput } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/primitives/form-field';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string | undefined;
  error?: string | undefined;
  helperText?: string | undefined;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  description?: string | undefined;
  fullWidth?: boolean | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      helperText,
      description,
      leftIcon,
      rightIcon,
      fullWidth = true,
      id,
      required,
      disabled,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;

    return (
      <FormField
        label={label}
        htmlFor={inputId}
        required={required}
        description={description}
        helper={helperText}
        error={error}
        disabled={disabled}
        className={cn(fullWidth && 'w-full')}
      >
        <div className="relative">
          {leftIcon ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{leftIcon}</span> : null}
          <PrimitiveInput
            ref={ref}
            id={inputId}
            disabled={disabled}
            className={cn(leftIcon && 'pl-10', rightIcon && 'pr-10', className)}
            aria-invalid={Boolean(error)}
            {...props}
          />
          {rightIcon ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{rightIcon}</span> : null}
        </div>
      </FormField>
    );
  },
);

Input.displayName = 'Input';

export default Input;
