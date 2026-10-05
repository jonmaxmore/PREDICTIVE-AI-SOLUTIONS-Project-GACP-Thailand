/**
 * Journey Configuration Data
 * 
 * Defines dynamic GACP application journeys based on:
 * - Purpose: domestic (จำหน่ายในประเทศ), export (ส่งออก), research (วิจัย)
 * - Cultivation Method: outdoor (กลางแจ้ง), greenhouse (โรงเรือน), indoor (ระบบปิด)
 * 
 * Each combination has different field requirements, documents, and security specs.
 */

// PURPOSE OPTIONS
const {
    PURPOSES,
    CULTIVATION_METHODS,
    FARM_LAYOUTS,
    GROWING_STYLES,
} = require('./journey-config-options');
const {
    JOURNEY_CONFIGS,
    DOCUMENT_DEFINITIONS,
    SECURITY_DEFINITIONS,
} = require('./journey-config-matrix');
const {
    GACP_CATEGORIES,
    ENVIRONMENT_CHECKLIST,
    WATER_SOURCES,
    GACP_STEP_REQUIREMENTS,
    SOIL_TYPES,
    SEED_SOURCES,
    IPM_METHODS,
} = require('./journey-config-standards');

function getJourneyConfig(purpose, method) {
    return JOURNEY_CONFIGS.find(j => j.purpose === purpose && j.method === method);
}

/**
 * Get available layouts for a cultivation method
 */
function getLayoutsForMethod(method) {
    return FARM_LAYOUTS.filter(l => l.applicableTo.includes(method));
}

/**
 * Get growing styles for indoor cultivation
 */
function getGrowingStyles() {
    return GROWING_STYLES;
}

/**
 * Calculate plant count based on area and layout
 * @param {number} areaSqm - Area in square meters
 * @param {string} layoutId - Layout ID
 * @param {string} styleId - Growing style ID (for indoor)
 * @param {number} tiers - Number of tiers (for vertical)
 * @returns {{ count: number, formula: string, density: number }}
 */
function calculatePlantCount(areaSqm, layoutId, styleId = null, tiers = 1) {
    const layout = FARM_LAYOUTS.find(l => l.id === layoutId);

    if (!layout) {
        return { count: 0, formula: 'Unknown layout', density: 0 };
    }

    if (layout.manualPlantCount) {
        return { count: 0, formula: 'กรุณากรอกจำนวนต้นด้วยตนเอง', density: 0, manualInput: true };
    }

    let density = layout.plantsPerSqm;
    let tierMultiplier = 1;
    let densitySource = 'layout';

    // If indoor and has style, use style's density
    if (styleId) {
        const style = GROWING_STYLES.find(s => s.id === styleId);
        if (style) {
            density = style.plantsPerSqm;
            densitySource = 'style';

            // If vertical with multiple tiers
            if (style.supportsMultipleTiers && tiers > 1) {
                tierMultiplier = Math.min(tiers, style.maxTiers);
            }
        }
    }

    const count = Math.floor(areaSqm * density * tierMultiplier);
    const formula = tierMultiplier > 1
        ? `${areaSqm} ㎡ × ${density} ต้น/㎡ × ${tierMultiplier} ชั้น = ${count} ต้น`
        : `${areaSqm} ㎡ × ${density} ต้น/㎡ = ${count} ต้น`;

    return { count, formula, density, tiers: tierMultiplier, densitySource };
}

/**
 * Convert area units to square meters
 */
function convertToSqm(value, unit) {
    switch (unit) {
        case 'Rai':
            return value * 1600;
        case 'Ngan':
            return value * 400;
        case 'Sqm':
        default:
            return value;
    }
}

/**
 * Get document details by IDs
 */
function getDocumentDetails(docIds) {
    return docIds
        .filter(id => DOCUMENT_DEFINITIONS[id])
        .map(id => ({ id, ...DOCUMENT_DEFINITIONS[id] }));
}

/**
 * Get security details by IDs
 */
function getSecurityDetails(secIds) {
    return secIds
        .filter(id => SECURITY_DEFINITIONS[id])
        .map(id => ({ id, ...SECURITY_DEFINITIONS[id] }));
}

module.exports = {
    PURPOSES,
    CULTIVATION_METHODS,
    FARM_LAYOUTS,
    GROWING_STYLES,
    JOURNEY_CONFIGS,
    DOCUMENT_DEFINITIONS,
    SECURITY_DEFINITIONS,
    // NEW: GACP 14 Categories
    GACP_CATEGORIES,
    ENVIRONMENT_CHECKLIST,
    WATER_SOURCES,
    GACP_STEP_REQUIREMENTS,
    // NEW: Step 5 Plot Data
    SOIL_TYPES,
    SEED_SOURCES,
    IPM_METHODS,
    // Helper functions
    getJourneyConfig,
    getLayoutsForMethod,
    getGrowingStyles,
    calculatePlantCount,
    convertToSqm,
    getDocumentDetails,
    getSecurityDetails,
};
