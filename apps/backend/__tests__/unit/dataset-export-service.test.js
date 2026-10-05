'use strict';

/**
 * Dataset Export Service — สัญญา C05F680149 ภาคผนวก 4 ข้อ 3
 * "ชุดข้อมูลดิบ 1 ชุด (API/CSV) + คู่มือการใช้ชุดข้อมูล → Data Lake บพข."
 *
 * Contract under test:
 *   - Metadata-driven: data/datasets/dataset-domains.js is the single source
 *     for BOTH the export endpoints and the data-dictionary generator.
 *   - Privacy-by-design: exports emit ONLY allowlisted fields (raw operational
 *     measurements) — no PII columns (requestIp/userAgent/notes/actor ids are
 *     deliberately NOT in any allowlist).
 *   - CSV output: shared formula-injection guard + BOM; JSONL = one valid JSON
 *     object per line with exactly the allowlisted keys.
 *   - Batched pagination terminates (take-loop, no unbounded findMany).
 *   - Unknown domain → 404 DATASET_NOT_FOUND at the throw site.
 *   - Static guard: every allowlisted field exists on the Prisma model (DMMF)
 *     — kills the recurring select-nonexistent-field 500 class.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockFindMany = jest.fn();

jest.mock('../../services/prisma-database', () => {
    const handler = { findMany: (...a) => mockFindMany(...a) };
    return {
        prisma: new Proxy({}, {
            get: (target, prop) => (typeof prop === 'string' && prop !== '$transaction' ? handler : undefined),
        }),
    };
});

const datasetService = require('../../services/dataset-export-service');
const { DATASET_DOMAINS } = require('../../data/datasets/dataset-domains');

beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks does NOT drain mockResolvedValueOnce queues — a leftover
    // queued batch from a previous test would silently shift every later
    // test's data (the JSONL test intentionally leaves one queued []).
    mockFindMany.mockReset();
});

describe('dataset-domains config (single source of truth)', () => {
    test('has the raw-data domains the contract needs (cultivation/care/harvest/drying/scans/survey)', () => {
        const keys = DATASET_DOMAINS.map(d => d.key);
        expect(keys).toEqual(expect.arrayContaining([
            'cultivation-logs', 'care-logs', 'harvest-batches',
            'drying-temperatures', 'drying-humidities', 'trace-scans', 'survey-responses',
        ]));
    });

    test('every field entry carries Thai name + description for the dictionary; unit where numeric', () => {
        for (const domain of DATASET_DOMAINS) {
            expect(domain.thaiName).toBeTruthy();
            expect(domain.description).toBeTruthy();
            expect(domain.model).toBeTruthy();
            expect(domain.fields.length).toBeGreaterThan(0);
            for (const field of domain.fields) {
                expect(field.field).toBeTruthy();
                expect(field.thaiName).toBeTruthy();
            }
        }
    });

    test('PII columns are NEVER allowlisted (privacy-by-design)', () => {
        // performedBy เข้ามา 2026-09-07: **ชื่อบุคคล** ของคนที่ลงมือทำงานในแปลง —
        // เป็น PII ตรงตัวยิ่งกว่า recordedBy (ซึ่งเป็น user id) · Data Lake ของ บพข.
        // เป็นปลายทางภายนอกองค์กร ห้ามมีคอลัมน์ชี้ตัวบุคคลเด็ดขาด
        const banned = new Set(['requestIp', 'userAgent', 'notes', 'qcNotes', 'recordedBy', 'performedBy', 'createdBy', 'qcBy', 'photoUrl', 'respondentUserId']);
        for (const domain of DATASET_DOMAINS) {
            for (const field of domain.fields) {
                expect(banned.has(field.field)).toBe(false);
            }
        }
    });

    test('STATIC GUARD: every allowlisted field exists on its Prisma model (DMMF)', () => {
        const { Prisma } = require('@prisma/client');
        const models = new Map(Prisma.dmmf.datamodel.models.map(m => [m.name, new Set(m.fields.map(f => f.name))]));
        for (const domain of DATASET_DOMAINS) {
            const union = new Set(models.get(domain.model));
            expect(union.size).toBeGreaterThan(0);
            for (const extra of domain.extraModels || []) {
                for (const f of models.get(extra) || []) { union.add(f); }
            }
            for (const field of domain.fields) {
                if (!union.has(field.field)) {
                    throw new Error(`Domain ${domain.key}: field "${field.field}" does not exist on model ${domain.model}${domain.extraModels ? ` ∪ ${domain.extraModels.join(',')}` : ''}`);
                }
            }
        }
    });
});

describe('dataset-export-service.listDomains', () => {
    test('returns catalog entries with key/thaiName/description (no prisma call)', () => {
        const catalog = datasetService.listDomains();
        expect(catalog.length).toBe(DATASET_DOMAINS.length);
        expect(catalog[0]).toEqual(expect.objectContaining({
            key: expect.any(String),
            thaiName: expect.any(String),
            fieldCount: expect.any(Number),
        }));
        expect(mockFindMany).not.toHaveBeenCalled();
    });
});

describe('dataset-export-service.exportDomain', () => {
    test('unknown domain → 404 DATASET_NOT_FOUND', async () => {
        await expect(datasetService.exportDomain('nope', 'csv'))
            .rejects.toMatchObject({ statusCode: 404, code: 'DATASET_NOT_FOUND' });
    });

    test('invalid format → 400 INVALID_FORMAT', async () => {
        await expect(datasetService.exportDomain('care-logs', 'xml'))
            .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_FORMAT' });
    });

    test('JSONL: emits one JSON object per row with ONLY allowlisted keys', async () => {
        mockFindMany
            .mockResolvedValueOnce([
                { id: 'a1', createdAt: new Date('2026-07-01'), plantUnitId: 'p1', logType: 'WATERING', logDate: new Date('2026-07-01'), height: 12.5, leafCount: 4, healthScore: 5, secretField: 'MUST_NOT_LEAK', organizationId: 'org1' },
            ])
            .mockResolvedValueOnce([]);

        const jsonl = await datasetService.exportDomain('care-logs', 'jsonl');
        const lines = jsonl.trim().split('\n');
        expect(lines).toHaveLength(1);
        const row = JSON.parse(lines[0]);
        expect(row.id).toBe('a1');
        expect(row.logType).toBe('WATERING');
        expect(row.height).toBe(12.5);
        expect(row).not.toHaveProperty('secretField');
        expect(row).not.toHaveProperty('organizationId');
    });

    test('CSV: header from config order, formula guard applied, BOM prefix', async () => {
        mockFindMany
            .mockResolvedValueOnce([
                { id: 'c1', createdAt: new Date('2026-07-01T00:00:00Z'), cycleId: 'cy1', logDate: new Date('2026-07-01T00:00:00Z'), scope: 'CYCLE', logType: 'FERTILIZER', plotId: null, plantUnitId: null, productName: '=HYPERLINK("evil")', quantity: 2.5, unit: 'กก.', method: 'หยอด', area: 1.5, temperature: 33.5, humidity: 70, weather: 'SUNNY' },
            ])
            .mockResolvedValueOnce([]);

        const csv = await datasetService.exportDomain('cultivation-logs', 'csv');
        expect(csv.startsWith('﻿')).toBe(true);
        const lines = csv.replace('﻿', '').split('\n');
        expect(lines[0].split(',')[0]).toBe('"id"');
        expect(csv).toContain('\'=HYPERLINK');
        expect(csv).not.toMatch(/(^|,)"=HYPERLINK/m);
    });

    test('pagination loop: drains batches until short batch, single ordered query shape', async () => {
        const batch = (n, offset) => Array.from({ length: n }, (_, i) => ({
            id: `r${offset + i}`, createdAt: new Date(), plantUnitId: 'p', logType: 'WATERING', logDate: new Date(), height: null, leafCount: null, healthScore: null,
        }));
        mockFindMany
            .mockResolvedValueOnce(batch(1000, 0))
            .mockResolvedValueOnce(batch(3, 1000))
            .mockResolvedValueOnce([]);

        const jsonl = await datasetService.exportDomain('care-logs', 'jsonl');
        expect(jsonl.trim().split('\n')).toHaveLength(1003);
        // batches use select-allowlist + skip/take ordering (deterministic export)
        const firstCall = mockFindMany.mock.calls[0][0];
        expect(firstCall.take).toBe(1000);
        expect(firstCall.select).toEqual(expect.objectContaining({ id: true, logType: true }));
        expect(firstCall.orderBy).toEqual({ createdAt: 'asc' });
    });

    test('survey-responses domain flattens answers to long-format rows', async () => {
        mockFindMany
            .mockResolvedValueOnce([
                {
                    id: 'resp1', templateId: 't1', region: 'NORTH', province: 'เชียงใหม่',
                    respondentType: 'FARMER', submittedAt: new Date('2026-07-01T00:00:00Z'),
                    answers: [
                        { questionId: 'q1', valueText: 'ขมิ้นชัน', valueNumber: null },
                        { questionId: 'q2', valueText: null, valueNumber: 4 },
                    ],
                },
            ])
            .mockResolvedValueOnce([]);

        const jsonl = await datasetService.exportDomain('survey-responses', 'jsonl');
        const lines = jsonl.trim().split('\n').map(l => JSON.parse(l));
        expect(lines).toHaveLength(2); // long format: one row per answer
        expect(lines[0]).toEqual(expect.objectContaining({ responseId: 'resp1', questionId: 'q1', region: 'NORTH' }));
        expect(lines[1].valueNumber).toBe(4);
    });
});

describe('data dictionary generator', () => {
    test('generateDataDictionaryMarkdown covers every domain + field with Thai names', () => {
        const md = datasetService.generateDataDictionaryMarkdown();
        for (const domain of DATASET_DOMAINS) {
            expect(md).toContain(domain.key);
            expect(md).toContain(domain.thaiName);
            for (const field of domain.fields) {
                expect(md).toContain(field.field);
            }
        }
        // Contract wording: คู่มือประกอบด้วยความหมายของ data field + หน่วยนับ
        expect(md).toContain('หน่วย');
    });
});
