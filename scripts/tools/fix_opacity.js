const fs = require('fs');
const path = require('path');

const TARGET_DIR = path.join(__dirname, '../apps/mobile_app/lib');

function getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            getAllFiles(filePath, fileList);
        } else {
            if (file.endsWith('.dart')) {
                fileList.push(filePath);
            }
        }
    });
    return fileList;
}

const files = getAllFiles(TARGET_DIR);
let count = 0;

files.forEach(filePath => {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('.withOpacity(')) {
        const newContent = content.replace(/\.withOpacity\(([^)]+)\)/g, '.withValues(alpha: $1)');
        if (newContent !== content) {
            fs.writeFileSync(filePath, newContent);
            console.log(`Updated: ${path.basename(filePath)}`);
            count++;
        }
    }
});

console.log(`Fixed withOpacity in ${count} files.`);
