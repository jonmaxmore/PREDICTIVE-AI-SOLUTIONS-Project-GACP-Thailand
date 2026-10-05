const fs = require('fs');
const path = require('path');

const TARGET_DIR = path.join(__dirname, '../lib');
const TEST_DIR = path.join(__dirname, '../test');

// Utility: Convert to snake_case
function toSnakeCase(str) {
    if (!/[A-Z]/.test(str)) return str; // Already snake or lower

    return str
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // camelCase -> camel_case
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2') // Handle acronyms like HTTPRequest -> http_request
        .toLowerCase();
}

function getAllFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getAllFiles(filePath, fileList);
            fileList.push({ type: 'dir', path: filePath, name: file, dir: dir });
        } else {
            if (file.endsWith('.dart')) {
                fileList.push({ type: 'file', path: filePath, name: file, dir: dir });
            }
        }
    });
    return fileList;
}

function main() {
    console.log('Starting Refactoring: PascalCase -> snake_case');

    // 1. Collect all items
    let allItems = [...getAllFiles(TARGET_DIR), ...getAllFiles(TEST_DIR)];

    // 2. Filter items that need renaming
    const toRename = allItems.filter(item => {
        const newName = toSnakeCase(item.name);
        return newName !== item.name;
    });

    if (toRename.length === 0) {
        console.log('No files need renaming.');
        return;
    }

    console.log(`Found ${toRename.length} items to rename.`);

    // 3. Update Imports (Scan ALL dart files content)
    // We need to do this BEFORE renaming files on disk so we can match the old content references
    const allDartFiles = allItems.filter(i => i.type === 'file');

    console.log('Updating Imports...');
    allDartFiles.forEach(fileItem => {
        let content = fs.readFileSync(fileItem.path, 'utf8');
        let modified = false;

        toRename.forEach(renameItem => {
            // Basic text replacement for import paths
            // We look for slash + oldName or quote + oldName to avoid partial matches
            // This is a heuristic but generally safe for import '.../OldName.dart';

            if (renameItem.type === 'file') {
                // Replace "OldName.dart" with "old_name.dart"
                // Regex: Match ending boundary to ensure we don't partial replace
                const pattern = new RegExp(renameItem.name.replace('.', '\\.'), 'g');
                const replacement = toSnakeCase(renameItem.name);

                if (content.match(pattern)) {
                    content = content.replace(pattern, replacement);
                    modified = true;
                }
            } else {
                // Directories in imports: import 'package:app/Components/File.dart'
                // We need to replace /Components/ with /components/
                // Be careful not to replace Code class names if they match
                // Imports usually have / or "
                const dirPattern = new RegExp(`/${renameItem.name}/`, 'g');
                const dirReplacement = `/${toSnakeCase(renameItem.name)}/`;

                if (content.match(dirPattern)) {
                    content = content.replace(dirPattern, dirReplacement);
                    modified = true;
                }
            }
        });

        if (modified) {
            fs.writeFileSync(fileItem.path, content, 'utf8');
            console.log(`   Updated imports in: ${fileItem.name}`);
        }
    });

    // 4. Rename Files (First)
    console.log('Renaming Files...');
    toRename.filter(i => i.type === 'file').forEach(item => {
        const newName = toSnakeCase(item.name);
        const newPath = path.join(item.dir, newName);
        fs.renameSync(item.path, newPath);
        console.log(`   Renamed: ${item.name} -> ${newName}`);
    });

    // 5. Rename Directories (Bottom-up depth sort to avoid path invalidation)
    // We didn't sort strictly by depth before, so we must sort now
    console.log('Renaming Directories...');
    const dirsToRename = toRename.filter(i => i.type === 'dir');

    // Sort by path length descending (deepest first)
    dirsToRename.sort((a, b) => b.path.length - a.path.length);

    dirsToRename.forEach(item => {
        // Since we might have renamed children, valid path is tricky if we don't re-evaluate
        // But since we only renamed filenames inside, the directory path *to* this directory is still valid
        // unless a parent was renamed.
        // Wait, if we rename 'Parent/Child', and we rename Child first -> 'Parent/child'.
        // Then we rename Parent -> 'parent'. 'parent/child'. This works.
        // We must start from DEEPEST folders.

        // However, item.path refers to the OLD path.
        // If a parent was already renamed (which shouldn't happen if we sort Deepest First), it's fine.
        // Actually, if we rename Deepest First (Child), the Parent path is still valid (OldParent/Child -> OldParent/child).
        // Then we rename Parent (OldParent -> new_parent).

        const parentDir = path.dirname(item.path);
        // We need to reconstruct the current path because parent might have changed?
        // NO, if we sort by depth descending:
        // /lib/Components/SubComp -> rename SubComp first. /lib/Components is untouched.
        // /lib/Components -> rename Components next. /lib is untouched.
        // So item.path is valid for the directory itself? 
        // YES, provided we haven't renamed its parents yet.

        const newName = toSnakeCase(item.name);
        const targetPath = path.join(parentDir, newName);

        // Check if parent path still exists (it should)
        if (fs.existsSync(item.path)) {
            fs.renameSync(item.path, targetPath);
            console.log(`   Renamed Dir: ${item.name} -> ${newName}`);
        } else {
            console.warn(`Directory not found (maybe parent renamed?): ${item.path}`);
            // Fallback: This happens if our sort logic failed or I misunderstood structure.
            // But simple depth sort is usually enough.
        }
    });

    console.log('Refactoring Complete.');
}

main();
