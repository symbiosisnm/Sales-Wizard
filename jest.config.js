module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.jest.test.js'],
  collectCoverage: true,
  collectCoverageFrom: ['backend/**/*.js', 'src/utils/**/*.js', 'src/preload.js'],
  coveragePathIgnorePatterns: ['/node_modules/', '/__tests__/'],
};
