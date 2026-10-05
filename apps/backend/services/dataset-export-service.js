'use strict';

/**
 * Dataset Export Service — สัญญา C05F680149 ภาคผนวก 4 ข้อ 3
 * "ชุดข้อมูลดิบ 1 ชุด (API หรือ CSV) + คู่มือการใช้ชุดข้อมูล → Data Lake บพข."
 *
 * Metadata-driven: data/datasets/dataset-domains.js is the single source of
 * truth for the SELECT allowlist, Thai field meanings and units — this service
 * and the data-dictionary generator both read it, so the export and its manual
 * can never drift apart.
 *
 * Privacy-by-design: only allowlisted fields are selected (never `include`
 * everything); PII columns are structurally absent. Errors carry
 * .statusCode/.code at the throw site.
 *
 * Memory note: the batched take/skip loop bounds only the PER-QUERY page —
 * the full result set is still accumulated in `rows[]` and serialized to one
 * string before send. Fine at pilot scale (50 farms); before Data-Lake-scale
 * volumes on high-cardinality domains (cultivation-logs, trace-scans, drying-*),
 * switch to streaming (res.write per batch) or require a date-range filter.
 */

const { prisma } = require('./prisma-database');
const logger = require('../shared/logger');
const { neutralizeCsvFormula } = require('../shared/csv-utils');
const { DATASET_DOMAINS } = require('../data/datasets/dataset-domains');
const { getZonedParts } = require('../utils/working-days');

const BATCH_SIZE = 1000;
const FORMATS = new Set(['csv', 'jsonl']);

function httpError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

function findDomain(key) {
    return DATASET_DOMAINS.find(d => d.key === key) || null;
}

/** Catalog for GET /api/datasets — no DB round-trip. */
function listDomains() {
    return DATASET_DOMAINS.map(domain => ({
        key: domain.key,
        thaiName: domain.thaiName,
        description: domain.description,
        model: domain.model,
        fieldCount: domain.fields.length,
        formats: ['csv', 'jsonl'],
    }));
}

function serializeValue(value) {
    if (value instanceof Date) { return value.toISOString(); }
    return value;
}

/** Pull rows batch-by-batch with the allowlist SELECT (never over-fetch). */
async function _drainRows(domain) {
    const rows = [];
    if (domain.longFormat) {
        // survey-responses: response header + answers lines → long format
        let skip = 0;
        for (;;) {
            const batch = await prisma[domain.prismaModel].findMany({
                where: domain.where,
                include: { answers: true },
                orderBy: { createdAt: 'asc' },
                skip,
                take: BATCH_SIZE,
            });
            for (const response of batch) {
                for (const answer of response.answers || []) {
                    rows.push({
                        responseId: response.id,
                        templateId: response.templateId,
                        region: response.region,
                        province: response.province ?? null,
                        respondentType: response.respondentType,
                        submittedAt: serializeValue(response.submittedAt),
                        questionId: answer.questionId,
                        valueText: answer.valueText ?? null,
                        valueNumber: answer.valueNumber ?? null,
                    });
                }
            }
            if (batch.length < BATCH_SIZE) { break; }
            skip += BATCH_SIZE;
        }
        return rows;
    }

    const select = Object.fromEntries(domain.fields.map(f => [f.field, true]));
    let skip = 0;
    for (;;) {
        const batch = await prisma[domain.prismaModel].findMany({
            where: domain.where,
            select,
            orderBy: { createdAt: 'asc' },
            skip,
            take: BATCH_SIZE,
        });
        for (const record of batch) {
            const row = {};
            for (const f of domain.fields) {
                row[f.field] = serializeValue(record[f.field] ?? null);
            }
            rows.push(row);
        }
        if (batch.length < BATCH_SIZE) { break; }
        skip += BATCH_SIZE;
    }
    return rows;
}

function toCsv(domain, rows) {
    const cell = (value) => {
        const text = neutralizeCsvFormula(String(value ?? ''));
        return `"${text.replace(/"/g, '""')}"`;
    };
    const header = domain.fields.map(f => cell(f.field)).join(',');
    const lines = [header];
    for (const row of rows) {
        lines.push(domain.fields.map(f => cell(row[f.field])).join(','));
    }
    // BOM so Thai text opens correctly in Excel
    return `${'\ufeff'}${lines.join('\n')}`;
}

function toJsonl(rows) {
    return rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

/**
 * Export one dataset domain as CSV or JSONL. Org scoping comes from the
 * tenant context of the authenticated request (ADR-014 read backstop) — this
 * service adds no manual organizationId handling.
 */
async function exportDomain(domainKey, format) {
    const domain = findDomain(domainKey);
    if (!domain) {
        throw httpError(404, 'DATASET_NOT_FOUND', `Unknown dataset domain: ${domainKey}`);
    }
    if (!FORMATS.has(format)) {
        throw httpError(400, 'INVALID_FORMAT', 'format must be csv or jsonl');
    }

    const rows = await _drainRows(domain);
    logger.info(`[Dataset] export ${domain.key}: ${rows.length} rows as ${format}`);
    return format === 'csv' ? toCsv(domain, rows) : toJsonl(rows);
}

/**
 * คู่มือการใช้ชุดข้อมูล (Data Dictionary) — generated from the SAME config the
 * exports use, per the contract wording: "ความหมายของ data field, หน่วยนับ".
 */
function generateDataDictionaryMarkdown() {
    const lines = [
        '# คู่มือการใช้ชุดข้อมูลดิบ (Data Dictionary) สัญญา C05F680149',
        '',
        '> เอกสารประกอบชุดข้อมูลดิบตามภาคผนวก 4 ข้อ 3 สำหรับส่งเข้า Data Lake ของ บพข.',
        '> ชุดข้อมูลเป็นข้อมูลปฏิบัติการที่ยังไม่ผ่านการวิเคราะห์/สังเคราะห์ (ตามนิยามภาคผนวก 1 ข้อ 11)',
        '> ทุกชุดถูกทำให้เป็นนามแฝงโดยโครงสร้าง (pseudonymous): ตัวระบุบุคคลเป็น UUID/token,',
        '> เลขบัตรประชาชนเข้ารหัส/ปิดบังที่ชั้นจัดเก็บ และคอลัมน์ข้อมูลส่วนบุคคลไม่อยู่ในชุดส่งออก',
        '',
        `> สร้างอัตโนมัติจาก dataset-domains.js generated ${getZonedParts(new Date()).isoDate}`,
        '',
        '## รูปแบบการส่งมอบ',
        '',
        '- **API**: `GET /api/datasets` (แคตตาล็อก) และ `GET /api/datasets/{domain}/export?format=csv|jsonl` (จำกัดสิทธิ์ผู้ดูแลระบบ)',
        '- **ไฟล์**: CSV (UTF-8 BOM, formula-injection guarded) หรือ JSON Lines (1 record/บรรทัด)',
        '',
    ];

    for (const domain of DATASET_DOMAINS) {
        lines.push(`## ${domain.thaiName} (\`${domain.key}\`)`);
        lines.push('');
        lines.push(domain.description);
        lines.push('');
        lines.push(`ตารางต้นทาง: \`${domain.model}\`${domain.longFormat ? ' (long format 1 แถวต่อ 1 คำตอบ)' : ''}`);
        lines.push('');
        lines.push('| Field | ความหมาย | หน่วยนับ | รายละเอียด |');
        lines.push('|---|---|---|---|');
        for (const f of domain.fields) {
            lines.push(`| \`${f.field}\` | ${f.thaiName} | ${f.unit ?? '—'} | ${f.description ?? ''} |`);
        }
        lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('หมายเหตุ: ค่าเวลาเป็น ISO 8601 (UTC); ค่าว่าง = ไม่ได้บันทึก; boolean = true/false.');
    return lines.join('\n');
}

module.exports = {
    listDomains,
    exportDomain,
    generateDataDictionaryMarkdown,
};
