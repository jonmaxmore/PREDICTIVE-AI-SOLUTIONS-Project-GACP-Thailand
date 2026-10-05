'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import { cn } from '@/lib/utils';
import { bangkokDateParts } from '@/lib/format/thai-date';

function toDateInputValue(value: Date | string | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return bangkokDateParts(date)?.isoDate ?? ''; // the Bangkok day, not the UTC one
}

function parseDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function Field({ label, required, description, error, className, children }: any) {
  return (
    <label className={cn('field-block flex w-full flex-col', className)}>
      {label ? (
        <span className="field-label">
          {label}
          {required ? <span className="ml-1 text-destructive">*</span> : null}
        </span>
      ) : null}
      {children}
      {description ? <span className="field-help">{description}</span> : null}
      {error ? (
        <span className="field-error">
          {typeof error === 'string' ? error : 'Invalid value'}
        </span>
      ) : null}
    </label>
  );
}

const inputClass =
  'field-emphasis w-full px-4 py-2.5';

export function DateInput(props: any) {
  const {
    label,
    description,
    error,
    required,
    withAsterisk,
    value,
    onChange,
    className,
    style,
    ...rest
  } = props;

  // Strip Mantine system props
  const safeRest = Object.fromEntries(
    Object.entries(rest).filter(([k]) =>
      !['color', 'size', 'variant', 'radius', 'shadow', 'withBorder',
        'leftSection', 'rightSection', 'visibleFrom', 'hiddenFrom',
        'grow', 'justify', 'align', 'gap', 'wrap', 'sx', 'styles',
        'classNames', 'withinPortal', 'zIndex', 'w', 'h', 'miw', 'maw',
        'm', 'mt', 'mb', 'ml', 'mr', 'mx', 'my', 'p', 'pt', 'pb', 'pl',
        'pr', 'px', 'py'].includes(k)
    )
  );

  return (
    <Field
      label={label}
      required={required || withAsterisk}
      description={description}
      error={error}
      className={className}
    >
      <input
        {...safeRest}
        type="date"
        value={toDateInputValue(value)}
        onChange={(event) => onChange?.(parseDate(event.currentTarget.value))}
        className={inputClass}
        style={style}
      />
    </Field>
  );
}

export function DatePickerInput(props: any) {
  const {
    label,
    description,
    error,
    required,
    withAsterisk,
    value,
    onChange,
    type,
    className,
    ...rest
  } = props;

  if (type === 'range') {
    const start = Array.isArray(value) ? value[0] : null;
    const end = Array.isArray(value) ? value[1] : null;

    return (
      <Field
        label={label}
        required={required || withAsterisk}
        description={description}
        error={error}
        className={className}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="date"
            value={toDateInputValue(start)}
            onChange={(event) =>
              onChange?.([parseDate(event.currentTarget.value), end || null])
            }
            className={inputClass}
          />
          <input
            type="date"
            value={toDateInputValue(end)}
            onChange={(event) =>
              onChange?.([start || null, parseDate(event.currentTarget.value)])
            }
            className={inputClass}
          />
        </div>
      </Field>
    );
  }

  return (
    <DateInput
      label={label}
      description={description}
      error={error}
      required={required}

      value={value}
      onChange={onChange}
      className={className}
      {...rest}
    />
  );
}
