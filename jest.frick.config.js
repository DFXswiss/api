// Bank Frick coverage gate. Kept out of package.json's shared Jest config so the strict per-file 100%
// threshold on the shared iso20022.service.ts cannot red an unrelated `test:cov` run - only the
// dedicated test:frick:cov step (with its own --collectCoverageFrom scope) enforces it.
const base = require('./package.json').jest;

module.exports = {
  ...base,
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
  },
};
