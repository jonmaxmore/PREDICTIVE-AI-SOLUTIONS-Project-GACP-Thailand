/**
 * Constants — Unified Entry Point (OBW-2)
 *
 * Single import path for all application constants.
 * Re-exports from both `@/constants/` and `@/lib/constants/` namespaces.
 *
 * New code should import from here:
 *   import { WORKFLOW_STATES } from '@/constants';
 *
 * Fees are not constants: they are read from GET /api/pricing/fees
 * (src/lib/pricing). constants/fees.ts is empty and deliberately not
 * re-exported here.
 *
 * Existing imports from sub-paths still work and are NOT deprecated.
 */

// Options
export * from './options';

// Auth & Workflow (from lib/constants/)
export * from '../lib/constants/auth-routes';
export * from '../lib/constants/canonical-roles';
export * from '../lib/constants/workflow-states';
