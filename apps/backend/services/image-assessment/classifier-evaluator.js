'use strict';

/**
 * Classifier Evaluator — สัญญา C05F680149 ต้นแบบที่ 6 (KPI ≥85%/โมดูล).
 * Confusion matrix + per-class precision/recall + overall accuracy from
 * labelled (actual, predicted) pairs. This is the harness that MEASURES the
 * contractual ≥85% accuracy on the pilot's labelled image set — pure, no ML.
 */

function httpError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

/**
 * @param {Array<{actual:string, predicted:string}>} samples
 * @param {string[]} classes — the label space
 * @param {{target?:number}} options
 */
function evaluateClassifier(samples, classes, { target = 0.85 } = {}) {
    const labels = Array.isArray(classes) ? classes : [];
    const labelSet = new Set(labels);
    const list = Array.isArray(samples) ? samples : [];

    // Confusion matrix: confusionMatrix[actual][predicted] = count
    const confusionMatrix = {};
    for (const a of labels) {
        confusionMatrix[a] = {};
        for (const p of labels) { confusionMatrix[a][p] = 0; }
    }

    let correct = 0;
    for (const sample of list) {
        if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
            throw httpError(400, 'EVAL_SAMPLE_INVALID',
                'Each sample must be an object { actual, predicted }');
        }
        const { actual, predicted } = sample;
        if (!labelSet.has(actual) || !labelSet.has(predicted)) {
            throw httpError(400, 'EVAL_LABEL_UNKNOWN',
                `Sample uses a label outside the class list: actual=${actual}, predicted=${predicted}`);
        }
        confusionMatrix[actual][predicted] += 1;
        if (actual === predicted) { correct += 1; }
    }

    const total = list.length;
    const accuracy = total === 0 ? 0 : correct / total;

    const perClass = {};
    for (const cls of labels) {
        const tp = confusionMatrix[cls][cls];
        let fp = 0; // predicted cls but actual something else
        let fn = 0; // actual cls but predicted something else
        for (const other of labels) {
            if (other === cls) { continue; }
            fp += confusionMatrix[other][cls];
            fn += confusionMatrix[cls][other];
        }
        const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
        const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
        const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
        perClass[cls] = {
            support: tp + fn,
            precision: Number(precision.toFixed(4)),
            recall: Number(recall.toFixed(4)),
            f1: Number(f1.toFixed(4)),
        };
    }

    return {
        classes: labels,
        total,
        correct,
        accuracy, // full precision — callers format for display
        target,
        meetsTarget: total > 0 && accuracy >= target,
        confusionMatrix,
        perClass,
    };
}

module.exports = { evaluateClassifier };
