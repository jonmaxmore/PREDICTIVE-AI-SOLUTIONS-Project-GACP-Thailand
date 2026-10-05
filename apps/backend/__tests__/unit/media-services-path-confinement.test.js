'use strict';

/**
 * SEC — the media services must not read or delete outside their own directory.
 *
 * signature-service and photo-upload-service both build their file paths as
 * `path.join(this.storageDir, filename)` where `filename` is a plain function
 * argument. path.join RESOLVES `..` rather than rejecting it, so
 * `'../../../shared/logger.js'` escapes the storage directory entirely. Seven
 * call sites do this across the two services, covering read, verify and DELETE:
 *
 *   signature-service : saveSignature, verifySignature, getSignature,
 *                       getSignatureBase64, deleteSignature
 *   photo-upload      : getPhoto, deletePhoto
 *
 * Neither module is mounted on any route today — the only reference anywhere is
 * a module-load check in scripts/e2e-validate.js — so this is a latent
 * foot-gun rather than a live breach. That is precisely why it is worth closing
 * now: the argument is named `filename`, so the next caller to pass a
 * user-supplied value has no reason to suspect it is a path, and nothing in
 * review would flag it. The same reasoning applied to optionalAuth earlier in
 * this branch.
 *
 * These APIs take a NAME, not a path, so the guard is exact: a value carrying
 * any directory component is rejected outright rather than silently rewritten
 * by path.basename(). Silently rewriting a delete target is its own hazard —
 * it would delete a DIFFERENT file than the caller named and report success.
 */

const path = require('path');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// NOTE: both services do `require('fs').promises`, NOT `require('fs/promises')`.
// Mocking the wrong one makes every call throw "Failed to delete signature"
// because fs.unlink is undefined — which looks exactly like a confinement
// rejection and greens this whole suite against code that has no confinement
// at all. Mock `fs` itself and hang the promises API off it.
const mockUnlink = jest.fn(async () => undefined);
const mockReadFile = jest.fn(async () => Buffer.from('data'));
const mockAccess = jest.fn(async () => undefined);
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    promises: {
        unlink: (...a) => mockUnlink(...a),
        readFile: (...a) => mockReadFile(...a),
        access: (...a) => mockAccess(...a),
        writeFile: jest.fn(async () => undefined),
        mkdir: jest.fn(async () => undefined),
        stat: jest.fn(async () => ({ size: 10 })),
    },
}));

// Values that escape the storage directory. `path.join` resolves every one of
// these into somewhere else on disk.
const ESCAPES = [
    '../../../shared/logger.js',
    '..%2F..%2Fetc%2Fpasswd'.replace(/%2F/g, '/'),
    '/etc/passwd',
    'subdir/../../outside.txt',
    'nested/file.png',
];

const SAFE_NAME = 'signature-123.png';

describe('SEC — signature-service confines every path to its storage dir', () => {
    let service;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        // Both modules export a ready-made singleton instance.
        service = require('../../services/media/signature-service');
    });

    it.each(ESCAPES)('deleteSignature refuses %p', async (evil) => {
        await expect(service.deleteSignature(evil)).rejects.toThrow();
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    it.each(ESCAPES)('getSignature refuses %p', async (evil) => {
        await expect(service.getSignature(evil)).rejects.toThrow();
        expect(mockReadFile).not.toHaveBeenCalled();
    });

    it.each(ESCAPES)('getSignatureBase64 refuses %p', async (evil) => {
        await expect(service.getSignatureBase64(evil)).rejects.toThrow();
        expect(mockReadFile).not.toHaveBeenCalled();
    });

    // saveSignature builds its own name as
    // `sig_${auditId}_${signerRole}_${timestamp}_${hash}.png`, interpolating
    // CALLER-SUPPLIED metadata. A traversal in auditId therefore made this a
    // write-side escape as well — arbitrary .png placement. The same guard
    // closes it, because the generated name stops being bare.
    it('refuses a generated name poisoned through auditId metadata', async () => {
        await expect(service.saveSignature('data:image/png;base64,AAAA', {
            auditId: '../../../evil',
            signerId: 's1',
            signerName: 'x',
            signerRole: 'AUDITOR',
        })).rejects.toThrow();
    });

    it('still deletes a legitimate bare filename, inside the storage dir', async () => {
        await service.deleteSignature(SAFE_NAME);

        expect(mockUnlink).toHaveBeenCalledTimes(1);
        const used = mockUnlink.mock.calls[0][0];
        expect(path.basename(used)).toBe(SAFE_NAME);
        expect(path.resolve(used).startsWith(path.resolve(service.storageDir) + path.sep)).toBe(true);
    });
});

describe('SEC — photo-upload-service confines every path to its upload dir', () => {
    let service;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        service = require('../../services/media/photo-upload-service');
    });

    it.each(ESCAPES)('deletePhoto refuses %p', async (evil) => {
        await expect(service.deletePhoto(evil)).rejects.toThrow();
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    it.each(ESCAPES)('getPhoto refuses %p', async (evil) => {
        await expect(service.getPhoto(evil)).rejects.toThrow();
    });

    it('still deletes a legitimate bare filename, inside the upload dir', async () => {
        await service.deletePhoto('photo-abc.jpg');

        expect(mockUnlink).toHaveBeenCalledTimes(1);
        const used = mockUnlink.mock.calls[0][0];
        expect(path.basename(used)).toBe('photo-abc.jpg');
        expect(path.resolve(used).startsWith(path.resolve(service.uploadDir) + path.sep)).toBe(true);
    });
});
