/** @type {import('jest').Config} */
const config = {
    // Use jsdom for DOM testing (React components)
    testEnvironment: 'jsdom',
    
    roots: ['<rootDir>/src'],
    
    // Support both .test.ts and .test.tsx
    testMatch: [
        '**/__tests__/**/*.test.ts',
        '**/__tests__/**/*.test.tsx',
        '**/*.test.ts',
        '**/*.test.tsx',
    ],
    
    // The suite runs as CommonJS. 62 of its 218 test files use `__dirname` or
    // `require()`, neither of which exists in an ES module scope, so enabling
    // ESM here makes those files throw at LOAD time — which jest reports as
    // fewer tests rather than as failing assertions. Measured 2026-07-26 with
    // the runner flag as the only variable: ESM gave 113/218 suites failed and
    // 1140 tests run; CommonJS gives 218/218 passed and 1780 tests run. The
    // ESM setup had been hiding 518 tests that never executed.
    // Guarded by scripts/ci/check-webapp-jest-module-mode.js.
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                jsx: 'react-jsx',
            },
        }],
    },

    // `transformIgnorePatterns` used to carve an exception out of
    // node_modules so ts-jest would also transform the ESM-only Firebase SDK
    // (`firebase` + `@firebase`). The SDK was removed with the Firebase Auth
    // login path (e451fd04) and appears in no package.json and no lockfile,
    // so the exception matched nothing and jest's default (`/node_modules/`)
    // is what it effectively was. Left in place it read as evidence that the
    // dependency was still expected. Pinned by
    // apps/backend/__tests__/unit/data-sovereignty-scope.test.js.

    moduleNameMapper: {
        // Stylesheets FIRST. Jest applies the first matching pattern and does
        // not chain, so while this sat below `^@/(.*)$` an aliased import like
        // `@/styles/provider-styles.css` resolved to the real file and jest
        // parsed CSS as JavaScript. The app imports both ways — `./globals.css`
        // in app/layout.tsx, `@/styles/provider-styles.css` in the print view —
        // so only the relative half was ever mocked.
        // Pinned by src/__tests__/css-module-mapping.test.ts.
        '^.+\\.(css|less|scss|sass)$': 'identity-obj-proxy',
        '^@/(.*)$': '<rootDir>/src/$1',
        // Workspace package — mirrors the tsconfig `paths` mapping so jest can
        // resolve `@gacp/validation` when there is no symlink in node_modules.
        '^@gacp/validation$': '<rootDir>/../../packages/validation/src/index.ts',
        '^@gacp/validation/(.*)$': '<rootDir>/../../packages/validation/src/$1',
        // The shared error-report PII scrubber (same module the backend loads).
        '^@gacp/error-reporting/scrub$': '<rootDir>/../../packages/error-reporting/src/scrub.js',
        // Handle static assets
        '^.+\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/__tests__/__mocks__/file-mock.js',
    },
    
    // Setup files
    setupFilesAfterEnv: ['<rootDir>/jest.setup.tsx'],
    
    // Coverage configuration
    collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/*.d.ts',
        '!src/**/__tests__/**',
        '!src/**/node_modules/**',
    ],
    
    coverageThreshold: {
        global: {
            branches: 50,
            functions: 50,
            lines: 50,
            statements: 50,
        },
    },
    
    // Ignore patterns
    testPathIgnorePatterns: [
        '<rootDir>/node_modules/',
        '<rootDir>/.next/',
        '<rootDir>/e2e/',
    ],
    
    // Verbose output for debugging
    verbose: true,
};

export default config;
