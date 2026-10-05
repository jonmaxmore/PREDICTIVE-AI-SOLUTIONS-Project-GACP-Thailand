import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  hint: string;
  action?: React.ReactNode;
  compact?: boolean;
  icon?: LucideIcon;
}

export function EmptyState({ title, hint, action, compact = false, icon: Icon = Inbox }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-muted/50 bg-muted/20 text-center transition-all hover:bg-muted/30 ${compact ? 'px-4 py-8' : 'px-8 py-16'}`}>
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/60 shadow-inner">
        <Icon className={`${compact ? 'h-8 w-8' : 'h-12 w-12'} animate-pulse`} />
      </div>
      
      <h3 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
        {title}
      </h3>
      
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground sm:text-base">
        {hint}
      </p>
      
      {action && (
        <div className="animate-in fade-in slide-in-from-bottom-2 mt-8 flex duration-700">
          {action}
        </div>
      )}
    </div>
  );
}

