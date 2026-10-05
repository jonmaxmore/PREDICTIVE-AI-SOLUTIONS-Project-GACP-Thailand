/**
 * Jest configuration for Backend (Node.js) - NOT Next.js
 * Prevents Next.js config from interfering with backend tests
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/services', '<rootDir>/__tests__', '<rootDir>/chaos-tests'],
  testMatch: ['**/__tests__/**/*.test.js', '**/__tests__/**/*.test.ts', '**/chaos-tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/dist/', '/build/'],
  moduleFileExtensions: ['js', 'ts', 'json'],
  verbose: true,
  maxWorkers: 1, // Run tests serially to avoid DB conflicts
  detectOpenHandles: true, // Detect async operations that prevent Jest from exiting
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Runs ONCE before any suite: probes whether a test database actually answers, and
  // publishes the verdict for test-support/test-database.js. Without this line the probe
  // never runs, so every database-backed suite takes the fail-closed branch and SKIPS
  // SILENTLY — which is worse than the connection-refused errors it replaced, because a
  // silent skip reads as a pass. The skip reason is printed here, once per run, rather than
  // once per suite.
  globalSetup: '<rootDir>/jest.globalsetup.js',
  globalTeardown: '<rootDir>/jest.teardown.js',
  
  // Fix for ES Modules compatibility (uuid@13+)
  transformIgnorePatterns: [
    'node_modules/(?!(uuid|crypto-random-string)/)',
  ],
  
  // Use transform for ES modules
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  
  // No moduleNameMapper for uuid. It used to hard-code
  // '<rootDir>/node_modules/uuid/dist/index.js', a path uuid v11 no longer
  // ships (it moved to dist/cjs/index.js), so the pin to >=11.1.1 would have
  // broken every suite that touches uuid. Rather than re-hard-code the new
  // internal path — and rediscover this on the next restructure — let the
  // package's own `main` (./dist/cjs/index.js) and `exports` map resolve it.
  
  collectCoverageFrom: [
    'services/**/*.js',
    'controllers/**/*.js',
    'middleware/**/*.js',
    '!**/__tests__/**',
    '!**/node_modules/**',
  ],
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 80,
      statements: 80,
    },
  },
};
