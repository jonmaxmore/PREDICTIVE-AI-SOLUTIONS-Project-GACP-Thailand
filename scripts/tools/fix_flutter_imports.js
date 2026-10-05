const fs = require('fs');
const path = require('path');

const TARGET_DIR = path.join(__dirname, '../apps/mobile_app/lib');
const EXCLUDES = ['.dart_tool', 'build', 'generated'];

function toSnakeCase(str) {
    // Basic Pascal to Snake: FooBar -> foo_bar
    // Extension handling
    const ext = path.extname(str);
    const name = path.basename(str, ext);

    // Split by uppercase
    const snake = name.replace(/[A-Z]/g, (letter, index) => {
        return index == 0 ? letter.toLowerCase() : '_' + letter.toLowerCase();
    });

    return snake + ext;
}

function getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        if (EXCLUDES.includes(file)) return;
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

const updatedFiles = getAllFiles(TARGET_DIR);

updatedFiles.forEach(filePath => {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    content = content.replace(/import\s+['"]package:([^/]+)\/([^'"]+)['"]/g, (match, pkg, filesPath) => {
        if (pkg !== 'mobile_app') {
            // It's an external package. Revert path to snake_case if it looks like PascalCase
            // e.g. filesPath = "FlutterRiverpod.dart"
            const parts = filesPath.split('/');
            const newParts = parts.map(p => {
                if (p.includes('.') && /^[A-Z]/.test(p)) { // Only if starts with Uppercase (Pascal)
                    return toSnakeCase(p);
                }
                return p;
            });
            const newPath = newParts.join('/');

            if (newPath !== filesPath) {
                modified = true;
                return `import 'package:${pkg}/${newPath}'`;
            }
        }
        return match;
    });

    if (modified) {
        fs.writeFileSync(filePath, content);
        console.log(`Fixed external imports in: ${path.basename(filePath)}`);
    }
});
