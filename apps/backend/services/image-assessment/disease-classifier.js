'use strict';

/**
 * Disease Classifier — สัญญา C05F680149 ต้นแบบที่ 6 โมดูล 6.3
 * "ระบบตรวจจับโรคพืช 7 โรค".
 *
 * HONEST architecture (no fabricated AI accuracy):
 *   - `DiseaseClassifier` is an interface: `classify(features) -> [{disease,
 *     confidence}]`.
 *   - `HeuristicDiseaseClassifier` is a TRANSPARENT rule-based BASELINE — maps
 *     observable leaf colour/lesion features (dark-spot / white-coverage /
 *     yellowing / green-dominance) to a probability distribution over the 8
 *     classes. It is documented as a baseline, NOT a trained model, and every
 *     result is advisory (needsExpertConfirmation) — it never decides
 *     certification (owner ruling #298/#528).
 *   - A trained ONNX/TensorFlow model plugs in as `opts.provider` (the model
 *     slot) without changing callers; the eval harness (classifier-evaluator)
 *     measures the contractual ≥85% accuracy on the pilot's labelled images.
 *
 * The heuristic is deterministic (pure function of the features).
 */

// 7 โรคตามเอกสารแนบ A3 (สัญญาหน้า 51/81) + HEALTHY (ไม่พบโรค)
const DISEASE_CLASSES = Object.freeze([
    'HEALTHY',
    'LEAF_BLIGHT',      // ใบไหม้
    'POWDERY_MILDEW',   // ราแป้ง
    'LEAF_SPOT',        // ใบจุด
    'ROOT_ROT',         // โคนเน่า
    'WILT',             // ยอดเหี่ยว
    'PEST',             // แมลงศัตรูพืช
    'VIRUS',            // ไวรัส
]);

function httpError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

function clamp01(x) {
    if (!Number.isFinite(x)) { return 0; }
    return Math.max(0, Math.min(1, x));
}

/** green dominance 0-1 from colour means (leaf greenness). */
function greenDominance(colorMeans) {
    if (!colorMeans) { return 0; }
    const { r = 0, g = 0, b = 0 } = colorMeans;
    return clamp01((g - (r + b) / 2) / 128);
}

/** Baseline classifier: transparent feature→class affinities, softmaxed. */
class HeuristicDiseaseClassifier {
    constructor() {
        this.name = 'heuristic-baseline';
    }

    // Pure + deterministic.
    async classify(features) {
        const f = features || {};
        const dark = clamp01(f.darkSpotRatio ?? 0);
        const white = clamp01(f.whiteCoverageRatio ?? 0);
        const yellow = clamp01(f.yellowRatio ?? 0);
        const green = greenDominance(f.colorMeans);
        const dim = Number.isFinite(f.brightness) ? clamp01((128 - f.brightness) / 128) : 0; // darker = higher

        const EPS = 0.02;
        // Non-negative affinities (rule-based, documented weights)
        const affinity = {
            HEALTHY: EPS + green * 1.4 - dark * 1.2 - white * 1.2 - yellow * 1.0,
            LEAF_BLIGHT: EPS + dark * 1.1 + dim * 0.4,
            POWDERY_MILDEW: EPS + white * 2.2,
            LEAF_SPOT: EPS + dark * 1.0,
            ROOT_ROT: EPS + dark * 0.5 + (1 - green) * 0.4 + dim * 0.3,
            WILT: EPS + dim * 0.7 + (1 - green) * 0.3,
            PEST: EPS + dark * 0.6,
            VIRUS: EPS + yellow * 1.8,
        };

        // Floor at 0, then normalize to a probability distribution summing to 1.
        let sum = 0;
        for (const cls of DISEASE_CLASSES) {
            affinity[cls] = Math.max(0, affinity[cls]);
            sum += affinity[cls];
        }
        if (sum === 0) {
            const uniform = 1 / DISEASE_CLASSES.length;
            return DISEASE_CLASSES.map(disease => ({ disease, confidence: uniform }));
        }
        return DISEASE_CLASSES.map(disease => ({
            disease,
            confidence: affinity[disease] / sum,
        }));
    }
}

/**
 * Feature-rule classifier v2 (ต้นแบบ-6, 2026-07-11) — uses the two new
 * discriminative features (brownRatio, spotFragmentation) to separate the
 * dark-based diseases (blight vs leaf-spot vs root-rot vs pest) that v1 could
 * not, keying each class on its documented plant-pathology visual signature:
 *   HEALTHY        green canopy, minimal lesions
 *   POWDERY_MILDEW white powder coverage
 *   VIRUS          yellow mosaic/mottling
 *   LEAF_BLIGHT    large CONTIGUOUS brown necrosis (low fragmentation)
 *   LEAF_SPOT      many SMALL discrete brown lesions (high fragmentation)
 *   ROOT_ROT       dark, dim, low-green, blackish contiguous rot (not brown)
 *   WILT           dull/dim drooping tissue, few lesions
 *   PEST           irregular dark chewing damage (very high fragmentation)
 * Rule-based + transparent (auditable weights). A trained ONNX/TF model plugs
 * in via the same {name, classify} provider slot without touching callers.
 */
class FeatureRuleClassifierV2 {
    constructor() {
        this.name = 'feature-rule-v2';
    }

    async classify(features) {
        const f = features || {};
        const dark = clamp01(f.darkSpotRatio ?? 0);
        const white = clamp01(f.whiteCoverageRatio ?? 0);
        const yellow = clamp01(f.yellowRatio ?? 0);
        const brown = clamp01(f.brownRatio ?? 0);
        const green = greenDominance(f.colorMeans);
        const dim = Number.isFinite(f.brightness) ? clamp01((128 - f.brightness) / 128) : 0;
        const frag = Number.isFinite(f.spotFragmentation) ? f.spotFragmentation : 0;
        const highFrag = clamp01(frag / 2);          // scattered small lesions
        const lowFrag = clamp01((1.4 - frag) / 1.4); // one contiguous patch
        const anyFrag = clamp01(frag);
        const lowGreen = clamp01((0.35 - green) / 0.35); // genuinely dull/wilted only
        const EPS = 0.02;

        // Interaction terms are what separate the dark/brown diseases:
        //   blight = brown × LOW frag (one big patch) · spot = brown × HIGH frag
        //   (many small lesions) · pest = dark × HIGH frag (chewing holes) ·
        //   root-rot = dark (gated) × contiguous, NOT brown · wilt = dim × truly
        //   low green with NO lesions (gated so it doesn't poach spotted/pest
        //   leaves that keep their greenness). HEALTHY is penalised by every
        //   lesion signal so a diseased leaf can't read as healthy.
        const affinity = {
            HEALTHY: EPS + green * 1.8 - dark * 2.5 - white * 2.5 - yellow * 2.2 - brown * 2.5 - anyFrag * 0.8,
            POWDERY_MILDEW: EPS + white * 3.5 - green * 0.2,
            VIRUS: EPS + yellow * 3.2 - dark * 0.5,
            LEAF_BLIGHT: EPS + brown * (2.0 + lowFrag * 2.5),
            LEAF_SPOT: EPS + brown * highFrag * 8.0,
            ROOT_ROT: EPS + dark * (2.0 + lowFrag * 1.0) - brown * 2.0,
            WILT: EPS + lowGreen * (dim * 2.0 + 1.0) * 1.5 - dark * 2.0 - brown * 2.0 - white * 2.0 - yellow * 2.0,
            PEST: EPS + dark * highFrag * 8.0 + dark * 0.3,
        };

        let sum = 0;
        for (const cls of DISEASE_CLASSES) {
            affinity[cls] = Math.max(0, affinity[cls]);
            sum += affinity[cls];
        }
        if (sum === 0) {
            const uniform = 1 / DISEASE_CLASSES.length;
            return DISEASE_CLASSES.map(disease => ({ disease, confidence: uniform }));
        }
        return DISEASE_CLASSES.map(disease => ({ disease, confidence: affinity[disease] / sum }));
    }
}

// v2 is the active baseline (better class separation); v1 kept for compat.
const defaultClassifier = new FeatureRuleClassifierV2();

function getActiveProviderName() {
    return defaultClassifier.name;
}

/**
 * @param {object} features — image features (from image-feature-extractor)
 * @param {{provider?: {name:string, classify:Function}}} options
 */
async function classifyDisease(features, { provider } = {}) {
    if (!features || typeof features !== 'object') {
        throw httpError(400, 'IMAGE_FEATURES_INVALID', 'Image features are required');
    }
    const clf = provider || defaultClassifier;
    const raw = await clf.classify(features);
    const predictions = [...raw]
        .map(p => ({ disease: p.disease, confidence: Number(p.confidence) }))
        .sort((a, b) => b.confidence - a.confidence);

    return {
        provider: clf.name || 'unknown',
        predictions,
        top: predictions[0] || null,
        // Always advisory — a prediction never decides certification.
        needsExpertConfirmation: true,
    };
}

module.exports = {
    DISEASE_CLASSES,
    HeuristicDiseaseClassifier,
    FeatureRuleClassifierV2,
    classifyDisease,
    getActiveProviderName,
};
