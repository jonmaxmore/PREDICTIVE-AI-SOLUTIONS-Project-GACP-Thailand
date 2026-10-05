import React, { forwardRef } from 'react';
import {
  Select as PrimitiveSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select';
import { FormField } from '@/components/ui/primitives/form-field';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  id?: string | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  label?: string | undefined;
  error?: string | undefined;
  helperText?: string | undefined;
  description?: string | undefined;
  options?: SelectOption[] | undefined;
  data?: (SelectOption | string)[] | undefined;  // Mantine compat alias
  placeholder?: string | undefined;
  fullWidth?: boolean | undefined;
  value?: string | null | undefined;
  defaultValue?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  onValueChange?: (value: string) => void;
  onChange?: (value: string) => void;
  icon?: React.ReactNode;
  leftSection?: React.ReactNode;
  allowDeselect?: boolean | undefined;
  size?: string | undefined;
  w?: unknown;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className,
      label,
      error,
      helperText,
      description,
      options,
      data,
      icon: _icon,
      leftSection: _ls,
      allowDeselect: _ad,
      size: _size,
      w: _w,
      style: _style,
      placeholder = 'เลือกตัวเลือก',
      fullWidth = true,
      id,
      value,
      defaultValue,
      required,
      disabled,
      onValueChange,
      onChange,
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const selectId = id || generatedId;
    // Support Mantine's `data` prop as alias for `options`
    const resolvedOptions: SelectOption[] = options ?? (data ?? []).map((item) =>
      typeof item === 'string' ? { value: item, label: item } : item
    );

    const handleValueChange = (nextValue: string) => {
      onValueChange?.(nextValue);
      onChange?.(nextValue);
    };

    return (
      <FormField
        label={label}
        htmlFor={selectId}
        required={required}
        description={description}
        helper={helperText}
        error={error}
        disabled={disabled}
        className={cn(fullWidth && 'w-full')}
      >
        <PrimitiveSelect
          {...(value !== null && value !== undefined ? { value } : {})}
          {...(defaultValue !== undefined ? { defaultValue } : {})}
          onValueChange={handleValueChange}
          {...(required !== undefined ? { required } : {})}
          {...(disabled !== undefined ? { disabled } : {})}
        >
          <SelectTrigger ref={ref as React.Ref<HTMLButtonElement>} id={selectId} className={className} aria-invalid={Boolean(error)}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {resolvedOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </PrimitiveSelect>
      </FormField>
    );
  },
);

Select.displayName = 'Select';

export default Select;
