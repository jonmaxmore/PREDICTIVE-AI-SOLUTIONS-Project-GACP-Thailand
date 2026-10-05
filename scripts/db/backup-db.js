const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);

// Configuration
const CONFIG = {
    containerName: process.env.DB_CONTAINER || 'gacp-postgres',
    dbUser: process.env.DB_USER || 'gacp',
    dbName: process.env.DB_NAME || 'gacp_db',
    backupDir: path.join(__dirname, '..', 'backups'),
    retentionDays: 7
};

async function main() {
    console.log('GACP Database Backup Utility');
    console.log('-------------------------------');

    try {
        // 1. Ensure Backup Directory Exists
        if (!fs.existsSync(CONFIG.backupDir)) {
            console.log(`Creating backup directory: ${CONFIG.backupDir}`);
            fs.mkdirSync(CONFIG.backupDir, { recursive: true });
        }

        // 2. Generate Filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `gacp_backup_${timestamp}.sql`;
        const filepath = path.join(CONFIG.backupDir, filename);

        // 3. Execute Dump
        console.log(`Starting backup from container: ${CONFIG.containerName}...`);
        // Note: Using -U (User) and -d (Database) inside pg_dump
        // docker exec -t gacp-postgres pg_dump -U gacp gacp_db > filepath
        const command = `docker exec -t ${CONFIG.containerName} pg_dump -U ${CONFIG.dbUser} ${CONFIG.dbName} > "${filepath}"`;

        await execAsync(command);
        console.log(`Backup success: ${filename}`);

        // 4. Verification Check
        const stats = fs.statSync(filepath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`   Size: ${sizeMB} MB`);
        console.log(`   Path: ${filepath}`);

        if (stats.size === 0) {
            console.error('Error: Backup file is empty!');
            fs.unlinkSync(filepath);
            process.exit(1);
        }

        // 5. Cleanup Old Backups (Retention Policy)
        console.log('\nCleaning up old backups...');
        const files = fs.readdirSync(CONFIG.backupDir);
        const now = Date.now();
        let deletedCount = 0;

        for (const file of files) {
            if (file.startsWith('gacp_backup_') && file.endsWith('.sql')) {
                const filePath = path.join(CONFIG.backupDir, file);
                const fileStats = fs.statSync(filePath);
                const ageDays = (now - fileStats.mtimeMs) / (1000 * 60 * 60 * 24);

                if (ageDays > CONFIG.retentionDays) {
                    fs.unlinkSync(filePath);
                    console.log(`   Deleted old backup: ${file}`);
                    deletedCount++;
                }
            }
        }
        if (deletedCount === 0) console.log('   No old backups found to delete.');

    } catch (error) {
        console.error('Backup Failed:', error.message);
        if (error.stderr) console.error('STDERR:', error.stderr);
        process.exit(1);
    }
}

main();
