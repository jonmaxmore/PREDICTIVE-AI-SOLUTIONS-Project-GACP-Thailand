import type { SiteType } from '../../hooks/domain-types';

/**
 * The cultivation method the application says it uses.
 *
 * `state.locationType` was written by exactly one place in this codebase: the
 * edit page, hydrating a value from an application that already existed. No step
 * of the new-application wizard ever set it, so it was null for every new
 * application and both submit paths sent `state.locationType || 'OUTDOOR'`.
 *
 * That field is not cosmetic. It becomes "วิธีการปลูก" on the printed
 * application form, it becomes `Farm.cultivationMethod` at certificate issuance
 * — overwriting whatever the farm itself said — and it is the fee fallback when
 * plots carry no method of their own. An indoor grower's legal paperwork said
 * outdoor, their certified farm record was rewritten to outdoor, and DTAM's
 * cultivation statistics read 100% outdoor for the entire country.
 *
 * The wizard does collect this. It asks for `cultivationMethods` at the start
 * and for a `solarSystem` on each plot. The answer was simply never carried
 * across.
 */

/**
 * Most controlled last. When a farm uses more than one method there is no
 * single true answer, so this takes the most controlled environment present —
 * the one with the higher fee and the stricter obligations. Erring that way
 * does not under-charge or under-regulate anyone.
 */
const BY_CONTROL: SiteType[] = ['OUTDOOR', 'GREENHOUSE', 'INDOOR'];

/** Every spelling of a cultivation method that reaches this wizard. */
const METHOD_TOKENS: Record<string, SiteType> = {
    outdoor: 'OUTDOOR',
    greenhouse: 'GREENHOUSE',
    indoor: 'INDOOR',
    indoor_controlled: 'INDOOR',
};

function toSiteType(token: unknown): SiteType | null {
    const key = String(token ?? '').trim().toLowerCase();
    return METHOD_TOKENS[key] ?? null;
}

/** The most controlled method in a list, or null if none of them mapped. */
function mostControlled(tokens: ReadonlyArray<unknown> | null | undefined): SiteType | null {
    let best: SiteType | null = null;
    for (const token of tokens || []) {
        const method = toSiteType(token);
        if (!method) continue;
        if (!best || BY_CONTROL.indexOf(method) > BY_CONTROL.indexOf(best)) best = method;
    }
    return best;
}

interface LocationSource {
    locationType?: string | null;
    plots?: ReadonlyArray<{ solarSystem?: string | null }> | null;
    cultivationMethods?: ReadonlyArray<string> | null;
}

export function deriveLocationType(state: LocationSource | null | undefined): SiteType | null {
    // An answer the applicant already gave. Re-deriving would silently rewrite
    // what they stated.
    const stated = toSiteType(state?.locationType);
    if (stated) return stated;

    // The plot rows are the most specific thing the wizard has, and they are
    // what an auditor will actually walk.
    const fromPlots = mostControlled((state?.plots || []).map((plot) => plot?.solarSystem));
    if (fromPlots) return fromPlots;

    return mostControlled(state?.cultivationMethods);
}
