/**
 * Tesseract OCR Service
 * Extracts text from uploaded images and PDFs using Tesseract.js
 * 
 * @module services/ocr/tesseract-service
 */

const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const logger = require('../../shared/logger');
const { TESSDATA_DIR, TESSERACT_WORKER_OPTIONS } = require('./tessdata');

/** The two language models every worker in this codebase loads. */
const MODEL_LANGS = ['tha', 'eng'];

/**
 * Thrown by `initialize()` when `terminate()` ran while it was still awaiting
 * `Tesseract.createWorker()`. The worker that call resolved with has already
 * been terminated by the time this is thrown — it is an abort, not an OCR
 * failure.
 */
class TesseractTerminatedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TesseractTerminatedError';
        this.code = 'TESSERACT_TERMINATED';
    }
}

class TesseractService {
    constructor() {
        // Worker pool for performance
        this.scheduler = null;
        this.isInitialized = false;
        // Bumped by every terminate(). initialize() compares it across its
        // one await so a terminate() that landed mid-createWorker is seen.
        this.terminateCount = 0;
        // The initialisation in flight, if any. A second initialize() made
        // while the first still awaits createWorker() joins it instead of
        // building a second scheduler over the first (Task 4 backlog: the
        // first scheduler and its worker were dropped with nobody left to
        // terminate them).
        this.initializing = null;
    }

    /**
     * Initialise once. Concurrent callers share one in-flight attempt; a
     * failed or aborted attempt is forgotten, so the next call tries again.
     * The work itself is `_initializeOnce()`.
     */
    async initialize() {
        if (this.isInitialized) {return;}
        if (this.initializing) {return this.initializing;}
        const attempt = this._initializeOnce();
        this.initializing = attempt;
        try {
            await attempt;
        } finally {
            if (this.initializing === attempt) {
                this.initializing = null;
            }
        }
    }

    /**
     * Initialize the Tesseract scheduler with Thai + English languages.
     *
     * Fix round 2 (I2, task-4-review.md): checks both model files exist
     * BEFORE calling `Tesseract.createWorker()`. A missing/corrupt
     * `${lang}.traineddata` otherwise hangs `createWorker()` forever — see
     * tessdata.js's `errorHandler` doc comment for the exact upstream
     * behaviour this works around (`loadLanguage` rejections are silently
     * swallowed by the library, not surfaced as a promise rejection at
     * all). This turns that hang into an immediate, catchable error, so a
     * misconfigured TESSDATA_PATH surfaces as a failed OCR job (which the
     * caller retries then marks FAILED — spec line 68), never as every scan
     * silently coming back "unreadable".
     */
    async _initializeOnce() {
        try {
            for (const lang of MODEL_LANGS) {
                const modelPath = path.join(TESSDATA_DIR, `${lang}.traineddata`);
                if (!fs.existsSync(modelPath)) {
                    throw new Error(`Tesseract language model not found: ${modelPath} (check TESSDATA_PATH)`);
                }
            }

            // createScheduler() is synchronous, so `this.scheduler` is set
            // before the first await below and terminate() can always see it.
            this.scheduler = Tesseract.createScheduler();
            const terminateCountAtStart = this.terminateCount;

            // Create worker for Thai + English.
            // TESSERACT_WORKER_OPTIONS pins langPath to apps/backend/data/tessdata
            // — the tha.traineddata and eng.traineddata models bundled in this repo
            // and the deployment image (see services/ocr/tessdata.js and
            // data/tessdata/README.md). OCR reads Thai and English offline,
            // reproducibly, with the exact model that was tested and no runtime
            // download from anywhere.
            const worker = await Tesseract.createWorker(
                ['tha', 'eng'],
                undefined,
                TESSERACT_WORKER_OPTIONS,
            );

            // Fix round 4 (task-4-rereview-1.md Important #1): terminate()
            // ran while createWorker() was pending (a document-precheck
            // timeout). The scheduler it tore down no longer owns anything,
            // so this worker would never be terminated by anyone — do it
            // here, then report the abort.
            if (this.terminateCount !== terminateCountAtStart) {
                await worker.terminate();
                throw new TesseractTerminatedError('Tesseract service was terminated while its worker was starting');
            }
            this.scheduler.addWorker(worker);

            this.isInitialized = true;
            logger.info(`Tesseract OCR initialized (Thai + English), langPath=${TESSDATA_DIR}`);
        } catch (error) {
            if (error instanceof TesseractTerminatedError) {
                logger.info(error.message);
            } else {
                logger.error('Failed to initialize Tesseract:', error.message);
            }
            throw error;
        }
    }

    /**
     * Extract text from an image file or buffer
     * @param {string|Buffer} input - File path or Buffer
     * @returns {Promise<Object>} Extracted text and confidence
     */
    async extractText(input) {
        await this.initialize();

        try {
            const startTime = Date.now();

            const result = await this.scheduler.addJob('recognize', input);

            const duration = Date.now() - startTime;
            logger.info(`OCR completed in ${duration}ms, confidence: ${result.data.confidence}%`);

            return {
                success: true,
                text: result.data.text,
                confidence: result.data.confidence,
                words: result.data.words?.map(w => ({
                    text: w.text,
                    confidence: w.confidence,
                    bbox: w.bbox,
                })),
                duration,
            };
        } catch (error) {
            logger.error('OCR extraction failed:', error.message);
            return {
                success: false,
                error: error.message,
                text: '',
                confidence: 0,
            };
        }
    }

    /**
     * Extract text and detect document type based on keywords
     * @param {string|Buffer} input - File path or Buffer
     * @returns {Promise<Object>} Extracted text with detected type
     */
    async extractAndClassify(input) {
        const extraction = await this.extractText(input);

        if (!extraction.success) {
            return extraction;
        }

        const _text = extraction.text.toLowerCase();
        const detectedTypes = [];

        // Thai ID Card Detection
        const idCardPatterns = [
            /\d{1}-\d{4}-\d{5}-\d{2}-\d{1}/,  // Thai ID format
            /บัตรประจำตัวประชาชน/,
            /identification card/i,
            /หมายเลขบัตร/,
        ];
        if (idCardPatterns.some(p => p.test(extraction.text))) {
            detectedTypes.push({ type: 'ID_CARD', confidence: 0.9 });
        }

        // House Registration Detection
        const housePatterns = [
            /ทะเบียนบ้าน/,
            /สำเนาทะเบียนบ้าน/,
            /house registration/i,
            /เลขรหัสประจำบ้าน/,
        ];
        if (housePatterns.some(p => p.test(extraction.text))) {
            detectedTypes.push({ type: 'HOUSE_REGISTRATION', confidence: 0.85 });
        }

        // Farm/Business License Detection
        const licensePatterns = [
            /ใบอนุญาต/,
            /license/i,
            /permit/i,
            /ใบรับรอง/,
            /certificate/i,
        ];
        if (licensePatterns.some(p => p.test(extraction.text))) {
            detectedTypes.push({ type: 'LICENSE', confidence: 0.8 });
        }

        // Medical Certificate Detection
        const medicalPatterns = [
            /ใบรับรองแพทย์/,
            /medical certificate/i,
            /health certificate/i,
            /โรงพยาบาล/,
            /hospital/i,
        ];
        if (medicalPatterns.some(p => p.test(extraction.text))) {
            detectedTypes.push({ type: 'MEDICAL_CERTIFICATE', confidence: 0.85 });
        }

        // Land Title Detection
        const landPatterns = [
            /โฉนด/,
            /นส\.?\s?3/,
            /land title/i,
            /เอกสารสิทธิ์/,
        ];
        if (landPatterns.some(p => p.test(extraction.text))) {
            detectedTypes.push({ type: 'LAND_TITLE', confidence: 0.85 });
        }

        return {
            ...extraction,
            detectedTypes: detectedTypes.sort((a, b) => b.confidence - a.confidence),
            primaryType: detectedTypes[0]?.type || 'UNKNOWN',
        };
    }

    /**
     * Terminate all workers (cleanup). Safe to call more than once — after
     * the first successful terminate, `this.scheduler` is cleared so a
     * second call is a no-op instead of re-terminating an already-torn-down
     * scheduler (Fix round 2 / I1: callers that own a private instance, see
     * `services/document-precheck/extract.js`, call this from more than one
     * place — the timeout handler and the top-level cleanup — on purpose).
     */
    async terminate() {
        this.terminateCount += 1;
        // An attempt still in flight is now doomed (it will see terminateCount
        // move and abort); a call made from here on starts a fresh one.
        this.initializing = null;
        if (this.scheduler) {
            const scheduler = this.scheduler;
            this.scheduler = null;
            this.isInitialized = false;
            await scheduler.terminate();
            logger.info('Tesseract workers terminated');
        }
    }
}

// Fix round 2 (I1): `services/document-precheck/extract.js` no longer
// shares this module-level singleton across extraction calls — sharing it
// meant one call's cleanup (timeout or normal) could terminate a worker
// another call still owned. Callers that need an OCR session now
// `new TesseractService()` for themselves (one per `extractDocument` call,
// reused across that call's pages, terminated once when that call ends).
// The singleton below is kept only for any caller that genuinely wants one
// shared, long-lived worker; none in this codebase currently does.
module.exports = new TesseractService();
module.exports.TesseractService = TesseractService;
module.exports.TesseractTerminatedError = TesseractTerminatedError;
