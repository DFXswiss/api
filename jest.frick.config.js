// Bank Frick coverage gate. Kept out of package.json's shared Jest config so the strict per-file 100%
// threshold on the shared iso20022.service.ts cannot red an unrelated `test:cov` run - only the
// dedicated test:frick:cov step (with its own --collectCoverageFrom scope) enforces it.
const base = require('./package.json').jest;

module.exports = {
  ...base,
  // Coverage instrumentation must match the production build's emit. The main suite runs ts-jest in
  // transpile-only mode (isolatedModules), which emits the emitDecoratorMetadata helpers differently
  // and produces phantom uncovered branches on dependency-injected constructors. Compile with full
  // type info here (tsconfig.coverage.json sets isolatedModules: false) so the 100% gate stays exact.
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.coverage.json' }] },
  coverageThreshold: {
    'src/integration/bank/dto/frick.dto.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    'src/integration/bank/services/frick.service.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    'src/integration/bank/services/iso20022.service.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    'src/config/frick.config.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-frick.service.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-outgoing-match.service.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    'src/subdomains/supporting/fiat-output/fiat-output-frick.service.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    'src/subdomains/supporting/bank/virtual-iban/providers/frick-viban.provider.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};
