module.exports = {
  displayName: 'distributed-ml-document-orchestrator',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testTimeout: 30000,
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/distributed-ml-document-orchestrator',
};
