/**
 * Health ID Validator
 *
 * Re-exports from the shared @gacp/validation package.
 * Uses "Health ID" terminology internally (MOPH domain naming).
 */

export {
    validateThaiId as validateHealthId,
    formatThaiId as formatHealthId,
    validateJuristicId,
    validateCommunityEnterpriseId,
    validateIdByType,
} from '@gacp/validation';

export type { ThaiIdValidationResult as HealthIdValidationResult } from '@gacp/validation';

// ── Backward compatibility ──────────────────────────────────────────────────
export { validateThaiId, formatThaiId } from '@gacp/validation';
export type { ThaiIdValidationResult } from '@gacp/validation';

import { validateThaiId, formatThaiId, validateJuristicId, validateCommunityEnterpriseId, validateIdByType } from '@gacp/validation';

const healthIdValidatorUtils = {
    validateHealthId: validateThaiId,
    validateJuristicId,
    validateCommunityEnterpriseId,
    validateIdByType,
    formatHealthId: formatThaiId,
    // @deprecated aliases
    validateThaiId,
    formatThaiId,
};

export default healthIdValidatorUtils;
