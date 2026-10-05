import React from 'react';
import { clsx, type ClassValue } from 'clsx';

function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'elevated' | 'outlined' | 'status';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  status?: 'error' | 'success' | 'warning';
  hover?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, variant = 'default', padding = 'md', status, hover, ...props }, ref) => {
    const variants = {
      default: 'bg-card shadow-sm',
      elevated: 'bg-card shadow-lg',
      outlined: 'bg-muted/50 shadow-sm',
      status: status === 'error'
        ? 'bg-red-50 shadow-sm' 
        : status === 'success'
        ? 'bg-green-50 shadow-sm'
        : status === 'warning'
        ? 'bg-amber-50 shadow-sm'
        : 'bg-muted/50 shadow-sm',
    };

    const paddings = {
      none: '',
      sm: 'p-3',
      md: 'p-5',
      lg: 'p-8',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl transition-all duration-200',
          variants[variant],
          paddings[padding],
          hover && 'card-hover cursor-pointer',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

export interface CardHeaderProps {
  children?: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  children,
  className,
  title,
  subtitle,
  action,
}) => (
  <div className={cn('mb-4 flex items-center justify-between', className)}>
    <div>
      {title && <h3 className="text-lg font-semibold text-foreground">{title}</h3>}
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      {children}
    </div>
    {action && <div>{action}</div>}
  </div>
);

export interface CardTitleProps {
  children?: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const CardTitle: React.FC<CardTitleProps> = ({
  children,
  className,
  title,
  subtitle,
  action,
}) => (
  <div className={cn('flex items-center justify-between', className)}>
    <div>
      {title && <h3 className="text-lg font-semibold text-foreground">{title}</h3>}
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      {children}
    </div>
    {action && <div>{action}</div>}
  </div>
);

export const CardContent: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={cn('', className)}>{children}</div>;

export const CardFooter: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className={cn('mt-4 flex items-center justify-end gap-3 pt-2', className)}>
    {children}
  </div>
);

export default Card;
