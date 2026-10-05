const storageService = require('../services/storage-service');
const multer = require('multer');
const { multipartLimits } = require('../shared/multipart-limits');

const MAX_FILE_MB = 20;

// Some tests mock storage-service partially; fallback keeps routes bootable in that case.
// The fallback declares the same limits createUploader does (SECU-02).
const upload = typeof storageService.createUploader === 'function'
    ? storageService.createUploader('', ['image/jpeg', 'image/png', 'application/pdf'], MAX_FILE_MB)
    : multer({
        storage: multer.memoryStorage(),
        limits: multipartLimits({ fileSize: MAX_FILE_MB * 1024 * 1024, files: 1, fields: 30 }),
    });

module.exports = upload;
