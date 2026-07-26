/**
 * Jest runs only against pure TypeScript logic (engine, math, features, store
 * helpers). Nothing under test may import React or react-native, which is
 * enforced by the engine/UI separation rule, so the plain `node` environment
 * plus ts-jest is all that is required.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          strict: true,
          esModuleInterop: true,
          module: 'commonjs',
          target: 'es2020',
          moduleResolution: 'node',
        },
      },
    ],
  },
  collectCoverageFrom: ['src/engine/**/*.ts', 'src/math/**/*.ts', 'src/features/**/*.ts'],
};
