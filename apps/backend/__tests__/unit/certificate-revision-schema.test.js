'use strict';
/**
 * Certificate revision (ฉบับแก้ไขภายใต้เลขเดิม) — the schema and its expand migration agree.
 * Spec: design note 2026-08-27-certificate-revision-design §2.
 *
 * Pure file-system scan (no DB, no prisma client). A superseded signed document is archived
 * verbatim in `certificate_revisions`; the live `certificates` row keeps its identity and
 * carries `revisionNo`.
 */
const fs = require('fs');
const path = require('path');

const SCHEMA = path.resolve(__dirname, '../../prisma/schema/certification.prisma');
const TENANCY = path.resolve(__dirname, '../../prisma/schema/tenancy.prisma');
const MIG_DIR = path.resolve(__dirname, '../../prisma/migrations');
const EXTENSION_PATH = path.resolve(__dirname, '../../services/tenant-prisma-extension.js');

/** The text of one `model X { ... }` block, bounded at its own closing brace. */
function modelBlock(schema, name) {
    const start = schema.indexOf(`model ${name} {`);
    if (start < 0) {return '';}
    const end = schema.indexOf('\n}', start);
    return schema.slice(start, end + 2);
}

/** A field declaration line for `name` at the start of a line (a column, never a mention in a comment). */
function fieldLine(name) {
    return new RegExp('^\\s*' + name + '\\s', 'm');
}

/** The migration with its `--` comment lines removed: what the database actually executes. */
function executableSql(sql) {
    return sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
}

describe('certificate revisions — the schema and its expand migration agree', () => {
    const schema = fs.readFileSync(SCHEMA, 'utf8');
    const certModel = modelBlock(schema, 'Certificate');
    const revisionModel = modelBlock(schema, 'CertificateRevision');

    it('Certificate carries revisionNo (default 1), revisedAt, revisedBy, revisionReason', () => {
        expect(certModel).toMatch(/revisionNo\s+Int\s+@default\(1\)/);
        expect(certModel).toMatch(/revisedAt\s+DateTime\?/);
        expect(certModel).toMatch(/revisedBy\s+String\?/);
        expect(certModel).toMatch(/revisionReason\s+String\?/);
        expect(certModel).toMatch(/revisions\s+CertificateRevision\[\]/);
    });

    it('CertificateRevision archives the whole proof and is unique per (certificate, revisionNo)', () => {
        expect(revisionModel).not.toBe('');
        for (const col of ['certificateId', 'revisionNo', 'snapshot', 'documentHash', 'signature',
            'signatureAlgorithm', 'signatureKeyId', 'signaturePublicKey', 'signedBy', 'signedAt',
            'supersededAt', 'supersededBy', 'reasonCode', 'reasonText', 'correctedFields', 'organizationId']) {
            expect(revisionModel).toMatch(fieldLine(col));
        }
        expect(revisionModel).toMatch(/snapshot\s+Json\b/);
        expect(revisionModel).toMatch(/correctedFields\s+String\[\]\s+@default\(\[\]\)/);
        expect(revisionModel).toMatch(/@@unique\(\[certificateId, revisionNo\]\)/);
        expect(revisionModel).toMatch(/@@map\("certificate_revisions"\)/);
        // Both parents refuse to vanish under an archived proof.
        expect(revisionModel).toMatch(/certificate\s+Certificate\s+@relation\([^)]*onDelete: Restrict/);
        expect(revisionModel).toMatch(/organization\s+Organization\s+@relation\([^)]*onDelete: Restrict/);
    });

    it('Organization carries the back-relation', () => {
        const org = modelBlock(fs.readFileSync(TENANCY, 'utf8'), 'Organization');
        expect(org).toMatch(/certificateRevisions\s+CertificateRevision\[\]/);
    });

    it('CertificateRevision is registered as tenant-scoped, beside Certificate', () => {
        const src = fs.readFileSync(EXTENSION_PATH, 'utf8');
        const setLiteral = src.match(/const TENANT_SCOPED_MODELS = new Set\(\[([\s\S]*?)\]\)/)[1];
        expect(setLiteral).toMatch(/'Certificate'/);
        expect(setLiteral).toMatch(/'CertificateRevision'/);
    });

    it('the expand migration exists and only adds', () => {
        const dir = fs.readdirSync(MIG_DIR).find((d) => /^\d{14}_certificate_revisions_expand$/.test(d));
        expect(dir).toBeTruthy();
        const sql = executableSql(fs.readFileSync(path.join(MIG_DIR, dir, 'migration.sql'), 'utf8'));
        expect(sql).toMatch(/CREATE TABLE "certificate_revisions"/);
        expect(sql).toMatch(/ALTER TABLE "certificates" ADD COLUMN\s+"revisionNo" INTEGER NOT NULL DEFAULT 1/);
        expect(sql).toMatch(/ALTER TABLE "certificates" ADD COLUMN\s+"revisedAt" TIMESTAMP\(3\)/);
        expect(sql).toMatch(/ALTER TABLE "certificates" ADD COLUMN\s+"revisedBy" TEXT/);
        expect(sql).toMatch(/ALTER TABLE "certificates" ADD COLUMN\s+"revisionReason" TEXT/);
        expect(sql).toMatch(/"snapshot" JSONB NOT NULL/);
        expect(sql).toMatch(/"correctedFields" TEXT\[\] DEFAULT ARRAY\[\]::TEXT\[\]/);
        expect(sql).toMatch(/CREATE UNIQUE INDEX "certificate_revisions_certificateId_revisionNo_key"/);
        expect(sql).toMatch(/REFERENCES "certificates"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/);
        expect(sql).toMatch(/REFERENCES "organizations"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/);
        // RLS observe-only tenant policy, as on every tenant table since RLS phase E1.
        expect(sql).toContain('ALTER TABLE "certificate_revisions" ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain("rls_observe_check('certificate_revisions', \"organizationId\")");
        expect(sql).not.toMatch(/DROP |ALTER COLUMN .* TYPE|SET NOT NULL/);
    });
});
