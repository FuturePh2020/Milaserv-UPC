/**
 * Unit test config — e2e tests use test/jest-e2e.json.
 * @type {import('jest').Config}
 */
const config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  testEnvironment: 'node',
  passWithNoTests: true,
};

module.exports = config;
