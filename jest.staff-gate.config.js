// Staff KYC gate coverage. Kept out of package.json's shared Jest config (same reasoning as
// jest.frick.config.js) so the strict per-file 100% threshold cannot red an unrelated `test:cov` run —
// only the dedicated test:staff-gate:cov step, with its own --collectCoverageFrom scope, enforces it.
//
// These three files decide who reaches every elevated endpoint. A partially covered branch here is an
// unreviewed hole in the authorization path, so they are pinned at 100% on all four metrics.
const base = require('./package.json').jest;

module.exports = {
  ...base,
  // Coverage instrumentation must match the production build's emit. The main suite runs ts-jest in
  // transpile-only mode (isolatedModules), which emits the emitDecoratorMetadata helpers differently
  // and produces phantom uncovered branches on dependency-injected constructors. Compile with full
  // type info here (tsconfig.coverage.json sets isolatedModules: false) so the 100% gate stays exact.
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.coverage.json' }] },
  coverageThreshold: {
    'src/shared/auth/role.guard.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    'src/shared/auth/staff-kyc-clearance.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    'src/shared/auth/exceptions/staff-kyc-required.exception.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    'src/subdomains/generic/user/models/user/staff-kyc-clearance.service.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};
