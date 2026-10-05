import * as React from 'react';
import { Label } from '@/components/ui/primitives/label';
import { cn } from '@/lib/utils';

export interface FormFieldProps {
  label?: React.ReactNode;
  htmlFor?: string | undefined;
  required?: boolean | undefined;
  description?: React.ReactNode;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  disabled?: boolean | undefined;
  className?: string | undefined;
  labelClassName?: string | undefined;
  children: React.ReactNode;
}

export function FormField({
  label,
  htmlFor,
  required,
  description,
  helper,
  error,
  disabled,
  className,
  labelClassName,
  children,
}: FormFieldProps) {
  return (
    <div className={cn('field-block', disabled && 'field-disabled', className)}>
      {label ? (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={htmlFor} className={cn('field-label', labelClassName)}>
            {label}
          </Label>
          {required ? <span className="field-required">จำเป็น</span> : <span className="field-optional">ไม่บังคับ</span>}
        </div>
      ) : null}

      {description ? <p className="field-help">{description}</p> : null}

      {children}

      {helper ? <p className="field-help">{helper}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
