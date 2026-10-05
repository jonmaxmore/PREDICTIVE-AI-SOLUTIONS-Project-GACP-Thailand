/**
 * Digital Signature Service
 * Handles signature capture and storage for audit sign-off
 */

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { resolveInDirectory } = require('../../shared/safe-path');
const { createLogger } = require('../../shared/logger');
const logger = createLogger('signature-service');

class SignatureService {
    constructor() {
        this.storageDir = path.join(__dirname, '../../storage/signatures');
    }

    /**
     * Initialize storage directory
     */
    async ensureStorageDir() {
        try {
            await fs.access(this.storageDir);
        } catch {
            await fs.mkdir(this.storageDir, { recursive: true });
        }
    }

    /**
     * Save signature from base64 data
     * @param {string} base64Data - Base64 encoded signature image
     * @param {Object} metadata - Signature metadata
     */
    async saveSignature(base64Data, metadata) {
        await this.ensureStorageDir();

        const {
            auditId,
            signerId,
            signerName,
            signerRole, // 'HEALTH' | 'AUDITOR'
            signedAt = new Date(),
        } = metadata;

        // Remove data URL prefix if present
        const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');

        // Generate unique filename
        const timestamp = Date.now();
        const hash = crypto.createHash('md5').update(base64Clean).digest('hex').substring(0, 8);
        const filename = `sig_${auditId}_${signerRole}_${timestamp}_${hash}.png`;
        const filePath = resolveInDirectory(this.storageDir, filename);

        // Decode and save
        const buffer = Buffer.from(base64Clean, 'base64');
        await fs.writeFile(filePath, buffer);

        // Create signature record
        const signatureRecord = {
            filename,
            path: filePath,
            url: `/api/v2/signatures/${filename}`,
            auditId,
            signerId,
            signerName,
            signerRole,
            signedAt,
            hash: crypto.createHash('sha256').update(buffer).digest('hex'),
            size: buffer.length,
        };

        logger.info(`Signature saved: ${filename} by ${signerName} (${signerRole})`);

        return signatureRecord;
    }

    /**
     * Verify signature hash
     */
    async verifySignature(filename, expectedHash) {
        const filePath = resolveInDirectory(this.storageDir, filename);

        try {
            const buffer = await fs.readFile(filePath);
            const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
            return actualHash === expectedHash;
        } catch (error) {
            logger.error(`Signature verification failed: ${filename}`, error);
            return false;
        }
    }

    /**
     * Get signature file
     */
    async getSignature(filename) {
        const filePath = resolveInDirectory(this.storageDir, filename);
        try {
            await fs.access(filePath);
            return filePath;
        } catch {
            throw new Error('Signature not found');
        }
    }

    /**
     * Get signature as base64
     */
    async getSignatureBase64(filename) {
        const filePath = resolveInDirectory(this.storageDir, filename);
        try {
            const buffer = await fs.readFile(filePath);
            return buffer.toString('base64');
        } catch {
            throw new Error('Signature not found');
        }
    }

    /**
     * Delete signature
     */
    async deleteSignature(filename) {
        const filePath = resolveInDirectory(this.storageDir, filename);
        try {
            await fs.unlink(filePath);
            logger.info(`Signature deleted: ${filename}`);
            return true;
        } catch {
            throw new Error('Failed to delete signature');
        }
    }

    /**
     * Validate signature data
     */
    validateSignatureData(base64Data) {
        if (!base64Data) {return false;}

        // Check if valid base64
        const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
        const clean = base64Data.replace(/^data:image\/\w+;base64,/, '');

        if (!base64Regex.test(clean)) {return false;}

        // Check minimum size (at least 100 bytes for a signature)
        const buffer = Buffer.from(clean, 'base64');
        if (buffer.length < 100) {return false;}

        // Check maximum size (5MB)
        if (buffer.length > 5 * 1024 * 1024) {return false;}

        return true;
    }
}

module.exports = new SignatureService();

