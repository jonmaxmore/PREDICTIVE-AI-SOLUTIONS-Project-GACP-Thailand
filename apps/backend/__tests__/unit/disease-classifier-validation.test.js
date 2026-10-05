'use strict';

/**
 * ต้นแบบที่ 6 — Disease classifier VALIDATION harness (KPI ≥85% accuracy).
 *
 * HONEST FRAMING (calibrated to an independent adversarial review — do not
 * re-inflate the claims): this measures accuracy on a LABELLED SYNTHETIC set of
 * 320 samples (40/class), NOT on real pilot field photos. It is HARDER than a
 * fixed-parameter toy set (that easier set scored ~99%, which did not reflect
 * real variation) because every sample carries magnitude confounders:
 *   • per-sample lighting/exposure shift (0.85–1.15×)  — field lighting
 *   • per-sample REALISTIC leaf colour (green-dominance ~0.35–0.6, NOT neon)
 *   • per-sample pixel noise 18–32                      — sensor/JPEG grain
 *   • per-sample disease SEVERITY tier (clear vs subtle) — severe → moderate
 *   • randomised lesion size / count / placement, varied lesion colour
 *
 * SCOPE — what this DOES and does NOT prove (per the review, stated plainly):
 *   • The generator encodes each class's signature INSIDE the production
 *     extractor's own feature buckets (white/yellow/brown/dark/green-dominance).
 *     That is co-design: this validates that the feature→class MAPPING is ROBUST
 *     to magnitude/lighting/colour/severity variation — it does NOT prove
 *     independent generalisation across co-occurring/ambiguous real symptoms.
 *   • Classes are largely feature-separable BY CONSTRUCTION (single dominant
 *     symptom per image). So this is a robustness check, not a hard
 *     disambiguation benchmark. (Adversarial review confirmed it is NOT gamed —
 *     a degenerate always-HEALTHY classifier scores 12.5% and fails every gate —
 *     but classified it as a "soft" hard-set, which this header now reflects.)
 *   • The classifier itself is UNCHANGED (not re-tuned to pass); the number is
 *     whatever the method achieves, reported PER-CLASS so weaknesses are visible.
 *
 * KNOWN-AND-REPORTED weakness of the rule-based BASELINE (see per-class output):
 * POWDERY_MILDEW and VIRUS are under-detected at MODERATE severity — a very
 * green leaf keeps whole-image green-dominance high, so mild white/yellow
 * coverage does not always overcome it. This is precisely where the pilot's
 * TRAINED model (dropped into the SAME evaluateClassifier via the ONNX/TF
 * provider slot) is expected to add the most value. The number here is a
 * synthetic robustness ceiling — NOT the real field number.
 *
 * Pipeline under test is 100% production code:
 *   deriveLesionRatios → FeatureRuleClassifierV2 → evaluateClassifier.
 */

const { deriveLesionRatios } = require('../../services/image-assessment/image-feature-extractor');
const { FeatureRuleClassifierV2, DISEASE_CLASSES } = require('../../services/image-assessment/disease-classifier');
const { evaluateClassifier } = require('../../services/image-assessment/classifier-evaluator');

const SIDE = 64;
const SAMPLES_PER_CLASS = 40; // 320 total — statistically meaningful

// hashed-seed LCG + warm-up — avoids the consecutive-seed / first-draw bias of a
// raw LCG (which would collapse the difficulty tiers and correlate samples).
function lcg(seed) {
    let s = (Math.imul(seed ^ 0x9e3779b9, 2654435761)) >>> 0;
    const next = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0xffffffff;
    };
    next(); next();
    return next;
}

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Build a 64×64×3 RGB buffer for a class with realistic within-class variation
 * and global confounders. Returns { buf, tier } where tier ∈ clear|subtle.
 */
function synthImage(cls, seed) {
    const rnd = lcg(seed);
    const subtle = rnd();                       // 0 severe … 1 mild
    const exposure = 0.85 + rnd() * 0.30;       // 0.85–1.15 lighting
    const noiseAmp = 18 + rnd() * 14;           // 18–32 grain
    const px = SIDE * SIDE;
    const buf = Buffer.alloc(px * 3);
    const noise = () => (rnd() - 0.5) * noiseAmp;
    const set = (i, r, g, b) => {
        buf[i * 3] = clampByte(r * exposure + noise());
        buf[i * 3 + 1] = clampByte(g * exposure + noise());
        buf[i * 3 + 2] = clampByte(b * exposure + noise());
    };

    // realistic leaf base (green-dominance ~0.35–0.6, dull palette for WILT)
    const dull = cls === 'WILT';
    const baseR = dull ? 90 + rnd() * 14 : 48 + rnd() * 22;
    const baseG = dull ? 96 + rnd() * 12 : 108 + rnd() * 34;
    const baseB = dull ? 68 + rnd() * 12 : 44 + rnd() * 16;
    for (let i = 0; i < px; i++) { set(i, baseR, baseG, baseB); }

    const paintBlob = (cx, cy, rad, r, g, b) => {
        for (let y = 0; y < SIDE; y++) {
            for (let x = 0; x < SIDE; x++) {
                if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) { set(y * SIDE + x, r, g, b); }
            }
        }
    };
    const scatter = (count, rad, r, g, b, jitter = 0) => {
        for (let k = 0; k < count; k++) {
            const cx = Math.floor(rnd() * SIDE), cy = Math.floor(rnd() * SIDE);
            const jr = jitter ? Math.round((rnd() - 0.5) * jitter) : 0;
            paintBlob(cx, cy, Math.max(1, rad + jr), r + noise(), g + noise(), b + noise());
        }
    };
    const brown = () => [118 + rnd() * 26, 66 + rnd() * 24, 40 + rnd() * 16];
    const sev = 0.6 + 0.4 * (1 - subtle); // 0.6 (subtle, still visible) … 1.0 (clear, severe)

    switch (cls) {
        case 'HEALTHY':
            // occasionally 1–2 faint natural specks (sub-lesion) — false-alarm confounder
            if (rnd() > 0.6) { scatter(1 + Math.floor(rnd() * 2), 1, 92, 118, 72); }
            break;
        case 'POWDERY_MILDEW':
            scatter(Math.round((20 + rnd() * 12) * sev), 3 + Math.floor(rnd() * 2), 238 + rnd() * 12, 238 + rnd() * 12, 236 + rnd() * 12, 1);
            break;
        case 'VIRUS':
            scatter(Math.round((26 + rnd() * 14) * sev), 3 + Math.floor(rnd() * 2), 200 + rnd() * 16, 192 + rnd() * 16, 74 + rnd() * 20, 1);
            break;
        case 'LEAF_BLIGHT': {
            const patches = 1 + (rnd() > 0.6 ? 1 : 0); // 1–2 large CONTIGUOUS brown patches
            for (let p = 0; p < patches; p++) {
                const [r, g, b] = brown();
                paintBlob(18 + Math.floor(rnd() * 28), 18 + Math.floor(rnd() * 28), Math.round((15 + rnd() * 7) * (0.75 + 0.25 * sev)), r, g, b);
            }
            break;
        }
        case 'LEAF_SPOT': {
            const [r, g, b] = brown(); // many SMALL discrete brown spots (high fragmentation)
            scatter(Math.round((22 + rnd() * 16) * sev), 1 + Math.floor(rnd() * 2), r, g, b, 1);
            break;
        }
        case 'ROOT_ROT':
            // dark blackish CONTIGUOUS rot (not brown), low green
            paintBlob(20 + Math.floor(rnd() * 24), 24 + Math.floor(rnd() * 22), Math.round((15 + rnd() * 7) * (0.75 + 0.25 * sev)), 26 + rnd() * 14, 24 + rnd() * 12, 22 + rnd() * 12);
            break;
        case 'WILT':
            break; // dull base only — defined by low-green + dim
        case 'PEST':
            // many SMALL dark chewing holes (high fragmentation)
            scatter(Math.round((24 + rnd() * 16) * sev), 1 + Math.floor(rnd() * 2), 20 + rnd() * 14, 18 + rnd() * 12, 18 + rnd() * 12, 1);
            break;
        default:
            break;
    }
    return { buf, tier: subtle < 0.5 ? 'clear' : 'subtle' };
}

describe('ต้นแบบ 6 — disease classifier validation (KPI ≥85%, HARDENED synthetic method-val)', () => {
    const clf = new FeatureRuleClassifierV2();

    async function runValidation() {
        const samples = [];
        const byTier = { clear: { correct: 0, total: 0 }, subtle: { correct: 0, total: 0 } };
        let seed = 20260711;
        for (const actual of DISEASE_CLASSES) {
            for (let n = 0; n < SAMPLES_PER_CLASS; n++) {
                const { buf, tier } = synthImage(actual, seed++);
                const features = deriveLesionRatios(buf, 3, SIDE);
                const preds = await clf.classify(features);
                const predicted = [...preds].sort((a, b) => b.confidence - a.confidence)[0].disease;
                samples.push({ actual, predicted });
                byTier[tier].total += 1;
                if (predicted === actual) { byTier[tier].correct += 1; }
            }
        }
        return { result: evaluateClassifier(samples, DISEASE_CLASSES, { target: 0.85 }), byTier };
    }

    let cache = null;
    const getRun = async () => { if (!cache) { cache = await runValidation(); } return cache; };

    test('overall accuracy ≥ 85% over 8 classes on the HARDENED synthetic set (320 samples)', async () => {
        const { result, byTier } = await getRun();
        const macro = (k) => DISEASE_CLASSES.reduce((a, c) => a + result.perClass[c][k], 0) / DISEASE_CLASSES.length;
        const pct = (x) => `${(x * 100).toFixed(1)}%`;
        console.log(`[ต้นแบบ6-validation] accuracy=${pct(result.accuracy)} target=85% total=${result.total} correct=${result.correct} meetsTarget=${result.meetsTarget}`);
        console.log(`[ต้นแบบ6-validation] macro precision=${pct(macro('precision'))} recall=${pct(macro('recall'))} F1=${pct(macro('f1'))}`);
        console.log(`[ต้นแบบ6-validation] tier clear=${pct(byTier.clear.correct / byTier.clear.total)} (${byTier.clear.correct}/${byTier.clear.total}) · subtle=${pct(byTier.subtle.correct / byTier.subtle.total)} (${byTier.subtle.correct}/${byTier.subtle.total})`);
        for (const c of DISEASE_CLASSES) {
            const m = result.perClass[c];
            console.log(`[ต้นแบบ6-validation]   ${c.padEnd(15)} P=${pct(m.precision)} R=${pct(m.recall)} F1=${pct(m.f1)} n=${m.support}`);
        }

        expect(result.total).toBe(DISEASE_CLASSES.length * SAMPLES_PER_CLASS);
        expect(result.accuracy).toBeGreaterThanOrEqual(0.85);
        expect(result.meetsTarget).toBe(true);
        expect(macro('f1')).toBeGreaterThanOrEqual(0.8); // guards against a lopsided pass
    });

    test('clear-signature tier ≥ 88% (strong cases must be reliable)', async () => {
        const { byTier } = await getRun();
        expect(byTier.clear.correct / byTier.clear.total).toBeGreaterThanOrEqual(0.88);
    });

    test('no class systematically missed (recall ≥ 0.5 for every class under variation)', async () => {
        // Deliberately ≥0.5 not ≥0.85: POWDERY_MILDEW/VIRUS are honestly weaker at
        // moderate severity for the rule-based baseline (see per-class log). This
        // asserts no class is DEAD, and documents the gap the trained model fills.
        const { result } = await getRun();
        for (const cls of DISEASE_CLASSES) {
            expect(result.perClass[cls].recall).toBeGreaterThanOrEqual(0.5);
        }
    });
});
