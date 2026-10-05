/**
 * What cultivation method an application actually states.
 *
 * `certificate-service.mapAreaTypeToSolarSystem` returned 'OUTDOOR' for
 * anything it did not recognise — an unknown token, an empty string, null. Its
 * result is written to `Farm.cultivationMethod` at issuance, overwriting
 * whatever the farm itself said, and it becomes "วิธีการปลูก" on the printed
 * application form.
 *
 * The web wizard never set `formData.locationType` for a new application:
 * nothing in the flow called the setter, so the field was null and both submit
 * paths sent `state.locationType || 'OUTDOOR'`. That fallback therefore fired
 * for every applicant. Indoor growers' legal paperwork said outdoor, their
 * certified farm records were rewritten to outdoor, and DTAM's cultivation
 * statistics read 100% outdoor for the entire country.
 *
 * The wizard derives the value now. This is the same rule server-side, so an
 * application from the mobile client or an older web build reads the same way —
 * and so "we do not know" is an answer the caller has to handle rather than a
 * silent OUTDOOR.
 */

/**
 * Most controlled last. A farm using more than one method has no single true
 * answer, so callers take the most controlled environment present — the one
 * with the higher fee and the stricter obligations. Erring that way does not
 * under-charge or under-regulate anyone.
 */
const BY_CONTROL = ['OUTDOOR', 'GREENHOUSE', 'INDOOR'];

/** Every spelling that reaches this platform, from either client. */
const METHOD_TOKENS = Object.freeze({
    outdoor: 'OUTDOOR',
    greenhouse: 'GREENHOUSE',
    indoor: 'INDOOR',
    indoor_controlled: 'INDOOR',
});

/** One token to a canonical method, or null if it is not one. */
function normalizeCultivationMethod(value) {
    const key = String(value == null ? '' : value).trim().toLowerCase();
    return METHOD_TOKENS[key] || null;
}

/** The most controlled method in a list, or null if none of them mapped. */
function mostControlledMethod(values) {
    let best = null;
    for (const value of values || []) {
        const method = normalizeCultivationMethod(value);
        if (!method) {continue;}
        if (!best || BY_CONTROL.indexOf(method) > BY_CONTROL.indexOf(best)) {best = method;}
    }
    return best;
}

/**
 * The method an application states, or null if it states none.
 *
 * Order matters: an explicit answer beats one inferred from the plots, and the
 * plots beat the coarse method list collected at the start of the wizard.
 */
function applicationCultivationMethod(app) {
    const formData = app?.formData || {};

    const stated = normalizeCultivationMethod(
        formData.locationType || app?.areaType || formData.areaType,
    );
    if (stated) {return stated;}

    const plots = Array.isArray(formData.plots) ? formData.plots : [];
    const fromPlots = mostControlledMethod(
        plots.map((plot) => plot?.solarSystem || plot?.cultivationMethod),
    );
    if (fromPlots) {return fromPlots;}

    return mostControlledMethod(formData.cultivationMethods);
}

module.exports = {
    BY_CONTROL,
    METHOD_TOKENS,
    normalizeCultivationMethod,
    mostControlledMethod,
    applicationCultivationMethod,
};
