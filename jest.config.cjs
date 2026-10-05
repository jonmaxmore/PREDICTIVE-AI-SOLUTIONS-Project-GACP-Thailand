module.exports = {
  projects: [
    '<rootDir>/apps/backend/jest.config.cjs'
  ],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
  ],
  coverageDirectory: '<rootDir>/coverage',
  collectCoverage: false,
  coverageProvider: 'v8'
};
