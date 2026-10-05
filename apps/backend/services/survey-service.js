'use strict';

/**
 * Survey Service — สัญญา C05F680149 ต้นแบบที่ 2 "ระบบสำรวจความต้องการ (1 ชุด)"
 * (2.1 แบบสอบถามดิจิทัล 4 ภาค · 2.2 ระบบบันทึกการสัมภาษณ์ผู้เชี่ยวชาญ)
 * + ต้นแบบที่ 3.1 text-mining เบื้องต้นบนคำตอบปลายเปิด.
 *
 * ERP document semantics (mirrors quotation-service):
 *   - SurveyTemplate: master document; status machine DRAFT→ACTIVE→CLOSED with
 *     frozen enum + per-transition Set guard + typed err.code + idempotent
 *     no-op on same-state repeats.
 *   - SurveyResponse: POSTED document — created in one $transaction with its
 *     answer lines, immutable afterwards (no update path exists by design).
 *   - PII invariant: free-text answers / transcripts / key insights pass
 *     maskThaiIdsInText before persist; actor linkage is User.id (UUID) only.
 *   - Tenancy: models are in TENANT_SCOPED_MODELS — organizationId auto-injects
 *     from request context (ADR-014); this service never sets it manually.
 * Errors carry .statusCode/.code at the throw site (sendServiceError-safe).
 */

const { z } = require('zod');
const { prisma } = require('./prisma-database');
const logger = require('../shared/logger');
const { maskThaiIdsInText } = require('../utils/field-encryption');
const { neutralizeCsvFormula } = require('../shared/csv-utils');
const { extractThaiKeywords } = require('../utils/thai-keywords');

const TEMPLATE_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    CLOSED: 'CLOSED',
});

const REGIONS = Object.freeze(['NORTH', 'CENTRAL', 'NORTHEAST', 'SOUTH']); // 4 ภาคตามสัญญา
const TARGET_GROUPS = Object.freeze(['FARMER', 'EXPERT', 'DTAM_STAFF', 'OPERATOR']);
const QUESTION_TYPES = Object.freeze(['TEXT', 'TEXTAREA', 'RATING_5', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'NUMBER']);
const CHOICE_TYPES = new Set(['SINGLE_CHOICE', 'MULTI_CHOICE']);

function httpError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

// ── Zod schemas ─────────────────────────────────────────────────────

const questionSchema = z.object({
    questionText: z.string().trim().min(1),
    questionType: z.enum(QUESTION_TYPES).default('TEXT'),
    section: z.string().trim().max(200).optional(),
    choices: z.array(z.string().trim().min(1)).min(2).optional(),
    isRequired: z.boolean().default(true),
}).refine(
    (q) => !CHOICE_TYPES.has(q.questionType) || Array.isArray(q.choices),
    { message: 'choice questions require a choices array' },
);

const createTemplateSchema = z.object({
    code: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(5000).optional(),
    targetGroup: z.enum(TARGET_GROUPS).default('FARMER'),
    questions: z.array(questionSchema).min(1).max(100),
});

const submitResponseSchema = z.object({
    region: z.enum(REGIONS),
    province: z.string().trim().max(100).optional(),
    answers: z.array(z.object({
        questionId: z.string().trim().min(1),
        value: z.union([z.string(), z.number(), z.array(z.string())]),
    })).min(1).max(200),
});

const createInterviewSchema = z.object({
    title: z.string().trim().min(1).max(500),
    intervieweeName: z.string().trim().min(1).max(300),
    intervieweeOrg: z.string().trim().max(300).optional(),
    intervieweeRole: z.string().trim().max(300).optional(),
    interviewDate: z.coerce.date(),
    mode: z.enum(['ONSITE', 'ONLINE']).default('ONSITE'),
    transcript: z.string().trim().min(1),
    keyInsights: z.array(z.string().trim().min(1)).max(50).optional(),
});

// ── Template master data ────────────────────────────────────────────

async function createTemplate(payload, { actor } = {}) {
    const parsed = createTemplateSchema.safeParse(payload);
    if (!parsed.success) {
        throw httpError(400, 'SURVEY_TEMPLATE_INVALID',
            `Invalid survey template: ${parsed.error.issues.map(i => i.message).join('; ')}`);
    }
    const { questions, ...template } = parsed.data;

    try {
        return await prisma.$transaction(async (tx) => {
            const created = await tx.surveyTemplate.create({
                data: {
                    ...template,
                    status: TEMPLATE_STATUS.DRAFT,
                    createdBy: actor?.id || null,
                },
            });
            await tx.surveyQuestion.createMany({
                data: questions.map((q, i) => ({
                    templateId: created.id,
                    sortOrder: i + 1,
                    section: q.section || null,
                    questionText: q.questionText,
                    questionType: q.questionType,
                    choices: q.choices || null,
                    isRequired: q.isRequired,
                })),
            });
            logger.info(`[Survey] template created: ${created.id} (${template.code}, ${questions.length} questions)`);
            return created;
        });
    } catch (error) {
        // @@unique([organizationId, code]) → duplicate code must be a 409, not a
        // 500 on client input (PR-666 review).
        if (error.code === 'P2002') {
            throw httpError(409, 'SURVEY_TEMPLATE_CODE_EXISTS',
                `A survey template with code "${template.code}" already exists`);
        }
        throw error;
    }
}

async function _getTemplateOr404(templateId, { includeQuestions = false } = {}) {
    const template = await prisma.surveyTemplate.findFirst({
        where: { id: templateId, isDeleted: false },
        ...(includeQuestions ? { include: { questions: { orderBy: { sortOrder: 'asc' } } } } : {}),
    });
    if (!template) {
        throw httpError(404, 'SURVEY_NOT_FOUND', 'Survey template not found');
    }
    return template;
}

/** DRAFT → ACTIVE (idempotent when already ACTIVE) */
async function activateTemplate(templateId) {
    const template = await _getTemplateOr404(templateId);
    if (template.status === TEMPLATE_STATUS.ACTIVE) { return template; } // idempotent no-op
    const acceptable = new Set([TEMPLATE_STATUS.DRAFT]);
    if (!acceptable.has(template.status)) {
        throw httpError(409, 'INVALID_SURVEY_TEMPLATE_STATUS',
            `Cannot activate a ${template.status} template`);
    }
    return prisma.surveyTemplate.update({
        where: { id: templateId },
        data: { status: TEMPLATE_STATUS.ACTIVE, activatedAt: new Date() },
    });
}

/** ACTIVE → CLOSED (idempotent when already CLOSED) */
async function closeTemplate(templateId) {
    const template = await _getTemplateOr404(templateId);
    if (template.status === TEMPLATE_STATUS.CLOSED) { return template; } // idempotent no-op
    const acceptable = new Set([TEMPLATE_STATUS.ACTIVE]);
    if (!acceptable.has(template.status)) {
        throw httpError(409, 'INVALID_SURVEY_TEMPLATE_STATUS',
            `Cannot close a ${template.status} template`);
    }
    return prisma.surveyTemplate.update({
        where: { id: templateId },
        data: { status: TEMPLATE_STATUS.CLOSED, closedAt: new Date() },
    });
}

async function listTemplates({ status } = {}) {
    return prisma.surveyTemplate.findMany({
        where: { isDeleted: false, ...(status ? { status } : {}) },
        include: { questions: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
    });
}

/** Templates open for respondents (ACTIVE only), optionally by target group. */
async function listActiveTemplates({ targetGroup } = {}) {
    return prisma.surveyTemplate.findMany({
        where: {
            isDeleted: false,
            status: TEMPLATE_STATUS.ACTIVE,
            ...(targetGroup ? { targetGroup } : {}),
        },
        include: { questions: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
    });
}

async function getTemplate(templateId) {
    return _getTemplateOr404(templateId, { includeQuestions: true });
}

// ── Response posting (immutable document) ───────────────────────────

function _validateAnswerValue(question, value) {
    switch (question.questionType) {
        case 'RATING_5': {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 1 || n > 5) {
                throw httpError(400, 'INVALID_ANSWER',
                    `Question ${question.id}: rating must be 1-5`);
            }
            return { valueText: null, valueNumber: n };
        }
        case 'NUMBER': {
            const n = Number(value);
            if (!Number.isFinite(n)) {
                throw httpError(400, 'INVALID_ANSWER',
                    `Question ${question.id}: value must be a number`);
            }
            return { valueText: null, valueNumber: n };
        }
        case 'SINGLE_CHOICE': {
            const choices = Array.isArray(question.choices) ? question.choices : [];
            if (typeof value !== 'string' || !choices.includes(value)) {
                throw httpError(400, 'INVALID_ANSWER',
                    `Question ${question.id}: value must be one of the defined choices`);
            }
            return { valueText: value, valueNumber: null };
        }
        case 'MULTI_CHOICE': {
            const choices = Array.isArray(question.choices) ? question.choices : [];
            const values = Array.isArray(value) ? value : [value];
            if (values.length === 0 || !values.every(v => typeof v === 'string' && choices.includes(v))) {
                throw httpError(400, 'INVALID_ANSWER',
                    `Question ${question.id}: all values must be defined choices`);
            }
            return { valueText: JSON.stringify(values), valueNumber: null };
        }
        case 'TEXT':
        case 'TEXTAREA':
        default: {
            const text = String(value ?? '').trim();
            if (text === '') {
                throw httpError(400, 'INVALID_ANSWER', `Question ${question.id}: empty text answer`);
            }
            // PII invariant: free text can contain typed national ids — mask at write
            return { valueText: maskThaiIdsInText(text), valueNumber: null };
        }
    }
}

async function submitResponse(templateId, payload, { actor } = {}) {
    const template = await _getTemplateOr404(templateId, { includeQuestions: true });
    if (template.status !== TEMPLATE_STATUS.ACTIVE) {
        throw httpError(409, 'SURVEY_NOT_ACTIVE', 'Survey is not accepting responses');
    }

    const parsed = submitResponseSchema.safeParse(payload);
    if (!parsed.success) {
        throw httpError(400, 'SURVEY_RESPONSE_INVALID',
            `Invalid response: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const { region, province, answers } = parsed.data;

    const questionById = new Map((template.questions || []).map(q => [q.id, q]));

    // Every answered question must belong to this template
    for (const answer of answers) {
        if (!questionById.has(answer.questionId)) {
            throw httpError(400, 'INVALID_QUESTION',
                `Question ${answer.questionId} does not belong to this survey`);
        }
    }

    // Reject duplicate questionIds: SurveyAnswer has @@unique([responseId,
    // questionId]) so a duplicate would throw Prisma P2002 mid-transaction and
    // surface as a 500 on client input (PR-666 review). Guard it as a 400.
    const seen = new Set();
    for (const answer of answers) {
        if (seen.has(answer.questionId)) {
            throw httpError(400, 'DUPLICATE_QUESTION',
                `Question ${answer.questionId} answered more than once`);
        }
        seen.add(answer.questionId);
    }

    // Every required question must be answered
    const answeredIds = new Set(answers.map(a => a.questionId));
    const missing = (template.questions || [])
        .filter(q => q.isRequired && !answeredIds.has(q.id))
        .map(q => q.id);
    if (missing.length > 0) {
        throw httpError(400, 'MISSING_REQUIRED_ANSWERS',
            `Required questions not answered: ${missing.join(', ')}`);
    }

    // Type-validate all lines BEFORE opening the transaction (all-or-nothing)
    const lines = answers.map(answer => ({
        questionId: answer.questionId,
        ..._validateAnswerValue(questionById.get(answer.questionId), answer.value),
    }));

    return prisma.$transaction(async (tx) => {
        const response = await tx.surveyResponse.create({
            data: {
                templateId,
                respondentUserId: actor?.id || null,
                respondentType: template.targetGroup,
                region,
                // province เป็น free-text (ผู้ตอบพิมพ์เองได้) → mask เลขบัตร 13 หลัก
                // ที่จุด persist เหมือน answers/transcript/keyInsights กันหลุดเข้า
                // Data Lake export (PDPA invariant "PII columns absent").
                province: province ? maskThaiIdsInText(province) : null,
                status: 'SUBMITTED',
                submittedAt: new Date(),
            },
        });
        await tx.surveyAnswer.createMany({
            data: lines.map((line) => ({ responseId: response.id, ...line })),
        });
        logger.info(`[Survey] response posted: ${response.id} (template ${templateId}, ${lines.length} answers, ${region})`);
        return response;
    });
}

// ── Analytics + export ──────────────────────────────────────────────

async function _getResponsesWithAnswers(templateId) {
    return prisma.surveyResponse.findMany({
        where: { templateId },
        include: { answers: true },
        orderBy: { submittedAt: 'asc' },
    });
}

async function getTemplateStats(templateId) {
    const template = await _getTemplateOr404(templateId, { includeQuestions: true });
    const responses = await _getResponsesWithAnswers(templateId);

    const regionBreakdown = {};
    for (const response of responses) {
        regionBreakdown[response.region] = (regionBreakdown[response.region] || 0) + 1;
    }

    const questions = (template.questions || []).map((question) => {
        const answers = responses
            .flatMap(r => r.answers)
            .filter(a => a.questionId === question.id);

        const base = {
            questionId: question.id,
            questionText: question.questionText,
            questionType: question.questionType,
            count: answers.length,
        };

        if (question.questionType === 'RATING_5' || question.questionType === 'NUMBER') {
            const numbers = answers.map(a => a.valueNumber).filter(n => Number.isFinite(n));
            const sum = numbers.reduce((acc, n) => acc + n, 0);
            return {
                ...base,
                average: numbers.length ? Math.round((sum / numbers.length) * 100) / 100 : null,
                min: numbers.length ? Math.min(...numbers) : null,
                max: numbers.length ? Math.max(...numbers) : null,
            };
        }

        if (CHOICE_TYPES.has(question.questionType)) {
            const choiceCounts = {};
            for (const answer of answers) {
                let values = [answer.valueText];
                if (question.questionType === 'MULTI_CHOICE') {
                    try { values = JSON.parse(answer.valueText); } catch { values = [answer.valueText]; }
                }
                for (const v of values) {
                    if (v) { choiceCounts[v] = (choiceCounts[v] || 0) + 1; }
                }
            }
            return { ...base, choiceCounts };
        }

        // TEXT/TEXTAREA → text-mining 3.1 (Thai keyword frequency)
        return {
            ...base,
            topKeywords: extractThaiKeywords(answers.map(a => a.valueText)),
        };
    });

    return {
        templateId,
        title: template.title,
        status: template.status,
        totalResponses: responses.length,
        regionBreakdown,
        questions,
    };
}

async function exportResponsesCsv(templateId) {
    const template = await _getTemplateOr404(templateId, { includeQuestions: true });
    const responses = await _getResponsesWithAnswers(templateId);
    const questions = template.questions || [];

    const cell = (value) => {
        const text = neutralizeCsvFormula(String(value ?? ''));
        return `"${text.replace(/"/g, '""')}"`;
    };

    const header = ['response_id', 'submitted_at', 'region', 'province',
        ...questions.map(q => q.questionText)];
    const rows = [header.map(cell).join(',')];

    for (const response of responses) {
        const answerByQuestion = new Map(response.answers.map(a => [a.questionId, a]));
        const row = [
            response.id,
            response.submittedAt ? new Date(response.submittedAt).toISOString() : '',
            response.region,
            response.province || '',
            ...questions.map((q) => {
                const answer = answerByQuestion.get(q.id);
                if (!answer) { return ''; }
                return answer.valueNumber ?? answer.valueText ?? '';
            }),
        ];
        rows.push(row.map(cell).join(','));
    }

    // BOM so Thai text opens correctly in Excel
    return `${'﻿'}${rows.join('\n')}`;
}

// ── Expert interviews (ต้นแบบ 2.2) ──────────────────────────────────

async function createInterview(payload, { actor } = {}) {
    const parsed = createInterviewSchema.safeParse(payload);
    if (!parsed.success) {
        throw httpError(400, 'INTERVIEW_INVALID',
            `Invalid interview record: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const data = parsed.data;

    return prisma.expertInterview.create({
        data: {
            title: data.title,
            intervieweeName: data.intervieweeName,
            intervieweeOrg: data.intervieweeOrg || null,
            intervieweeRole: data.intervieweeRole || null,
            interviewDate: data.interviewDate,
            mode: data.mode,
            // Free text can contain typed national ids — mask before persist
            transcript: maskThaiIdsInText(data.transcript),
            keyInsights: (data.keyInsights || []).map(s => maskThaiIdsInText(s)),
            recordedBy: actor?.id || null,
        },
    });
}

async function listInterviews() {
    return prisma.expertInterview.findMany({
        where: { isDeleted: false },
        orderBy: { interviewDate: 'desc' },
    });
}

module.exports = {
    TEMPLATE_STATUS,
    REGIONS,
    TARGET_GROUPS,
    QUESTION_TYPES,
    createTemplate,
    activateTemplate,
    closeTemplate,
    listTemplates,
    listActiveTemplates,
    getTemplate,
    submitResponse,
    getTemplateStats,
    exportResponsesCsv,
    createInterview,
    listInterviews,
};
