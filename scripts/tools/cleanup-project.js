/**
 * Project Cleanup Script
 *
 * Removes unused files, duplicates, and prepares for migration
 *
 * CAUTION: Review carefully before running!
 */

const fs = require('fs').promises;
const path = require('path');

class ProjectCleaner {
  constructor() {
    this.rootDir = process.cwd();
    this.deletedFiles = [];
    this.deletedDirs = [];
    this.skippedFiles = [];
    this.dryRun = process.argv.includes('--dry-run');
    this.force = process.argv.includes('--force');
  }

  /**
   * Main cleanup execution
   */
  async cleanup() {
    console.log('GACP Project AGGRESSIVE Cleanup Starting...\n');
    console.log(`Mode: ${this.dryRun ? 'DRY RUN (no files will be deleted)' : 'LIVE CLEANUP'}\n`);

    if (!this.dryRun && !this.force) {
      console.log('WARNING: This will delete files permanently!');
      console.log('   Run with --dry-run first to preview changes');
      console.log('   Run with --force to execute deletion\n');
      return;
    }

    try {
      // Phase 1: Remove backup directories (ALL BACKUPS)
      await this.cleanupBackups();

      // Phase 2: Remove ALL microservices (NOT USED)
      await this.cleanupMicroservices();

      // Phase 3: Remove old report files
      await this.cleanupReports();

      // Phase 4: Remove test files from root
      await this.cleanupRootTests();

      // Phase 5: Remove duplicate/old frontends
      await this.cleanupOldFrontends();

      // Phase 6: Remove docker configs (old)
      await this.cleanupDockerConfigs();

      // Summary
      this.printSummary();
    } catch (error) {
      console.error('Cleanup failed:', error);
      process.exit(1);
    }
  }

  /**
   * Phase 1: Remove ALL backup directories
   */
  async cleanupBackups() {
    console.log('Phase 1: Removing ALL backup directories...\n');

    const files = await fs.readdir(this.rootDir);

    // Delete ALL backup directories
    for (const file of files) {
      if (
        file.includes('backup') ||
        file.includes('archived') ||
        file.includes('deletion-backup') ||
        file.includes('database-backup')
      ) {
        await this.deleteDirectory(file);
      }
    }

    console.log('');
  }

  /**
   * Phase 2: Remove old report files
   */
  async cleanupReports() {
    console.log('Phase 2: Cleaning up report files...\n');

    // Create docs/reports directory if not exists
    const reportsDir = path.join(this.rootDir, 'docs', 'reports');
    if (!this.dryRun) {
      await fs.mkdir(reportsDir, { recursive: true });
      console.log(`Created: docs/reports/`);
    }

    // Move reports instead of deleting
    const reportPatterns = [
      '*_REPORT.md',
      '*_ANALYSIS.md',
      '*_PLAN.md',
      '*_SUMMARY.md',
      '*.json.bak',
      '*-report-*.json',
      '*-analysis-*.json'
    ];

    const files = await fs.readdir(this.rootDir);

    for (const file of files) {
      const shouldMove = reportPatterns.some(pattern => {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(file);
      });

      if ((shouldMove && file.endsWith('.md')) || file.endsWith('.json')) {
        await this.moveFile(file, path.join('docs', 'reports', file));
      }
    }

    console.log('');
  }

  /**
   * Phase 3: Remove test files from root
   */
  async cleanupRootTests() {
    console.log('Phase 3: Cleaning up root test files...\n');

    const testDir = path.join(this.rootDir, 'tests', 'root-tests');
    if (!this.dryRun) {
      await fs.mkdir(testDir, { recursive: true });
      console.log(`Created: tests/root-tests/`);
    }

    const testPatterns = [
      'test-*.js',
      'uat-*.js',
      'simple-test-*.js',
      '*-simulation*.js',
      'pm-*.js',
      'check-*.js',
      'verify-*.js'
    ];

    const files = await fs.readdir(this.rootDir);

    for (const file of files) {
      const shouldMove = testPatterns.some(pattern => {
        const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
        return regex.test(file);
      });

      if (shouldMove && file.endsWith('.js')) {
        // Skip important files
        if (file === 'app.js' || file === 'ecosystem.config.js') {
          continue;
        }
        await this.moveFile(file, path.join('tests', 'root-tests', file));
      }
    }

    console.log('');
  }

  /**
   * Phase 2: Remove ALL microservices (NOT USED)
   */
  async cleanupMicroservices() {
    console.log('�️  Phase 2: Removing ALL microservices directory (NOT USED)...\n');

    await this.deleteDirectory('microservices');

    console.log('');
  }

  /**
   * Phase 5: Remove old/duplicate frontends
   */
  async cleanupOldFrontends() {
    console.log('Phase 5: Checking for duplicate frontends...\n');

    const oldFrontends = [
      'gacp-certification-system',
      'traditional-medicine-docs',
      'frontend-old',
      'frontend-backup'
    ];

    for (const dir of oldFrontends) {
      await this.deleteDirectory(dir);
    }

    console.log('');
  }

  /**
   * Phase 6: Remove old docker configs
   */
  async cleanupDockerConfigs() {
    console.log('Phase 6: Removing old Docker configs...\n');

    const oldDockerFiles = [
      'docker-compose.clean.yml',
      'docker-compose.prod.yml',
      'docker-compose.production.yml',
      'Dockerfile.backend.clean',
      'Dockerfile.microservice'
    ];

    for (const file of oldDockerFiles) {
      await this.deleteFile(file);
    }

    console.log('');
  }

  /**
   * Phase 5: Remove Vite configs (ONLY after Next.js migration)
   */
  async cleanupViteConfigs() {
    console.log('Phase 5: Removing Vite configurations...\n');
    console.log('WARNING: Only run this AFTER Next.js migration is complete!\n');

    const viteFiles = [
      'frontend/vite.config.ts',
      'frontend/postcss.config.js',
      'frontend/tsconfig.app.json',
      'frontend-dtam/vite.config.ts',
      'frontend-dtam/postcss.config.js',
      'frontend-dtam/tsconfig.app.json',
      'microservices/api-trace/frontend/vite.config.js'
    ];

    for (const file of viteFiles) {
      await this.deleteFile(file);
    }

    console.log('');
  }

  /**
   * Phase 6: Remove old modules (ONLY after microservices migration)
   */
  async cleanupOldModules() {
    console.log('Phase 6: Removing old module structure...\n');
    console.log('WARNING: Only run this AFTER microservices are fully migrated!\n');

    const oldDirs = [
      'modules', // Old modular structure
      'routes', // If moved to microservices
      'controllers', // If moved to microservices
      'services' // If moved to microservices (keep shared/)
    ];

    for (const dir of oldDirs) {
      console.log(`Would remove: ${dir}/`);
      console.log(`   Manual verification required\n`);
      this.skippedFiles.push(dir);
    }

    console.log('');
  }

  /**
   * Delete directory recursively
   */
  async deleteDirectory(dirPath) {
    const fullPath = path.join(this.rootDir, dirPath);

    try {
      await fs.access(fullPath);

      if (this.dryRun) {
        console.log(`[DRY RUN] Would delete directory: ${dirPath}/`);
        this.deletedDirs.push(dirPath);
      } else {
        await fs.rm(fullPath, { recursive: true, force: true });
        console.log(`Deleted directory: ${dirPath}/`);
        this.deletedDirs.push(dirPath);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.log(`Could not delete: ${dirPath}/ - ${err.message}`);
        this.skippedFiles.push(dirPath);
      }
    }
  }

  /**
   * Delete single file
   */
  async deleteFile(filePath) {
    const fullPath = path.join(this.rootDir, filePath);

    try {
      await fs.access(fullPath);

      if (this.dryRun) {
        console.log(`[DRY RUN] Would delete file: ${filePath}`);
        this.deletedFiles.push(filePath);
      } else {
        await fs.unlink(fullPath);
        console.log(`Deleted file: ${filePath}`);
        this.deletedFiles.push(filePath);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.log(`Could not delete: ${filePath} - ${err.message}`);
        this.skippedFiles.push(filePath);
      }
    }
  }

  /**
   * Move file to new location
   */
  async moveFile(filePath, newPath) {
    const fullOldPath = path.join(this.rootDir, filePath);
    const fullNewPath = path.join(this.rootDir, newPath);

    try {
      await fs.access(fullOldPath);

      if (this.dryRun) {
        console.log(`[DRY RUN] Would move: ${filePath} → ${newPath}`);
      } else {
        // Ensure destination directory exists
        await fs.mkdir(path.dirname(fullNewPath), { recursive: true });
        await fs.rename(fullOldPath, fullNewPath);
        console.log(`Moved: ${filePath} → ${newPath}`);
      }
      this.deletedFiles.push(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.log(`Could not move: ${filePath} - ${err.message}`);
        this.skippedFiles.push(filePath);
      }
    }
  }

  /**
   * Print summary
   */
  printSummary() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('                  CLEANUP SUMMARY                      ');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log(
      `📁 Directories ${this.dryRun ? 'to be deleted' : 'deleted'}: ${this.deletedDirs.length}`
    );
    this.deletedDirs.forEach(dir => console.log(`   - ${dir}/`));
    console.log('');

    console.log(
      `📄 Files ${this.dryRun ? 'to be deleted/moved' : 'deleted/moved'}: ${this.deletedFiles.length}`
    );
    if (this.deletedFiles.length > 20) {
      console.log(`   (${this.deletedFiles.length} files - showing first 20)`);
      this.deletedFiles.slice(0, 20).forEach(file => console.log(`   - ${file}`));
      console.log(`   ... and ${this.deletedFiles.length - 20} more`);
    } else {
      this.deletedFiles.forEach(file => console.log(`   - ${file}`));
    }
    console.log('');

    if (this.skippedFiles.length > 0) {
      console.log(`Skipped (manual review needed): ${this.skippedFiles.length}`);
      this.skippedFiles.forEach(file => console.log(`   - ${file}`));
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════\n');

    if (this.dryRun) {
      console.log('ℹ️  This was a DRY RUN - no files were actually deleted');
      console.log('   Run with --force to execute the cleanup\n');
    } else {
      console.log('Cleanup completed successfully!\n');
    }

    // Recommendations
    console.log('NEXT STEPS:');
    console.log('   1. Review the changes');
    console.log('   2. Test the application');
    console.log('   3. Commit changes to git');
    console.log('   4. Proceed with Next.js migration');
    console.log('   5. Proceed with microservices separation\n');
  }
}

// Execute cleanup
const cleaner = new ProjectCleaner();
cleaner.cleanup().catch(console.error);

module.exports = ProjectCleaner;
