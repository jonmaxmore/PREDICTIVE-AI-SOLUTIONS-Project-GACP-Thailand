/**
 * Migration script: Updates all imports from '@/components/ui/compat'
 * to the new focused component files.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'apps', 'web-app', 'src');

// Component → new file mapping
const COMPONENT_MAP = {
    // layout-primitives
    Container: '@/components/ui/layout-primitives',
    SimpleGrid: '@/components/ui/layout-primitives',
    Grid: '@/components/ui/layout-primitives',
    AppShell: '@/components/ui/layout-primitives',
    ScrollArea: '@/components/ui/layout-primitives',
    Collapse: '@/components/ui/layout-primitives',

    // action-elements
    ThemeIcon: '@/components/ui/action-elements',
    ActionIcon: '@/components/ui/action-elements',
    UnstyledButton: '@/components/ui/action-elements',
    CloseButton: '@/components/ui/action-elements',
    Burger: '@/components/ui/action-elements',
    NavLink: '@/components/ui/action-elements',
    Anchor: '@/components/ui/action-elements',

    // data-display
    Avatar: '@/components/ui/data-display',
    Timeline: '@/components/ui/data-display',
    Stepper: '@/components/ui/data-display',
    Progress: '@/components/ui/data-display',
    RingProgress: '@/components/ui/data-display',
    Rating: '@/components/ui/data-display',
    Indicator: '@/components/ui/data-display',
    Pagination: '@/components/ui/data-display',
    List: '@/components/ui/data-display',
    Image: '@/components/ui/data-display',
    LoadingOverlay: '@/components/ui/data-display',
    SegmentedControl: '@/components/ui/data-display',

    // form-controls
    NumberInput: '@/components/ui/form-controls',
    FileInput: '@/components/ui/form-controls',
    FileButton: '@/components/ui/form-controls',
    NativeSelect: '@/components/ui/form-controls',
    MultiSelect: '@/components/ui/form-controls',
    Radio: '@/components/ui/form-controls',

    // overlays
    Modal: '@/components/ui/overlays',
    Menu: '@/components/ui/overlays',
    Popover: '@/components/ui/overlays',
    Accordion: '@/components/ui/overlays',

    // primitives card
    Card: '@/components/ui/primitives/card',

    // switch (already has its own file)
    Switch: '@/components/ui/switch',

    // hooks
    useColorScheme: '@/hooks/use-color-scheme',
};

// Recursively find all .tsx/.ts files
function findFiles(dir, ext = ['.tsx', '.ts']) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(findFiles(full, ext));
        } else if (ext.some(e => entry.name.endsWith(e))) {
            results.push(full);
        }
    }
    return results;
}

const COMPAT_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"]@\/components\/ui\/compat['"]\s*;?/g;

let totalFiles = 0;
let totalImports = 0;

for (const file of findFiles(SRC)) {
    let content = fs.readFileSync(file, 'utf8');
    if (!content.includes("@/components/ui/compat")) continue;

    totalFiles++;
    let newContent = content;

    // Find all compat imports
    const matches = [...content.matchAll(COMPAT_IMPORT_RE)];
    if (matches.length === 0) continue;

    for (const match of matches) {
        const importedNames = match[1]
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        // Group by target file
        const groups = {};
        const unknown = [];
        for (const name of importedNames) {
            const target = COMPONENT_MAP[name];
            if (target) {
                if (!groups[target]) groups[target] = [];
                groups[target].push(name);
            } else {
                unknown.push(name);
            }
        }

        // Build new import lines
        const newImports = Object.entries(groups)
            .map(([target, names]) => `import { ${names.join(', ')} } from '${target}';`)
            .join('\n');

        if (unknown.length > 0) {
            console.warn(`Unknown: ${unknown.join(',')} in ${path.relative(SRC, file)}`);
        }

        newContent = newContent.replace(match[0], newImports);
        totalImports += importedNames.length;
    }

    if (newContent !== content) {
        fs.writeFileSync(file, newContent, 'utf8');
        const rel = path.relative(SRC, file);
        console.log(`${rel}`);
    }
}

console.log(`\n Migrated ${totalImports} imports across ${totalFiles} files`);
