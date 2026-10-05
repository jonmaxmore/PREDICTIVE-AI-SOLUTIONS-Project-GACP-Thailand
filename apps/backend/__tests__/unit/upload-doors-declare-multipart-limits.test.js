'use strict';

/**
 * SECU-02 (audit 2026-09-17): every multer instance in the backend states how
 * much multipart it will read.
 *
 * multer bounds only what a door declares. Left to its defaults it takes any
 * number of text fields, parts and files, 1 MB per text field, and field names of
 * any length (2.x checks a name's length only when `fieldNameSize` is set) — all
 * of it buffered in memory before the route's own checks run. Upgrading multer to
 * 2.3.0 (done separately) fixes the published crash; refusing bracketed field
 * names blocks it on 2.2.0 as well, and these limits cap what the next parser
 * bug, or plain volume, can cost.
 *
 * Each door below is the REAL multer instance its module builds: `multer` is
 * wrapped so the test receives exactly what the module created, and a real
 * multipart stream is pushed through the real middleware. The refusals are
 * multer's own error codes, not a reading of the options object.
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const mockCreated = [];
jest.mock('multer', () => {
    const real = jest.requireActual('multer');
    const wrapped = (options) => {
        const instance = real(options);
        mockCreated.push({ options, instance });
        return instance;
    };
    return Object.assign(wrapped, real);
});
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l), logger: l, stream: { write: jest.fn() } };
});

const BACKEND = path.resolve(__dirname, '..', '..');

/** Require a module and return the multer instances it created while loading. */
function instancesCreatedBy(load) {
    const before = mockCreated.length;
    const result = load();
    return { result, created: mockCreated.slice(before) };
}

function onlyInstance(load) {
    const { created } = instancesCreatedBy(load);
    expect(created).toHaveLength(1);
    return created[0];
}

const FARM_CREATE_FIELDS = {
    farmName: 'สวนสมใจ', farmType: 'CULTIVATION', address: '99/1 หมู่ 4 ต.สันทราย',
    province: 'เชียงใหม่', district: 'สันทราย', subDistrict: 'สันทรายหลวง', postalCode: '50210',
    latitude: '18.84', longitude: '99.04', totalArea: '1600', cultivationArea: '800', areaUnit: 'sqm',
    cultivationMethod: 'OUTDOOR', irrigationType: 'DRIP', soilType: 'LOAM', waterSource: 'WELL',
    landDocuments: '{"images":[]}',
};

// A long free-text note a person could really type: 20,000 Thai characters (60 KB).
const LONG_THAI_NOTE = 'ก'.repeat(20_000);

const DOORS = [
    {
        door: 'storage-service createUploader (avatar, farm photo, draft documents, lab results)',
        files: 1,
        build: () => {
            const storage = require('../../services/storage-service');
            return onlyInstance(() => storage.createUploader('limits-test', ['image/png'], 1));
        },
        handler: (u) => u.single('file'),
        realFields: FARM_CREATE_FIELDS,
    },
    {
        door: 'upload-middleware fallback (when storage-service has no createUploader)',
        files: 1,
        build: () => {
            let entry;
            jest.isolateModules(() => {
                jest.doMock('../../services/storage-service', () => ({}));
                entry = onlyInstance(() => require('../../middleware/upload-middleware'));
            });
            // doMock outlives isolateModules; the doors below need the real module.
            jest.dontMock('../../services/storage-service');
            return entry;
        },
        handler: (u) => u.single('avatar'),
        realFields: FARM_CREATE_FIELDS,
    },
    {
        door: 'POST /applications/:id/car',
        files: 10,
        build: () => onlyInstance(() => require('../../routes/api/applications/applications-car')),
        handler: (u) => u.array('carDocument', 10),
        realFields: { notes: LONG_THAI_NOTE, applicationId: 'app-1' },
    },
    {
        door: 'POST /post-audit/tasks/:taskId/upload',
        files: 5,
        build: () => onlyInstance(() => require('../../routes/api/audit/post-audit')),
        handler: (u) => u.array('files', 5),
        realFields: { note: 'แนบหลักฐานการแก้ไข' },
    },
    {
        door: 'POST /audit/onsite/:auditId/photo',
        files: 1,
        build: () => onlyInstance(() => require('../../routes/api/audit/onsite')),
        handler: (u) => u.single('photo'),
        realFields: {
            itemId: 'GACP-4.2', caption: 'ก'.repeat(2000),
            gps: JSON.stringify({ latitude: 18.84, longitude: 99.04, accuracy: 5, capturedAt: '2026-09-17T03:00:00Z' }),
            gpsLat: '18.84', gpsLng: '99.04', capturedAt: '2026-09-17T03:00:00Z',
        },
    },
    {
        door: 'POST /image-assessment/assess',
        files: 1,
        build: () => onlyInstance(() => require('../../routes/api/audit/image-assessment')),
        handler: (u) => u.single('image'),
        realFields: { herbCode: 'TURMERIC' },
    },
    {
        door: 'photo-upload-service getMulterConfig',
        files: 1,
        build: () => {
            const svc = require('../../services/media/photo-upload-service');
            return onlyInstance(() => svc.getMulterConfig());
        },
        handler: (u) => u.single('photo'),
        realFields: { lat: '18.84', lng: '99.04', accuracy: '5', itemCode: 'GACP-4.2' },
    },
];

function multipartOf(fields, boundary = 'gacp-limits') {
    const parts = fields.map(([name, value]) => (
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
    parts.push(`--${boundary}--\r\n`);
    return { bytes: Buffer.from(parts.join(''), 'utf8'), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Push one multipart body through a multer middleware; resolve with its verdict. */
function drive(middleware, { bytes, contentType }) {
    const req = Readable.from([bytes], { objectMode: false });
    Object.assign(req, {
        method: 'POST',
        url: '/',
        headers: { 'content-type': contentType, 'content-length': String(bytes.length) },
    });
    return new Promise((resolve) => {
        // A parser that threw inside a stream event never calls next; answer
        // after 3 s instead of waiting out the suite timeout.
        const watchdog = setTimeout(() => resolve({ err: new Error('multer never called next'), body: undefined }), 3000);
        middleware(req, {}, (err) => {
            clearTimeout(watchdog);
            resolve({ err: err || null, body: req.body });
        });
    });
}

describe.each(DOORS)('SECU-02 — $door', ({ build, handler, files, realFields }) => {
    let entry;
    beforeAll(() => { entry = build(); });

    it('declares every multipart limit as a finite number', () => {
        const { limits } = entry.options;
        for (const key of ['fileSize', 'files', 'fields', 'fieldNameSize', 'fieldSize', 'parts']) {
            expect(Number.isFinite(limits?.[key])).toBe(true);
            expect(limits[key]).toBeGreaterThan(0);
        }
        expect(limits.files).toBe(files);
        expect(limits.parts).toBe(limits.files + limits.fields);
    });

    it('refuses a body of 200 text fields', async () => {
        const fields = Array.from({ length: 200 }, (_, i) => [`f${i}`, 'x']);
        const { err } = await drive(handler(entry.instance), multipartOf(fields));

        expect(err).not.toBeNull();
        expect(err.code).toBe('LIMIT_FIELD_COUNT');
    });

    it('refuses a single 256 KB text field', async () => {
        const { err } = await drive(handler(entry.instance), multipartOf([['notes', 'x'.repeat(256 * 1024)]]));

        expect(err).not.toBeNull();
        expect(err.code).toBe('LIMIT_FIELD_VALUE');
    });

    it('refuses a field name longer than 100 characters', async () => {
        const { err } = await drive(handler(entry.instance), multipartOf([['n'.repeat(101), 'x']]));

        expect(err).not.toBeNull();
        expect(err.code).toBe('LIMIT_FIELD_KEY');
    });

    it('answers the published two-field crash with a refusal, not a dead process', async () => {
        // GHSA-wc9g-mqfw-jrwm, reproduced on multer 2.2.0 on 2026-09-17: these two
        // names make append-field build a 2^32-element array and throw
        // "RangeError: Invalid array length" from inside a stream event, where no
        // error handler can catch it, and the process exits. No client of these
        // doors sends a bracketed name, so every door refuses them before
        // append-field runs.
        const { err } = await drive(handler(entry.instance), multipartOf([['a[4294967294]', 'x'], ['a[]', 'x']]));

        expect(err).not.toBeNull();
        expect(err.code).toBe('LIMIT_FIELD_NESTING');
    });

    it('still accepts the text fields its real client sends', async () => {
        const { err, body } = await drive(handler(entry.instance), multipartOf(Object.entries(realFields)));

        expect(err).toBeNull();
        expect({ ...body }).toEqual(realFields);
    });
});

describe('SECU-02 — the table above is every multer instance in the backend', () => {
    it('no other production file requires multer', () => {
        const covered = new Set([
            'services/storage-service.js',
            'middleware/upload-middleware.js',
            'routes/api/applications/applications-car.js',
            'routes/api/audit/post-audit.js',
            'routes/api/audit/onsite.js',
            'routes/api/audit/image-assessment.js',
            'services/media/photo-upload-service.js',
        ]);
        const found = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (['node_modules', '__tests__', 'tests', 'test-support', 'scripts', 'chaos-tests'].includes(entry.name)) { continue; }
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!entry.name.endsWith('.js')) { continue; }
                if (/require\(\s*['"]multer['"]\s*\)/.test(fs.readFileSync(full, 'utf8'))) {
                    found.push(path.relative(BACKEND, full).split(path.sep).join('/'));
                }
            }
        };
        for (const top of ['routes', 'services', 'middleware', 'controllers', 'modules', 'shared', 'jobs', 'cron']) {
            const dir = path.join(BACKEND, top);
            if (fs.existsSync(dir)) { walk(dir); }
        }
        expect(found.filter((f) => !covered.has(f))).toEqual([]);
    });
});
