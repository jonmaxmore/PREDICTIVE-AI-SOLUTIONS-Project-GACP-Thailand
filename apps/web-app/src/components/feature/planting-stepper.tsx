import { cn } from '@/lib/utils';

interface PlantingStepperProps {
  steps: string[];
  currentStep: number;
}

export function PlantingStepper({ steps, currentStep }: PlantingStepperProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isDone = index < currentStep;

        return (
          <span
            key={step}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold',
              isActive && 'bg-primary text-primary-foreground shadow-sm',
              isDone && 'bg-accent text-accent-foreground',
              !isDone && !isActive && 'bg-muted/70 text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold',
                isActive && 'bg-primary-foreground/20 text-primary-foreground',
                isDone && 'bg-accent-foreground/10 text-accent-foreground',
                !isDone && !isActive && 'bg-background/70 text-muted-foreground',
              )}
            >
              {index + 1}
            </span>
            <span className="truncate">{step}</span>
          </span>
        );
      })}
    </div>
  );
}

