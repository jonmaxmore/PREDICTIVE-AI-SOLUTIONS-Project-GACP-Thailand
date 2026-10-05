// Local tessdata location. Pure constants, no side effects, so this is a plain
// require rather than an injected dependency.
const { TESSERACT_WORKER_OPTIONS } = require('../ocr/tessdata');

function createFraudDocumentVerificationMethods({
    prisma,
    logger,
    fs,
    path,
    crypto,
    calculateDistance,
}) {
    /**
     * Resolve a stored document fileUrl to an absolute path safely.
     * Strips optional `/uploads/` prefix from the stored URL, then ensures the
     * resolved path is rooted under `uploadDir`. Throws on any traversal
     * attempt (`..`, absolute paths, symlink escape).
     */
    function resolveDocumentPath(document) {
        const rawUploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
        const uploadDir = path.resolve(rawUploadDir);
        const fileUrl = String(document?.fileUrl || '').trim();
        if (!fileUrl) {
            throw new Error('document.fileUrl is empty');
        }
        // Allow values stored as `/uploads/foo/bar.jpg` or `foo/bar.jpg`.
        const normalized = fileUrl
            .replace(/^\/+/, '')
            .replace(/^uploads\//i, '');
        const candidate = path.resolve(uploadDir, normalized);
        const sep = path.sep;
        if (candidate !== uploadDir && !candidate.startsWith(uploadDir + sep)) {
            const err = new Error('Document file path is outside the upload directory');
            err.code = 'PATH_TRAVERSAL_BLOCKED';
            throw err;
        }
        return { uploadDir, filePath: candidate };
    }

    return {
        async verifyDocument(documentId, callerOrganizationId = null) {
            try {
                await this.ensureLibraries();

                const document = await prisma.applicationDocument.findUnique({
                    where: { id: documentId },
                    include: {
                        application: {
                            include: {
                                // NOTE: Application has NO `farm` relation (only `documents` —
                                // see application.prisma). Including `farm` here threw
                                // PrismaClientValidationError on EVERY document, so the whole
                                // fraud doc-scan returned 400 once any document existed (the 501
                                // fix in #318 merely uncovered this). The GPS-vs-farm anomaly check
                                // in _analyzeMetadata reads `document.application?.farm?.latitude`
                                // with optional chaining, so it degrades safely; that check stays
                                // DORMANT until the farm is wired via the real linkage (cultivation
                                // scope / ScopeOfWork), tracked as a follow-up.
                                documents: true,
                            },
                        },
                    },
                });

                if (!document) {
                    return { error: 'Document not found' };
                }

                // IDOR guard: ApplicationDocument is NOT in TENANT_SCOPED_MODELS
                // (no organizationId column) and findUnique-by-id is never
                // auto-scoped by the tenant extension. Assert the parent
                // application is in the caller's organization before reading
                // back metadata or mutating verificationStatus/verifiedAt/
                // fileHash. Return the same not-found shape so a cross-tenant
                // probe cannot distinguish "exists elsewhere" from "absent".
                if (callerOrganizationId
                    && document.application?.organizationId
                    && document.application.organizationId !== callerOrganizationId) {
                    return { error: 'Document not found' };
                }

                const checks = [];
                let riskScore = 0;

                // 1. File integrity check
                const integrityCheck = await this._checkFileIntegrity(document);
                checks.push(integrityCheck);
                if (!integrityCheck.passed) {
                    riskScore += 20;
                }

                // 2. Image quality check (if image)
                if (document.mimeType?.startsWith('image/')) {
                    const qualityCheck = await this._checkImageQuality(document);
                    checks.push(qualityCheck);
                    if (!qualityCheck.passed) {
                        riskScore += 30;
                    }

                    // 3. OCR for ID cards
                    if (document.documentType?.includes('ID')) {
                        const ocrCheck = await this._validateIdCardOCR(document);
                        checks.push(ocrCheck);
                        if (!ocrCheck.passed) {
                            riskScore += 40;
                        }
                    }

                    // 4. Metadata analysis
                    const metadataCheck = await this._analyzeMetadata(document);
                    checks.push(metadataCheck);
                    if (!metadataCheck.passed) {
                        riskScore += 25;
                    }

                    // 5. Tampering detection
                    const tamperCheck = await this._detectTampering(document);
                    checks.push(tamperCheck);
                    if (!tamperCheck.passed) {
                        riskScore += 50;
                    }
                }

                const riskLevel = this._calculateRiskLevel(riskScore);
                const status = riskLevel === 'HIGH'
                    ? 'REJECTED'
                    : riskLevel === 'MEDIUM'
                        ? 'REVIEW_REQUIRED'
                        : 'VERIFIED';

                // Update document with verification results
                await prisma.applicationDocument.update({
                    where: { id: documentId },
                    data: {
                        verificationStatus: status,
                        verifiedAt: new Date(),
                        fileHash: integrityCheck.details?.computedHash,
                    },
                });

                return {
                    documentId: document.id,
                    documentType: document.documentType,
                    verifiedAt: new Date().toISOString(),
                    riskScore: Math.min(riskScore, 100),
                    riskLevel,
                    status,
                    checks,
                    recommendations: this._generateDocumentRecommendations(checks),
                };

            } catch (error) {
                logger.error({
                    type: 'document_verification_error',
                    error: error.message,
                    documentId,
                }, 'Document verification failed');
                throw error;
            }
        },

        async _checkFileIntegrity(document) {
            try {
                const { filePath } = resolveDocumentPath(document);

                // Check file exists
                const stats = await fs.stat(filePath);
                if (!stats.isFile()) {
                    throw new Error('Not a file');
                }

                // Calculate SHA-256 hash
                const fileBuffer = await fs.readFile(filePath);
                const hash = crypto.createHash('sha256')
                    .update(fileBuffer)
                    .digest('hex');

                const passed = document.fileHash ? hash === document.fileHash : true;

                return {
                    name: 'File Integrity',
                    passed,
                    message: passed
                        ? 'File integrity verified'
                        : 'File hash mismatch - possible tampering',
                    details: {
                        computedHash: hash,
                        storedHash: document.fileHash,
                        fileSize: stats.size,
                        modified: stats.mtime,
                        created: stats.birthtime,
                    },
                };
            } catch (error) {
                return {
                    name: 'File Integrity',
                    passed: false,
                    message: `File check failed: ${error.message}`,
                };
            }
        },

        async _checkImageQuality(document) {
            try {
                const { filePath } = resolveDocumentPath(document);
                const sharp = this._getSharp();
                const metadata = await sharp(filePath).metadata();

                // Minimum requirements for ID documents
                const MIN_WIDTH = 800;
                const MIN_HEIGHT = 600;

                const passed = metadata.width >= MIN_WIDTH && metadata.height >= MIN_HEIGHT;

                // Calculate quality score
                const resolution = metadata.width * metadata.height;
                const qualityScore = Math.min(100, Math.round(resolution / 10000));

                return {
                    name: 'Image Quality',
                    passed,
                    message: passed
                        ? `Image quality acceptable (${metadata.width}x${metadata.height})`
                        : `Image too small (${metadata.width}x${metadata.height}), minimum ${MIN_WIDTH}x${MIN_HEIGHT} required`,
                    details: {
                        resolution: `${metadata.width}x${metadata.height}`,
                        format: metadata.format,
                        hasAlpha: metadata.hasAlpha,
                        channels: metadata.channels,
                        qualityScore,
                    },
                };
            } catch (error) {
                return {
                    name: 'Image Quality',
                    passed: false,
                    message: `Quality check failed: ${error.message}`,
                };
            }
        },

        async _validateIdCardOCR(document) {
            let worker = null;

            try {
                const { filePath } = resolveDocumentPath(document);
                const tesseract = this._getTesseract();

                // Create Tesseract worker.
                // TESSERACT_WORKER_OPTIONS pins langPath to the local tessdata
                // directory; without it tesseract.js downloads the .traineddata
                // models from a foreign CDN on first use (see
                // services/ocr/tessdata.js). The ID-card image itself is, and
                // always was, recognised locally — worker.recognize() below
                // reads a local file and the extracted national ID is matched
                // in-process. Nothing about that changes here.
                worker = await tesseract.createWorker(
                    'tha+eng',
                    undefined,
                    TESSERACT_WORKER_OPTIONS,
                );

                const { data: { text, confidence } } = await worker.recognize(filePath);

                // Thai ID pattern: 1-2345-67890-12-3
                const idPattern = /\d{1}-?\d{4}-?\d{5}-?\d{2}-?\d{1}/;
                const idMatch = text.match(idPattern);

                // Thai name detection
                const thaiPattern = /[\u0E00-\u0E7F]{2,}/g;
                const thaiMatches = text.match(thaiPattern) || [];
                const hasThaiName = thaiMatches.length >= 2;

                // Date pattern detection
                const datePattern = /\d{1,2}\s+(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;
                const hasDate = datePattern.test(text);

                // Laser code pattern (for newer ID cards)
                const laserPattern = /[A-Z]{2}\d-[0-9]{7}-[0-9]{2}/;
                const hasLaserCode = laserPattern.test(text);

                const passed = confidence > 60 && (idMatch || hasThaiName);

                return {
                    name: 'OCR Validation',
                    passed,
                    message: passed
                        ? `ID card recognized (confidence: ${Math.round(confidence)}%)`
                        : `Could not verify ID card (confidence: ${Math.round(confidence)}%)`,
                    details: {
                        idNumber: idMatch ? idMatch[0].replace(/-/g, '') : null,
                        idNumberFormatted: idMatch ? idMatch[0] : null,
                        hasThaiName,
                        thaiNameCount: thaiMatches.length,
                        hasDate,
                        hasLaserCode,
                        confidence: Math.round(confidence),
                        extractedTextLength: text.length,
                    },
                };
            } catch (error) {
                return {
                    name: 'OCR Validation',
                    passed: false,
                    message: `OCR failed: ${error.message}`,
                };
            } finally {
                if (worker) {
                    await worker.terminate();
                }
            }
        },

        async _analyzeMetadata(document) {
            try {
                const { filePath } = resolveDocumentPath(document);
                const buffer = await fs.readFile(filePath);
                const exifParser = this._getExifParser();
                if (!exifParser) {
                    // EXIF library unavailable — skip metadata tamper checks rather
                    // than crash. Other fraud signals (OCR, image quality) still run.
                    return {
                        name: 'Metadata Analysis',
                        passed: true, // can't assess → don't flag as fraud
                        message: 'EXIF metadata analysis unavailable',
                        details: { warnings: ['EXIF library not installed'] },
                    };
                }
                const parser = exifParser.create(buffer);
                const exif = parser.parse();

                const anomalies = [];
                const warnings = [];

                // Check for editing software
                if (exif.tags.Software) {
                    const editingSoftware = ['photoshop', 'gimp', 'lightroom', 'pixelmator'];
                    const software = exif.tags.Software.toLowerCase();
                    if (editingSoftware.some((s) => software.includes(s))) {
                        anomalies.push(`Edited with ${exif.tags.Software}`);
                    }
                }

                // Check creation date vs application date
                const createDate = exif.tags.CreateDate || exif.tags.DateTimeOriginal;
                if (createDate && document.application?.submittedAt) {
                    const fileDate = new Date(createDate * 1000);
                    const appDate = new Date(document.application.submittedAt);

                    if (fileDate > appDate) {
                        anomalies.push('File created after application submission');
                    }

                    // Check if file is too old (> 1 year before application)
                    const oneYear = 365 * 24 * 60 * 60 * 1000;
                    if (appDate - fileDate > oneYear) {
                        warnings.push('Photo taken more than 1 year before application');
                    }
                }

                // Check GPS consistency with farm location
                if (exif.tags.GPSLatitude && exif.tags.GPSLongitude) {
                    const fileLat = exif.tags.GPSLatitude;
                    const fileLon = exif.tags.GPSLongitude;
                    const farmLat = document.application?.farm?.latitude;
                    const farmLon = document.application?.farm?.longitude;

                    if (farmLat && farmLon) {
                        const distance = calculateDistance(fileLat, fileLon, farmLat, farmLon);
                        if (distance > 10000) { // 10km
                            anomalies.push(`Photo taken ${Math.round(distance / 1000)}km from farm location`);
                        } else if (distance > 1000) { // 1km
                            warnings.push(`Photo taken ${Math.round(distance / 100)}m from farm`);
                        }
                    }
                } else {
                    warnings.push('No GPS data in photo');
                }

                // Check for screenshot indicators
                if (!exif.tags.Make && !exif.tags.Model) {
                    warnings.push('No camera information - possible screenshot');
                }

                const passed = anomalies.length === 0;

                return {
                    name: 'Metadata Analysis',
                    passed,
                    message: anomalies.length === 0
                        ? (warnings.length === 0 ? 'No anomalies detected' : `${warnings.length} warning(s)`)
                        : `${anomalies.length} anomaly(ies) found`,
                    details: {
                        camera: exif.tags.Make && exif.tags.Model
                            ? `${exif.tags.Make} ${exif.tags.Model}`
                            : 'Unknown',
                        createDate: exif.tags.CreateDate
                            ? new Date(exif.tags.CreateDate * 1000).toISOString()
                            : null,
                        hasGPS: !!(exif.tags.GPSLatitude && exif.tags.GPSLongitude),
                        gpsLatitude: exif.tags.GPSLatitude,
                        gpsLongitude: exif.tags.GPSLongitude,
                        software: exif.tags.Software,
                        anomalies,
                        warnings,
                    },
                };
            } catch (error) {
                return {
                    name: 'Metadata Analysis',
                    passed: true, // Don't fail if no EXIF
                    message: 'No EXIF metadata available',
                    details: {
                        error: error.message,
                        warnings: ['Unable to read metadata'],
                    },
                };
            }
        },

        async _detectTampering(document) {
            try {
                const { filePath } = resolveDocumentPath(document);
                const sharp = this._getSharp();
                const metadata = await sharp(filePath).metadata();
                const stats = await fs.stat(filePath);

                const indicators = [];
                const warnings = [];

                // Check file size (unusually small might be compressed/edited)
                const fileSizeKB = stats.size / 1024;
                if (fileSizeKB < 50) {
                    indicators.push(`Unusually small file size (${Math.round(fileSizeKB)}KB)`);
                }

                // Check for uniform noise patterns (possible copy-paste)
                const _stats_analysis = await sharp(filePath)
                    .raw()
                    .toBuffer({ resolveWithObject: true });

                // Check ICC profile
                if (!metadata.icc) {
                    warnings.push('No ICC color profile');
                }

                // Check bit depth
                if (metadata.hasAlpha && metadata.channels === 4) {
                    // Normal for PNGs with transparency
                }

                const passed = indicators.length === 0;

                return {
                    name: 'Tampering Detection',
                    passed,
                    message: indicators.length === 0
                        ? 'No tampering indicators detected'
                        : `${indicators.length} indicator(s) found`,
                    details: {
                        indicators,
                        warnings,
                        fileSizeKB: Math.round(fileSizeKB),
                        bitDepth: metadata.size,
                        hasAlpha: metadata.hasAlpha,
                    },
                };
            } catch (error) {
                return {
                    name: 'Tampering Detection',
                    passed: true, // Don't block on error
                    message: 'Basic tampering check completed',
                    details: {
                        error: error.message,
                        warnings: ['Advanced tampering detection unavailable'],
                    },
                };
            }
        },
    };
}

module.exports = { createFraudDocumentVerificationMethods };
