// Shared shape for the step components that compose the wizard. Lived on
// new/page.tsx until the 2026-04-29 design-pass-7 cleanup deleted that bare
// redirect. Sections kept the import; this file restores the type at a
// neutral, non-routed location so renaming or deleting page.tsx in the
// future doesn't break the section layer again.

export interface StepProps {
  onNext: () => void;
  onBack: () => void;
  isFirst?: boolean;
}
