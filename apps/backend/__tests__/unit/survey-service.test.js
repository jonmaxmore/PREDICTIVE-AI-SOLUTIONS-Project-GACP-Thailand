'use strict';

/**
 * Survey Service — สัญญา C05F680149 ต้นแบบที่ 2 "ระบบสำรวจความต้องการ (1 ชุด)"
 *
 * ERP document contract under test (contract C05F680149 acceptance mapping ข้อ 2):
 *   - SurveyTemplate = master document with status machine DRAFT→ACTIVE→CLOSED
 *     (frozen enum + per-transition Set guard + typed err.code + idempotent
 *     no-op — mirrors quotation-service).
 *   - SurveyResponse = POSTED document: submit validates region (4 ภาค),
 *     required questions, per-type answers, and question ownership; free-text
 *     answers are masked with maskThaiIdsInText before persist (PII invariant).
 *   - Stats = per-question aggregates + Thai keyword extraction (text-mining
 *     3.1, stdlib Intl.Segmenter).
 *   - CSV export uses the shared formula-injection guard (CWE-1236).
 *   - ExpertInterview transcript + keyInsights masked at write.
 * Errors carry .statusCode/.code at the throw site.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockTemplateCreate = jest.fn();
const mockTemplateFindFirst = jest.fn();
const mockTemplateFindMany = jest.fn();
const mockTemplateUpdate = jest.fn();
const mockQuestionCreate = jest.fn();
const mockQuestionCreateMany = jest.fn();
const mockResponseCreate = jest.fn();
const mockResponseFindMany = jest.fn();
const mockAnswerCreate = jest.fn();
const mockAnswerCreateMany = jest.fn();
const mockInterviewCreate = jest.fn();
const mockInterviewFindMany = jest.fn();

const txMock = {
    surveyTemplate: { create: (...a) => mockTemplateCreate(...a), update: (...a) => mockTemplateUpdate(...a) },
    surveyQuestion: { create: (...a) => mockQuestionCreate(...a), createMany: (...a) => mockQuestionCreateMany(...a) },
    surveyResponse: { create: (...a) => mockResponseCreate(...a) },
    surveyAnswer: { create: (...a) => mockAnswerCreate(...a), createMany: (...a) => mockAnswerCreateMany(...a) },
};

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        surveyTemplate: {
            create: (...a) => mockTemplateCreate(...a),
            findFirst: (...a) => mockTemplateFindFirst(...a),
            findMany: (...a) => mockTemplateFindMany(...a),
            update: (...a) => mockTemplateUpdate(...a),
        },
        surveyQuestion: { create: (...a) => mockQuestionCreate(...a), createMany: (...a) => mockQuestionCreateMany(...a) },
        surveyResponse: {
            create: (...a) => mockResponseCreate(...a),
            findMany: (...a) => mockResponseFindMany(...a),
        },
        surveyAnswer: { create: (...a) => mockAnswerCreate(...a), createMany: (...a) => mockAnswerCreateMany(...a) },
        expertInterview: {
            create: (...a) => mockInterviewCreate(...a),
            findMany: (...a) => mockInterviewFindMany(...a),
        },
        $transaction: async (fn) => fn(txMock),
    },
}));

const surveyService = require('../../services/survey-service');
const { extractThaiKeywords } = require('../../utils/thai-keywords');

const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR = { id: 'user-uuid-1', role: 'ADMIN' };

function templateWithQuestions(overrides = {}) {
    return {
        id: TEMPLATE_ID,
        code: 'FARMER-NEEDS-2569',
        title: 'แบบสำรวจความต้องการเกษตรกร',
        targetGroup: 'FARMER',
        status: 'ACTIVE',
        isDeleted: false,
        questions: [
            { id: 'q1', questionText: 'ปลูกสมุนไพรชนิดใด', questionType: 'TEXT', isRequired: true, sortOrder: 1 },
            { id: 'q2', questionText: 'ความพึงพอใจต่อระบบ', questionType: 'RATING_5', isRequired: true, sortOrder: 2 },
            { id: 'q3', questionText: 'ช่องทางการขาย', questionType: 'SINGLE_CHOICE', choices: ['ตลาดสด', 'ออนไลน์', 'สหกรณ์'], isRequired: false, sortOrder: 3 },
            { id: 'q4', questionText: 'พื้นที่ปลูก (ไร่)', questionType: 'NUMBER', isRequired: false, sortOrder: 4 },
        ],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockTemplateCreate.mockImplementation(async ({ data }) => ({ id: TEMPLATE_ID, ...data }));
    mockQuestionCreate.mockImplementation(async ({ data }) => ({ id: `q-${data.sortOrder}`, ...data }));
    mockResponseCreate.mockImplementation(async ({ data }) => ({ id: 'resp-1', ...data }));
    mockAnswerCreate.mockImplementation(async ({ data }) => ({ id: `ans-${data.questionId}`, ...data }));
    mockQuestionCreateMany.mockImplementation(async ({ data }) => ({ count: data.length }));
    mockAnswerCreateMany.mockImplementation(async ({ data }) => ({ count: data.length }));
    mockInterviewCreate.mockImplementation(async ({ data }) => ({ id: 'int-1', ...data }));
});

describe('survey-service.createTemplate', () => {
    test('valid payload creates template + questions inside one transaction', async () => {
        const result = await surveyService.createTemplate({
            code: 'FARMER-NEEDS-2569',
            title: 'แบบสำรวจความต้องการเกษตรกร 4 ภาค',
            targetGroup: 'FARMER',
            questions: [
                { questionText: 'ปลูกอะไร', questionType: 'TEXT', isRequired: true },
                { questionText: 'พึงพอใจแค่ไหน', questionType: 'RATING_5', isRequired: true },
            ],
        }, { actor: ACTOR });

        expect(result.id).toBe(TEMPLATE_ID);
        expect(mockTemplateCreate).toHaveBeenCalledTimes(1);
        // N questions cost ONE insert (N+1 batching, Step 3)
        expect(mockQuestionCreate).not.toHaveBeenCalled();
        expect(mockQuestionCreateMany).toHaveBeenCalledTimes(1);
        const questionRows = mockQuestionCreateMany.mock.calls[0][0].data;
        expect(questionRows).toHaveLength(2);
        // createdBy stamps the actor UUID (never a national id)
        expect(mockTemplateCreate.mock.calls[0][0].data.createdBy).toBe('user-uuid-1');
        // questions get 1-based sortOrder
        expect(questionRows[0].sortOrder).toBe(1);
        expect(questionRows[1].sortOrder).toBe(2);
    });

    test('zero questions → 400 SURVEY_TEMPLATE_INVALID', async () => {
        await expect(surveyService.createTemplate({
            code: 'X', title: 'ว่าง', questions: [],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 400, code: 'SURVEY_TEMPLATE_INVALID' });
    });

    test('duplicate code (Prisma P2002) → 409 SURVEY_TEMPLATE_CODE_EXISTS (not 500)', async () => {
        const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        mockTemplateCreate.mockRejectedValueOnce(p2002);
        await expect(surveyService.createTemplate({
            code: 'DUP', title: 'ซ้ำ',
            questions: [{ questionText: 'q', questionType: 'TEXT' }],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 409, code: 'SURVEY_TEMPLATE_CODE_EXISTS' });
    });

    test('choice question without choices → 400 SURVEY_TEMPLATE_INVALID', async () => {
        await expect(surveyService.createTemplate({
            code: 'X', title: 'มีตัวเลือกแต่ไม่ใส่ choices',
            questions: [{ questionText: 'เลือก', questionType: 'SINGLE_CHOICE' }],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 400, code: 'SURVEY_TEMPLATE_INVALID' });
    });
});

describe('survey-service template status machine (DRAFT→ACTIVE→CLOSED)', () => {
    test('activate: DRAFT → ACTIVE stamps activatedAt', async () => {
        mockTemplateFindFirst.mockResolvedValue({ id: TEMPLATE_ID, status: 'DRAFT', isDeleted: false });
        mockTemplateUpdate.mockImplementation(async ({ data }) => ({ id: TEMPLATE_ID, ...data }));

        const result = await surveyService.activateTemplate(TEMPLATE_ID);
        expect(result.status).toBe('ACTIVE');
        expect(mockTemplateUpdate.mock.calls[0][0].data.activatedAt).toBeInstanceOf(Date);
    });

    test('activate: already ACTIVE → idempotent no-op (no update call)', async () => {
        mockTemplateFindFirst.mockResolvedValue({ id: TEMPLATE_ID, status: 'ACTIVE', isDeleted: false });
        const result = await surveyService.activateTemplate(TEMPLATE_ID);
        expect(result.status).toBe('ACTIVE');
        expect(mockTemplateUpdate).not.toHaveBeenCalled();
    });

    test('activate: CLOSED → 409 INVALID_SURVEY_TEMPLATE_STATUS', async () => {
        mockTemplateFindFirst.mockResolvedValue({ id: TEMPLATE_ID, status: 'CLOSED', isDeleted: false });
        await expect(surveyService.activateTemplate(TEMPLATE_ID))
            .rejects.toMatchObject({ statusCode: 409, code: 'INVALID_SURVEY_TEMPLATE_STATUS' });
    });

    test('close: ACTIVE → CLOSED; DRAFT → 409', async () => {
        mockTemplateFindFirst.mockResolvedValue({ id: TEMPLATE_ID, status: 'ACTIVE', isDeleted: false });
        mockTemplateUpdate.mockImplementation(async ({ data }) => ({ id: TEMPLATE_ID, ...data }));
        const closed = await surveyService.closeTemplate(TEMPLATE_ID);
        expect(closed.status).toBe('CLOSED');

        mockTemplateFindFirst.mockResolvedValue({ id: TEMPLATE_ID, status: 'DRAFT', isDeleted: false });
        await expect(surveyService.closeTemplate(TEMPLATE_ID))
            .rejects.toMatchObject({ statusCode: 409, code: 'INVALID_SURVEY_TEMPLATE_STATUS' });
    });

    test('unknown template → 404 SURVEY_NOT_FOUND', async () => {
        mockTemplateFindFirst.mockResolvedValue(null);
        await expect(surveyService.activateTemplate(TEMPLATE_ID))
            .rejects.toMatchObject({ statusCode: 404, code: 'SURVEY_NOT_FOUND' });
    });
});

describe('survey-service.submitResponse', () => {
    test('template not ACTIVE → 409 SURVEY_NOT_ACTIVE', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions({ status: 'DRAFT' }));
        await expect(surveyService.submitResponse(TEMPLATE_ID, {
            region: 'NORTH',
            answers: [{ questionId: 'q1', value: 'ขมิ้นชัน' }, { questionId: 'q2', value: 5 }],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 409, code: 'SURVEY_NOT_ACTIVE' });
    });

    test('invalid region → 400 (4 ภาคเท่านั้น: NORTH/CENTRAL/NORTHEAST/SOUTH)', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions());
        await expect(surveyService.submitResponse(TEMPLATE_ID, {
            region: 'EAST',
            answers: [{ questionId: 'q1', value: 'ขิง' }, { questionId: 'q2', value: 4 }],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 400 });
    });

    test('duplicate questionId → 400 DUPLICATE_QUESTION (not a 500 from Prisma P2002)', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions());
        await expect(surveyService.submitResponse(TEMPLATE_ID, {
            region: 'NORTH',
            answers: [
                { questionId: 'q1', value: 'ขิง' },
                { questionId: 'q2', value: 4 },
                { questionId: 'q1', value: 'ซ้ำ' }, // duplicate → would hit @@unique
            ],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 400, code: 'DUPLICATE_QUESTION' });
        // guarded before the transaction ever opens
        expect(mockResponseCreate).not.toHaveBeenCalled();
    });

    test('missing required answer → 400 MISSING_REQUIRED_ANSWERS', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions());
        await expect(surveyService.submitResponse(TEMPLATE_ID, {
            region: 'SOUTH',
            answers: [{ questionId: 'q1', value: 'ไพล' }], // q2 (required rating) missing
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 400, code: 'MISSING_REQUIRED_ANSWERS' });
    });

    test('answer for a question not in the template → 400 INVALID_QUESTION', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions());
        await expect(surveyService.submitResponse(TEMPLATE_ID, {
            region: 'CENTRAL',
            answers: [
                { questionId: 'q1', value: 'กัญชา' },
                { questionId: 'q2', value: 3 },
                { questionId: 'foreign-q', value: 'x' },
            ],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_QUESTION' });
    });

    test('RATING_5 out of range / NUMBER non-numeric / choice not in list → 400 INVALID_ANSWER', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions());

        await expect(surveyService.submitResponse(TEMPLATE_ID, {
            region: 'NORTH',
            answers: [{ questionId: 'q1', value: 'ขิง' }, { questionId: 'q2', value: 6 }],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ANSWER' });

        await expect(surveyService.submitResponse(TEMPLATE_ID, {
            region: 'NORTH',
            answers: [
                { questionId: 'q1', value: 'ขิง' }, { questionId: 'q2', value: 4 },
                { questionId: 'q4', value: 'ไม่ใช่ตัวเลข' },
            ],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ANSWER' });

        await expect(surveyService.submitResponse(TEMPLATE_ID, {
            region: 'NORTH',
            answers: [
                { questionId: 'q1', value: 'ขิง' }, { questionId: 'q2', value: 4 },
                { questionId: 'q3', value: 'ตัวเลือกปลอม' },
            ],
        }, { actor: ACTOR })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ANSWER' });
    });

    test('valid submit: creates response + answer rows; text masked; rating in valueNumber', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions());

        const result = await surveyService.submitResponse(TEMPLATE_ID, {
            region: 'NORTHEAST',
            province: 'ขอนแก่น',
            answers: [
                { questionId: 'q1', value: 'เลขบัตรผม 1175077767847 ครับ ปลูกขมิ้นชัน' },
                { questionId: 'q2', value: 4 },
                { questionId: 'q3', value: 'สหกรณ์' },
            ],
        }, { actor: { id: 'farmer-uuid', role: 'HEALTH' } });

        expect(result.id).toBe('resp-1');
        expect(mockResponseCreate).toHaveBeenCalledTimes(1);
        expect(mockResponseCreate.mock.calls[0][0].data.respondentUserId).toBe('farmer-uuid');
        expect(mockResponseCreate.mock.calls[0][0].data.region).toBe('NORTHEAST');
        // N answers cost ONE insert (N+1 batching, Step 3)
        expect(mockAnswerCreate).not.toHaveBeenCalled();
        expect(mockAnswerCreateMany).toHaveBeenCalledTimes(1);
        const answerRows = mockAnswerCreateMany.mock.calls[0][0].data;
        expect(answerRows).toHaveLength(3);

        const textAnswer = answerRows.find(r => r.questionId === 'q1');
        expect(textAnswer.valueText).not.toContain('1175077767847'); // masked
        expect(textAnswer.valueText).toContain('ขมิ้นชัน');

        const ratingAnswer = answerRows.find(r => r.questionId === 'q2');
        expect(ratingAnswer.valueNumber).toBe(4);
    });

    test('province free-text is masked at persist (national id typed into จังหวัด)', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions());
        await surveyService.submitResponse(TEMPLATE_ID, {
            region: 'CENTRAL',
            province: 'กรุงเทพ 1175077767847',
            answers: [
                { questionId: 'q1', value: 'ปลูกกัญชา' },
                { questionId: 'q2', value: 3 },
                { questionId: 'q3', value: 'สหกรณ์' },
            ],
        }, { actor: { id: 'farmer-uuid', role: 'HEALTH' } });

        const persistedProvince = mockResponseCreate.mock.calls[0][0].data.province;
        expect(persistedProvince).not.toContain('1175077767847'); // masked
        expect(persistedProvince).toContain('กรุงเทพ');
    });
});

describe('survey-service.getTemplateStats', () => {
    test('aggregates rating avg + choice counts + region breakdown + text keywords', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions());
        mockResponseFindMany.mockResolvedValue([
            {
                id: 'r1', region: 'NORTH', submittedAt: new Date('2026-07-01'),
                answers: [
                    { questionId: 'q1', valueText: 'อยากได้ราคาปุ๋ยถูกลง และตลาดรับซื้อสมุนไพร', valueNumber: null },
                    { questionId: 'q2', valueText: null, valueNumber: 4 },
                    { questionId: 'q3', valueText: 'ตลาดสด', valueNumber: null },
                ],
            },
            {
                id: 'r2', region: 'SOUTH', submittedAt: new Date('2026-07-02'),
                answers: [
                    { questionId: 'q1', valueText: 'ตลาดรับซื้อไม่แน่นอน ราคาผันผวน', valueNumber: null },
                    { questionId: 'q2', valueText: null, valueNumber: 2 },
                    { questionId: 'q3', valueText: 'ตลาดสด', valueNumber: null },
                ],
            },
        ]);

        const stats = await surveyService.getTemplateStats(TEMPLATE_ID);

        expect(stats.totalResponses).toBe(2);
        expect(stats.regionBreakdown).toEqual(expect.objectContaining({ NORTH: 1, SOUTH: 1 }));

        const rating = stats.questions.find(q => q.questionId === 'q2');
        expect(rating.average).toBe(3);
        expect(rating.count).toBe(2);

        const choice = stats.questions.find(q => q.questionId === 'q3');
        expect(choice.choiceCounts).toEqual(expect.objectContaining({ 'ตลาดสด': 2 }));

        const text = stats.questions.find(q => q.questionId === 'q1');
        expect(Array.isArray(text.topKeywords)).toBe(true);
        // "ตลาด" appears in both answers — must surface as a keyword
        expect(text.topKeywords.map(k => k.word)).toEqual(expect.arrayContaining(['ตลาด']));
    });
});

describe('survey-service.exportResponsesCsv', () => {
    test('one column per question in sortOrder; formula cells neutralized; BOM prefix', async () => {
        mockTemplateFindFirst.mockResolvedValue(templateWithQuestions());
        mockResponseFindMany.mockResolvedValue([
            {
                id: 'r1', region: 'NORTH', province: 'เชียงใหม่', submittedAt: new Date('2026-07-01T00:00:00Z'),
                answers: [
                    { questionId: 'q1', valueText: '=SUM(A1:A9)', valueNumber: null },
                    { questionId: 'q2', valueText: null, valueNumber: 5 },
                ],
            },
        ]);

        const csv = await surveyService.exportResponsesCsv(TEMPLATE_ID);

        expect(csv.startsWith('﻿')).toBe(true); // Excel-Thai BOM
        const lines = csv.replace('﻿', '').split('\n');
        expect(lines[0]).toContain('ปลูกสมุนไพรชนิดใด');
        expect(csv).toContain("'=SUM(A1:A9)"); // CWE-1236 neutralized
        expect(csv).not.toMatch(/(^|,)=SUM/m);
    });
});

describe('survey-service.createInterview (ต้นแบบ 2.2)', () => {
    test('transcript + keyInsights masked; recordedBy stamps actor UUID', async () => {
        const result = await surveyService.createInterview({
            title: 'สัมภาษณ์ผู้เชี่ยวชาญกรมฯ',
            intervieweeName: 'ดร.ตัวอย่าง',
            interviewDate: '2026-07-01',
            mode: 'ONLINE',
            transcript: 'ผู้ให้ข้อมูลเลขบัตร 1175077767847 กล่าวว่าระบบควรลดขั้นตอนเอกสาร',
            keyInsights: ['ลดขั้นตอนเอกสาร', 'เลข 1175077767847 ต้องถูก mask'],
        }, { actor: ACTOR });

        expect(result.id).toBe('int-1');
        const data = mockInterviewCreate.mock.calls[0][0].data;
        expect(data.transcript).not.toContain('1175077767847');
        expect(JSON.stringify(data.keyInsights)).not.toContain('1175077767847');
        expect(data.recordedBy).toBe('user-uuid-1');
    });

    test('missing required fields → 400 INTERVIEW_INVALID', async () => {
        await expect(surveyService.createInterview({ title: '' }, { actor: ACTOR }))
            .rejects.toMatchObject({ statusCode: 400, code: 'INTERVIEW_INVALID' });
    });
});

describe('utils/thai-keywords.extractThaiKeywords (text-mining 3.1)', () => {
    test('segments Thai text, drops stopwords, returns sorted frequency list', () => {
        const keywords = extractThaiKeywords([
            'อยากให้ราคาสมุนไพรดีขึ้น และมีตลาดรับซื้อแน่นอน',
            'ตลาดรับซื้อสมุนไพรมีน้อย ราคาไม่แน่นอน',
        ], { top: 10 });

        expect(Array.isArray(keywords)).toBe(true);
        expect(keywords.length).toBeGreaterThan(0);
        const words = keywords.map(k => k.word);
        expect(words).toEqual(expect.arrayContaining(['ตลาด', 'สมุนไพร', 'ราคา']));
        // stopwords must not surface
        expect(words).not.toEqual(expect.arrayContaining(['และ']));
        // sorted by count desc
        for (let i = 1; i < keywords.length; i++) {
            expect(keywords[i - 1].count).toBeGreaterThanOrEqual(keywords[i].count);
        }
    });

    test('empty/non-Thai-safe input → empty list (no crash)', () => {
        expect(extractThaiKeywords([])).toEqual([]);
        expect(extractThaiKeywords([null, undefined, ''])).toEqual([]);
    });
});
