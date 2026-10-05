import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  description?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, description, id: providedId, ...props }, ref) => {
    // W3-A: mirrors Input primitive — useId() provides stable per-render
    // ids so <label htmlFor> ↔ <textarea id> always pair (WCAG 1.3.1 +
    // 3.3.2). Caller-supplied id wins; otherwise we generate.
    const generatedId = React.useId();
    const textareaId = providedId ?? generatedId;
    const errorId = error ? `${textareaId}-error` : undefined;
    const descriptionId = description ? `${textareaId}-desc` : undefined;
    const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
    const a11yProps = {
      'aria-invalid': error ? (true as const) : undefined,
      'aria-describedby': describedBy,
    };

    const textareaEl = (
      <textarea
        id={textareaId}
        className={cn(
          'field-emphasis flex min-h-[110px] w-full px-4 py-2.5 ring-offset-background placeholder:text-muted-foreground/90 focus-visible:shadow-[0_0_0_2px_hsl(var(--ring)/0.28),0_0_0_1px_hsl(var(--ring)),0_8px_16px_-14px_rgba(15,23,42,0.4)] focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-red-500',
          className,
        )}
        ref={ref}
        {...a11yProps}
        {...props}
      />
    );

    if (!label && !error && !description) return textareaEl;

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={textareaId} className="text-sm font-medium text-foreground">
            {label}
            {props.required && <span className="ml-1 text-red-500">*</span>}
          </label>
        )}
        {textareaEl}
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
        {error && (
          <p id={errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
