const fs = require('fs');
const path = require('path');

const TARGET_DIR = path.join(__dirname, '../apps/backend');
const EXCLUDES = ['node_modules', 'dist', 'build', 'coverage', '.git'];

function toPascalCase(str) {
    // Handle extension
    const ext = path.extname(str);
    const name = path.basename(str, ext);

    // Split by hyphen or underscore
    const parts = name.split(/[-_]/);

    // Capitalize first letter of each part
    const pascalName = parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');

    return pascalName + ext;
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
            if (file.endsWith('.js') || file.endsWith('.ts')) {
                fileList.push(filePath);
            }
        }
    });

    return fileList;
}

// 1. Rename Files
const allFiles = getAllFiles(TARGET_DIR);
const renameMap = new Map(); // oldPath -> newPath

allFiles.forEach(filePath => {
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);

    // Check if filename needs renaming (has hyphen or is not PascalCase?)
    // User request: Strict CamelCase. 
    // Usually filenames are PascalCase for classes.
    // Let's target files with hyphens first as primary violators.
    if (fileName.includes('-')) {
        const newFileName = toPascalCase(fileName);
        if (fileName !== newFileName) {
            const newPath = path.join(dir, newFileName);
            renameMap.set(filePath, newPath);
        }
    }
});

console.log(`Found ${renameMap.size} files to rename.`);

// Execute Renames
renameMap.forEach((newPath, oldPath) => {
    try {
        fs.renameSync(oldPath, newPath);
        console.log(`Renamed: ${path.basename(oldPath)} -> ${path.basename(newPath)}`);
    } catch (e) {
        console.error(`Failed to rename ${oldPath}: ${e.message}`);
    }
});

// 2. Update Imports in ALL files (re-scan for new paths)
const updatedFiles = getAllFiles(TARGET_DIR); // Scan again to get new paths

updatedFiles.forEach(filePath => {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Regex for require
    content = content.replace(/require\(['"]([^'"]+)['"]\)/g, (match, importPath) => {
        // Only modify relative paths
        if (importPath.startsWith('.')) {
            const parts = importPath.split('/');
            const filename = parts[parts.length - 1];

            if (filename.includes('-')) {
                // Determine if it was one of the renamed files.
                // Naive approach: just PascalCase the filename part of the import
                // But we must preserve the path structure.

                const before = parts.slice(0, -1).join('/');
                const pascalFilename = toPascalCase(filename); // Pass 'filename' which might not have ext
                // Note: imports usually don't have extension, or might.
                // toPascalCase logic handles extension if present.
                // If no extension, it treats whole string as name.
                // require('./foo-bar') -> parts=['.', 'foo-bar'] -> pascal='FooBar'

                // Special handling: if filename implies folder (e.g. index), usually we don't ref folder names yet?
                // Step 1 only renamed FILES. Folders were not renamed.
                // So updating "foo-bar" to "FooBar" is correct if it refers to a file.
                // If it refers to a folder "foo-bar/index.js", then we shouldn't rename "foo-bar" unless we renamed the folder.
                // My Step 1 script ONLY renamed files.
                // So if import is './folder/file-name', we change to './folder/FileName'.
                // If import is './folder-name/file', we DO NOT change folder-name.

                const newImportPath = before ? `${before}/${pascalFilename}` : pascalFilename;
                if (newImportPath !== importPath) {
                    modified = true;
                    return `require('${newImportPath}')`;
                }
            }
        }
        return match;
    });

    if (modified) {
        fs.writeFileSync(filePath, content);
        console.log(`Updated imports in: ${path.basename(filePath)}`);
    }
});
