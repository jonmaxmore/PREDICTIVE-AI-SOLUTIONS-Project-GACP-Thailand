import { enCore } from './sections/en-core';
import { enAuth } from './sections/en-auth';
import { enWizard } from './sections/en-wizard';
import { enPROVIDER } from './sections/en-provider';
import { enHealth } from './sections/en-health';
import { enVerifier } from './sections/en-verifier';
import { enAccessibility } from './sections/en-accessibility';
import { enFooter } from './sections/en-footer';

export const en = {
  ...enCore,
  ...enAuth,
  ...enWizard,
  ...enPROVIDER,
  ...enHealth,
  ...enVerifier,
  ...enAccessibility,
  ...enFooter,
};
