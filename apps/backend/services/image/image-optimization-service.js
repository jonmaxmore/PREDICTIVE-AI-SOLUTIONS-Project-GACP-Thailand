/**
 * Image Optimization Service
 * Handles image compression, resizing, and thumbnail generation
 * Uses Sharp for high-performance image processing
 */

const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../shared/logger');

class ImageOptimizationService {
  constructor() {
    this.config = {
      // Quality settings
      quality: {
        high: 85,
        medium: 75,
        low: 60,
        thumbnail: 70,
      },

      // Size presets
      sizes: {
        thumbnail: { width: 200, height: 200 },
        small: { width: 400, height: 400 },
        medium: { width: 800, height: 800 },
        large: { width: 1200, height: 1200 },
        preview: { width: 600, height: 400 },
      },

      // Max dimensions for uploads
      maxWidth: 2400,
      maxHeight: 2400,

      // Supported formats
      supportedFormats: ['jpg', 'jpeg', 'png', 'webp'],

      // Output format
      outputFormat: 'webp', // Modern format, better compression
    };
  }

  /**
   * Optimize image file
   * @param {string} inputPath - Path to original image
   * @param {string} outputPath - Path to save optimized image
   * @param {object} options - Optimization options
   */
  async optimizeImage(inputPath, outputPath, options = {}) {
    try {
      const {
        quality = this.config.quality.medium,
        maxWidth = this.config.maxWidth,
        maxHeight = this.config.maxHeight,
        format = 'webp',
        fit = 'inside',
      } = options;

      const image = sharp(inputPath);
      const metadata = await image.metadata();

      logger.debug(`Optimizing image: ${inputPath}`);
      logger.debug(
        `Original size: ${metadata.width}x${metadata.height}, ${(metadata.size / 1024).toFixed(2)} KB`,
      );

      // Resize if needed
      let pipeline = image;

      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        pipeline = pipeline.resize(maxWidth, maxHeight, {
          fit,
          withoutEnlargement: true,
        });
      }

      // Convert and compress
      if (format === 'webp') {
        pipeline = pipeline.webp({ quality });
      } else if (format === 'jpeg' || format === 'jpg') {
        pipeline = pipeline.jpeg({ quality, progressive: true });
      } else if (format === 'png') {
        pipeline = pipeline.png({
          quality,
          compressionLevel: 9,
          adaptiveFiltering: true,
        });
      }

      // Save optimized image
      await pipeline.toFile(outputPath);

      // Get output file stats
      const outputStats = await fs.stat(outputPath);
      const compressionRatio = ((1 - outputStats.size / metadata.size) * 100).toFixed(2);

      logger.info(`Image optimized: ${path.basename(outputPath)}`);
      logger.info(`  Size reduction: ${compressionRatio}%`);
      logger.info(`  Original: ${(metadata.size / 1024).toFixed(2)} KB`);
      logger.info(`  Optimized: ${(outputStats.size / 1024).toFixed(2)} KB`);

      return {
        success: true,
        originalSize: metadata.size,
        optimizedSize: outputStats.size,
        compressionRatio: parseFloat(compressionRatio),
        width: metadata.width > maxWidth ? maxWidth : metadata.width,
        height: metadata.height > maxHeight ? maxHeight : metadata.height,
        format,
      };
    } catch (error) {
      logger.error('Image optimization failed:', error);
      throw error;
    }
  }

  /**
   * Generate thumbnail
   */
  async generateThumbnail(inputPath, outputPath, size = 'thumbnail') {
    try {
      const dimensions = this.config.sizes[size] || this.config.sizes.thumbnail;
      const quality = this.config.quality.thumbnail;

      await sharp(inputPath)
        .resize(dimensions.width, dimensions.height, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality })
        .toFile(outputPath);

      logger.info(
        `Thumbnail generated: ${path.basename(outputPath)} (${dimensions.width}x${dimensions.height})`,
      );

      return {
        success: true,
        path: outputPath,
        width: dimensions.width,
        height: dimensions.height,
      };
    } catch (error) {
      logger.error('Thumbnail generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate multiple sizes
   */
  async generateMultipleSizes(inputPath, outputDir, baseName) {
    try {
      const results = {};

      for (const [sizeName, dimensions] of Object.entries(this.config.sizes)) {
        const outputPath = path.join(outputDir, `${baseName}_${sizeName}.webp`);

        await sharp(inputPath)
          .resize(dimensions.width, dimensions.height, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: this.config.quality.medium })
          .toFile(outputPath);

        results[sizeName] = {
          path: outputPath,
          width: dimensions.width,
          height: dimensions.height,
        };
      }

      logger.info(`Generated ${Object.keys(results).length} sizes for ${baseName}`);

      return {
        success: true,
        sizes: results,
      };
    } catch (error) {
      logger.error('Multiple sizes generation failed:', error);
      throw error;
    }
  }

  /**
   * Optimize uploaded image for GACP application
   */
  async optimizeUploadedImage(file, type = 'document') {
    try {
      const uploadDir = path.join(process.cwd(), 'uploads', 'optimized');
      await fs.mkdir(uploadDir, { recursive: true });

      const timestamp = Date.now();
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext);
      const optimizedFileName = `${baseName}_${timestamp}.webp`;
      const outputPath = path.join(uploadDir, optimizedFileName);

      // Different optimization based on type
      const options =
        type === 'thumbnail'
          ? {
              quality: this.config.quality.thumbnail,
              maxWidth: 400,
              maxHeight: 400,
            }
          : type === 'document'
            ? {
                quality: this.config.quality.high,
                maxWidth: 1600,
                maxHeight: 1600,
              }
            : {
                quality: this.config.quality.medium,
                maxWidth: 1200,
                maxHeight: 1200,
              };

      const result = await this.optimizeImage(file.path, outputPath, options);

      // Generate thumbnail
      const thumbnailPath = path.join(uploadDir, `${baseName}_${timestamp}_thumb.webp`);
      await this.generateThumbnail(file.path, thumbnailPath, 'thumbnail');

      return {
        success: true,
        original: {
          path: file.path,
          size: file.size,
          mimetype: file.mimetype,
        },
        optimized: {
          path: outputPath,
          size: result.optimizedSize,
          compressionRatio: result.compressionRatio,
          width: result.width,
          height: result.height,
        },
        thumbnail: {
          path: thumbnailPath,
        },
      };
    } catch (error) {
      logger.error('Upload optimization failed:', error);
      throw error;
    }
  }

  /**
   * Batch optimize images
   */
  async batchOptimize(files, options = {}) {
    try {
      const results = [];

      for (const file of files) {
        try {
          const result = await this.optimizeUploadedImage(file, options.type);
          results.push({
            file: file.originalname,
            success: true,
            ...result,
          });
        } catch (error) {
          logger.error(`Failed to optimize ${file.originalname}:`, error);
          results.push({
            file: file.originalname,
            success: false,
            error: error.message,
          });
        }
      }

      const successful = results.filter(r => r.success).length;
      logger.info(`Batch optimization: ${successful}/${files.length} successful`);

      return {
        success: true,
        total: files.length,
        successful,
        failed: files.length - successful,
        results,
      };
    } catch (error) {
      logger.error('Batch optimization failed:', error);
      throw error;
    }
  }

  /**
   * Convert image to WebP
   */
  async convertToWebP(inputPath, quality = 80) {
    try {
      const outputPath = inputPath.replace(/\.(jpg|jpeg|png)$/i, '.webp');

      await sharp(inputPath).webp({ quality }).toFile(outputPath);

      logger.info(`Converted to WebP: ${path.basename(outputPath)}`);

      return {
        success: true,
        outputPath,
      };
    } catch (error) {
      logger.error('WebP conversion failed:', error);
      throw error;
    }
  }

  /**
   * Get image metadata
   */
  async getImageMetadata(imagePath) {
    try {
      const metadata = await sharp(imagePath).metadata();

      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: metadata.size,
        colorSpace: metadata.space,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation,
      };
    } catch (error) {
      logger.error('Failed to get image metadata:', error);
      throw error;
    }
  }

  /**
   * Validate image file
   */
  async validateImage(file) {
    try {
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');

      // Check format
      if (!this.config.supportedFormats.includes(ext)) {
        return {
          valid: false,
          error: `Unsupported format: ${ext}. Supported: ${this.config.supportedFormats.join(', ')}`,
        };
      }

      // Get metadata
      const metadata = await sharp(file.path).metadata();

      // Check dimensions
      if (metadata.width > 4000 || metadata.height > 4000) {
        return {
          valid: false,
          error: `Image too large: ${metadata.width}x${metadata.height}. Max: 4000x4000`,
        };
      }

      // Check file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        return {
          valid: false,
          error: `File too large: ${(file.size / 1024 / 1024).toFixed(2)} MB. Max: 10 MB`,
        };
      }

      return {
        valid: true,
        metadata,
      };
    } catch (error) {
      logger.error('Image validation failed:', error);
      return {
        valid: false,
        error: 'Invalid image file',
      };
    }
  }

  /**
   * Clean up old optimized images
   */
  async cleanupOldImages(directory, daysOld = 30) {
    try {
      const files = await fs.readdir(directory);
      const now = Date.now();
      const maxAge = daysOld * 24 * 60 * 60 * 1000;

      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(directory, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath);
          deleted++;
        }
      }

      logger.info(`Cleaned up ${deleted} old images (>${daysOld} days)`);

      return {
        success: true,
        deleted,
      };
    } catch (error) {
      logger.error('Cleanup failed:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new ImageOptimizationService();

