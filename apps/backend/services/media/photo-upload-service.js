/**
 * Photo Upload Service
 * Handles photo uploads with GPS geotagging and timestamp
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { resolveInDirectory } = require('../../shared/safe-path');
const { createLogger } = require('../../shared/logger');
const { multipartLimits } = require('../../shared/multipart-limits');
const logger = createLogger('photo-service');

class PhotoUploadService {
    constructor() {
        this.uploadDir = path.join(__dirname, '../../storage/photos');
        this.maxFileSize = 10 * 1024 * 1024; // 10MB
        this.allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    }

    /**
     * Initialize storage directory
     */
    async ensureStorageDir() {
        try {
            await fs.access(this.uploadDir);
        } catch {
            await fs.mkdir(this.uploadDir, { recursive: true });
        }
    }

    /**
     * Configure multer storage
     */
    getMulterConfig() {
        const storage = multer.diskStorage({
            destination: async (req, file, cb) => {
                await this.ensureStorageDir();
                cb(null, this.uploadDir);
            },
            filename: (req, file, cb) => {
                const auditId = req.params.id || 'unknown';
                const timestamp = Date.now();
                const ext = path.extname(file.originalname);
                const filename = `audit_${auditId}_${timestamp}${ext}`;
                cb(null, filename);
            },
        });

        const fileFilter = (req, file, cb) => {
            if (this.allowedTypes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('Invalid file type. Only JPEG, PNG, and WebP allowed.'), false);
            }
        };

        return multer({
            storage,
            fileFilter,
            // One photo plus its GPS/checklist metadata fields (SECU-02)
            limits: multipartLimits({ fileSize: this.maxFileSize, files: 1, fields: 20 }),
        });
    }

    /**
     * Save photo with metadata
     * @param {Object} file - Multer file object
     * @param {Object} metadata - GPS and other metadata
     */
    async savePhotoWithMetadata(file, metadata) {
        const {
            auditId,
            itemCode,
            lat,
            lng,
            accuracy,
            timestamp = new Date(),
            capturedBy,
        } = metadata;

        const photoRecord = {
            filename: file.filename,
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            path: file.path,
            url: `/api/v2/photos/${file.filename}`,
            auditId,
            itemCode,
            geotag: {
                lat: parseFloat(lat),
                lng: parseFloat(lng),
                accuracy: parseFloat(accuracy),
            },
            capturedAt: timestamp,
            capturedBy,
            uploadedAt: new Date(),
        };

        logger.info(`Photo saved: ${file.filename} for audit ${auditId}`);

        return photoRecord;
    }

    /**
     * Get photo by filename
     */
    async getPhoto(filename) {
        const filePath = resolveInDirectory(this.uploadDir, filename);
        try {
            await fs.access(filePath);
            return filePath;
        } catch {
            throw new Error('Photo not found');
        }
    }

    /**
     * Delete photo
     */
    async deletePhoto(filename) {
        const filePath = resolveInDirectory(this.uploadDir, filename);
        try {
            await fs.unlink(filePath);
            logger.info(`Photo deleted: ${filename}`);
            return true;
        } catch {
            throw new Error('Failed to delete photo');
        }
    }

    /**
     * Validate GPS coordinates (Thailand bounds)
     */
    validateGPS(lat, lng) {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        if (isNaN(latitude) || isNaN(longitude)) {
            return false;
        }

        // Thailand bounds: Lat 5.6-20.5, Lng 97.3-105.6
        if (latitude < 5 || latitude > 21) {return false;}
        if (longitude < 97 || longitude > 106) {return false;}

        return true;
    }

    /**
     * Calculate distance between two GPS points (meters)
     */
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = this.toRad(lat2 - lat1);
        const dLng = this.toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRad(deg) {
        return deg * (Math.PI / 180);
    }
}

module.exports = new PhotoUploadService();

