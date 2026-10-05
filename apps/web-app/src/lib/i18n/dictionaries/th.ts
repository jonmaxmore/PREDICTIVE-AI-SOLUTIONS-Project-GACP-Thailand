import type { Dictionary } from '../types';
import { thCore } from './sections/th-core';
import { thAuth } from './sections/th-auth';
import { thWizard } from './sections/th-wizard';
import { thPROVIDER } from './sections/th-provider';
import { thHealth } from './sections/th-health';
import { thVerifier } from './sections/th-verifier';
import { thAccessibility } from './sections/th-accessibility';
import { thFooter } from './sections/th-footer';

export const th: Dictionary = {
  ...thCore,
  ...thAuth,
  ...thWizard,
  ...thPROVIDER,
  ...thHealth,
  ...thVerifier,
  ...thAccessibility,
  ...thFooter,
};
