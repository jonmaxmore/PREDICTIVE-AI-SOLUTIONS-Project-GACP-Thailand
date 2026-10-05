import React from 'react';
import { AlertCircle, CheckCircle, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error' | 'destructive';

// Maps Mantine color names to Alert variants
const colorToVariant: Record<string, AlertVariant> = {
  blue: 'info', cyan: 'info', indigo: 'info',
  green: 'success', teal: 'success', emerald: 'success',
  yellow: 'warning', orange: 'warning', amber: 'warning',
  red: 'error', pink: 'error',
  gray: 'info', dark: 'info',
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
  icon?: React.ReactNode;
  color?: string;
  withCloseButton?: boolean;
  styles?: Record<string, unknown>;
}

export const Alert: React.FC<AlertProps> = ({
  variant,
  color,
  title,
  children,
  onClose,
  className,
  icon,
  withCloseButton: _wcb,
  styles: _styles,
  ...props
}) => {
  const resolvedVariant = variant ?? (color ? colorToVariant[color] : undefined) ?? 'info';

  const variantStyles = {
    info: {
      container: 'bg-blue-50',
      icon: 'text-blue-500',
      title: 'text-blue-800',
      text: 'text-blue-700',
    },
    success: {
      container: 'bg-green-50',
      icon: 'text-green-500',
      title: 'text-green-800',
      text: 'text-green-700',
    },
    warning: {
      container: 'bg-amber-50',
      icon: 'text-amber-500',
      title: 'text-amber-800',
      text: 'text-amber-700',
    },
    error: {
      container: 'bg-red-50',
      icon: 'text-red-500',
      title: 'text-red-800',
      text: 'text-red-700',
    },
    destructive: {
      container: 'bg-red-50',
      icon: 'text-red-500',
      title: 'text-red-800',
      text: 'text-red-700',
    },
  };

  const defaultIcons = {
    info: Info,
    success: CheckCircle,
    warning: AlertCircle,
    error: XCircle,
    destructive: XCircle,
  };

  const DefaultIcon = defaultIcons[resolvedVariant];
  const styles = variantStyles[resolvedVariant];

  return (
    <div
      className={cn(
        'relative rounded-2xl p-4 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.32)]',
        styles.container,
        className
      )}
      role="alert"
      {...props}
    >
      <div className="flex gap-3">
        <div className={cn('flex-shrink-0', styles.icon)} aria-hidden="true">
          {icon ?? <DefaultIcon className="h-5 w-5" />}
        </div>

        <div className="min-w-0 flex-1">
          {title && (
            <h3 className={cn('mb-1 font-semibold', styles.title)}>
              {title}
            </h3>
          )}
          <div className={cn('text-sm', styles.text)}>{children}</div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className={cn(
              '-mr-1 -mt-1 flex-shrink-0 rounded-lg p-1 transition-colors',
              'hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              styles.icon
            )}
            aria-label="ปิดการแจ้งเตือน"
          >
            <X className="h-4 w-4" aria-hidden="true" focusable="false" />
          </button>
        )}
      </div>
    </div>
  );
};

export const AlertTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className
}) => (
  <h3 className={cn('mb-1 font-semibold', className)}>{children}</h3>
);

export const AlertDescription: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className
}) => (
  <div className={cn('text-sm', className)}>{children}</div>
);

export default Alert;
