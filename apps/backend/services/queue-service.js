const Queue = require('bull');
const path = require('path');
const fs = require('fs');

const logger = require('../shared/logger');
const checkSlaBreaches = require('../jobs/sla-processor');

let slaQueue = null;
let pdfQueue = null;
let webhookDlqQueue = null;
let precheckQueue = null;

/**
 * Document pre-check (services/document-precheck/service.js). One job per
 * in-scope upload; the processor runs sandboxed (its own child process) one
 * at a time. attempts: 2 — the processor rethrows an extraction failure once
 * so it is retried, then writes FAILED (see the RETRY note in service.js).
 * The job timeout sits above extraction's own 60 s timeout on purpose.
 */
const PRECHECK_QUEUE_NAME = 'document-precheck';
const PRECHECK_JOB_OPTIONS = Object.freeze({ attempts: 2, backoff: 30000, timeout: 120000, removeOnComplete: 500 });

function loadWebhookDlqProcessor() {
    const processorPath = path.join(__dirname, '../jobs/webhook-dlq-processor.js');
    if (!fs.existsSync(processorPath)) {
        return null;
    }

    try {
        return require(processorPath);
    } catch (error) {
        logger.error('[Queue] Failed to load webhook DLQ processor:', error.message);
        return null;
    }
}

function bindStandardQueueEvents(queue, label) {
    queue.on('error', (error) => {
        logger.warn(`[Queue] ${label} error: ${error.message}`);
    });

    queue.on('failed', (job, error) => {
        logger.error(`[Queue] ${label} job ${job.id} failed:`, error.message);
    });
}

/**
 * Bull's message for a job it failed because it stalled more often than
 * `maxStalledCount` allows (bull 4.16.5 lib/queue.js moveUnlockedJobsToWait).
 */
const BULL_STALLED_LIMIT_MESSAGE = 'job stalled more than allowable limit';

/**
 * Has this job failed for good (no retry left)? Read from Bull's own state,
 * not from `attemptsMade`: Bull fails a job that stalled past its limit
 * WITHOUT counting an attempt, so attemptsMade < attempts there although the
 * job never runs again. Bull emits `failed` after moveToFailed, so a job
 * with a retry left already sits in `delayed`/`wait` (isFailed false) and a
 * spent one in `failed` (isFailed true). If Redis cannot answer, fall back
 * to the stall message or the attempt count.
 *
 * @param {object} job Bull job
 * @param {Error} [error] the error Bull emitted with it
 * @returns {Promise<boolean>}
 */
async function isTerminallyFailed(job, error) {
    try {
        return Boolean(await job.isFailed());
    } catch (stateError) {
        logger.warn(`[Queue] Document pre-check job ${job.id} state unreadable (${stateError.message}); deciding from the event`);
        const attempts = (job.opts && job.opts.attempts) || 1;
        return (error && error.message === BULL_STALLED_LIMIT_MESSAGE) || (job.attemptsMade || 0) >= attempts;
    }
}

function initPrecheckQueue(redisUrl) {
    const processorPath = path.join(__dirname, '../jobs/document-precheck-processor.js');
    if (!fs.existsSync(processorPath)) {
        precheckQueue = null;
        logger.warn(`[Queue] Document pre-check processor missing at ${processorPath}; skipping`);
        return;
    }

    try {
        logger.info('[Queue] Initializing document pre-check queue...');

        precheckQueue = new Queue(PRECHECK_QUEUE_NAME, redisUrl, {
            redis: {
                maxRetriesPerRequest: 3,
                enableReadyCheck: false,
            },
            defaultJobOptions: { ...PRECHECK_JOB_OPTIONS },
        });

        precheckQueue.process(1, processorPath);
        precheckQueue.on('ready', () => logger.info('[Queue] Document pre-check queue ready'));
        bindStandardQueueEvents(precheckQueue, 'Document pre-check');
        // A job that failed for good without the processor writing an outcome
        // (crashed worker, this queue's own timeout, a stall past
        // maxStalledCount) would otherwise leave its row PENDING forever.
        // failPrecheck is a no-op unless the row is still PENDING.
        precheckQueue.on('failed', (job, error) => {
            if (!job || !job.data) {
                return undefined;
            }
            const { precheckId } = job.data;
            return isTerminallyFailed(job, error)
                .then((terminal) => {
                    if (!terminal) {
                        return undefined;
                    }
                    const { failPrecheck } = require('./document-precheck/service');
                    return failPrecheck(precheckId);
                })
                .catch((failure) => {
                    logger.error(`[Queue] Document pre-check ${precheckId} could not be marked FAILED: ${failure.message}`);
                });
        });
    } catch (error) {
        precheckQueue = null;
        logger.warn(`[Queue] Document pre-check queue unavailable: ${error.message}`);
    }
}

const initQueues = () => {
    // Bull creates its own connection, so we only need the Redis URL here.
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

    try {
        logger.info('[Queue] Initializing SLA monitor queue...');

        slaQueue = new Queue('sla-monitor', redisUrl, {
            redis: {
                maxRetriesPerRequest: 3,
                enableReadyCheck: false,
            },
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: 100,
            },
        });

        slaQueue.process(checkSlaBreaches);
        slaQueue.on('ready', () => {
            logger.info('[Queue] SLA queue ready');
            slaQueue.add({}, { repeat: { cron: '0 8 * * *' }, jobId: 'daily-sla-check' })
                .then(() => logger.info('[Queue] SLA daily check scheduled'))
                .catch((error) => logger.error('[Queue] SLA schedule error:', error));
        });
        bindStandardQueueEvents(slaQueue, 'SLA');

        const dlqEnabled = String(process.env.ENABLE_WEBHOOK_DLQ || 'false').trim().toLowerCase() === 'true';
        const processDlqWebhooks = loadWebhookDlqProcessor();
        if (dlqEnabled && typeof processDlqWebhooks === 'function') {
            logger.info('[Queue] Initializing webhook DLQ...');

            webhookDlqQueue = new Queue('webhook-dlq', redisUrl, {
                redis: {
                    maxRetriesPerRequest: 3,
                    enableReadyCheck: false,
                },
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: 100,
                },
            });

            webhookDlqQueue.process(processDlqWebhooks);
            webhookDlqQueue.on('ready', () => {
                logger.info('[Queue] Webhook DLQ ready');
                webhookDlqQueue.add({}, { repeat: { cron: '0 2 * * *' }, jobId: 'daily-webhook-dlq' })
                    .catch((error) => logger.error('[Queue] DLQ schedule error:', error));
            });
            bindStandardQueueEvents(webhookDlqQueue, 'Webhook DLQ');
        } else {
            logger.info('[Queue] Webhook DLQ disabled or processor missing; skipping initialization');
        }

        // Before the PDF block: that block returns early when its processor
        // file is absent, and it is absent in this tree.
        initPrecheckQueue(redisUrl);

        const pdfProcessorPath = path.join(__dirname, '../jobs/pdf-processor.js');
        if (!fs.existsSync(pdfProcessorPath)) {
            pdfQueue = null;
            logger.warn(`[Queue] PDF processor missing at ${pdfProcessorPath}; skipping PDF queue initialization`);
            return;
        }

        try {
            logger.info('[Queue] Initializing PDF generator queue...');

            pdfQueue = new Queue('pdf-generator', redisUrl, {
                redis: {
                    maxRetriesPerRequest: 3,
                    enableReadyCheck: false,
                },
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: 100,
                },
            });

            // Run PDF generation in a child process to avoid blocking the API server.
            pdfQueue.process(2, pdfProcessorPath);
            pdfQueue.on('ready', () => logger.info('[Queue] PDF queue ready'));
            bindStandardQueueEvents(pdfQueue, 'PDF');
        } catch (error) {
            pdfQueue = null;
            logger.warn(`[Queue] PDF queue unavailable, falling back to inline PDF generation: ${error.message}`);
        }
    } catch (error) {
        logger.error('[Queue] Failed to initialize queues:', error);
    }
};

const getSlaQueue = () => slaQueue;
const getPdfQueue = () => pdfQueue;
const getPrecheckQueue = () => precheckQueue;

module.exports = {
    initQueues,
    getSlaQueue,
    getPdfQueue,
    getPrecheckQueue,
    PRECHECK_QUEUE_NAME,
    PRECHECK_JOB_OPTIONS,
};
