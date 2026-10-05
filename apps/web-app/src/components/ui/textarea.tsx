import React, { forwardRef } from 'react';
import { Textarea as PrimitiveTextarea } from '@/components/ui/primitives/textarea';
import { FormField } from '@/components/ui/primitives/form-field';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  description?: string;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  size?: string;
  fullWidth?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      error,
      helperText,
      description,
      resize = 'vertical',
      size: _size,
      fullWidth = true,
      id,
      rows = 4,
      required,
      disabled,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const textareaId = id || generatedId;

    const resizeClass = {
      none: 'resize-none',
      vertical: 'resize-y',
      horizontal: 'resize-x',
      both: 'resize',
    }[resize];

    return (
      <FormField
        label={label}
        htmlFor={textareaId}
        required={required}
        description={description}
        helper={helperText}
        error={error}
        disabled={disabled}
        className={cn(fullWidth && 'w-full')}
      >
        <PrimitiveTextarea
          ref={ref}
          id={textareaId}
          rows={rows}
          disabled={disabled}
          className={cn(resizeClass, className)}
          aria-invalid={Boolean(error)}
          {...props}
        />
      </FormField>
    );
  },
);

Textarea.displayName = 'Textarea';

export default Textarea;
