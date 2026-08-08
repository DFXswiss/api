// Fiat Republic coverage gate. Same shape and rationale as jest.frick.config.js: the money path of a
// bank rail is held at 100% per file, enforced by its own step so an unrelated `test:cov` run cannot
// be reddened by it.
const base = require('./package.json').jest;

const full = { branches: 100, functions: 100, lines: 100, statements: 100 };

module.exports = {
  ...base,
  // Coverage instrumentation must match the production build's emit. The main suite runs ts-jest in
  // transpile-only mode (isolatedModules), which emits the emitDecoratorMetadata helpers differently
  // and produces phantom uncovered branches on dependency-injected constructors. Compile with full
  // type info here (tsconfig.coverage.json sets isolatedModules: false) so the 100% gate stays exact.
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.coverage.json' }] },
  coverageThreshold: {
    'src/config/fiat-republic.config.ts': full,
    'src/integration/bank/services/fiat-republic.service.ts': full,
    'src/integration/bank/services/fiat-republic-webhook.service.ts': full,
    'src/integration/bank/services/fiat-republic-end-user.service.ts': full,
    'src/integration/bank/services/fiat-republic-payee.service.ts': full,
    'src/integration/bank/controllers/fiat-republic-webhook.controller.ts': full,
    'src/subdomains/supporting/bank/virtual-iban/providers/fiat-republic-viban.provider.ts': full,
    'src/subdomains/supporting/bank/virtual-iban/dto/fiat-republic-person.mapper.ts': full,
    'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-fiat-republic.service.ts': full,
    'src/subdomains/supporting/fiat-output/fiat-output-fiat-republic.service.ts': full,
  },
};
