// Read-path projection tests (docs/read-path-projections.md).
//
// Kept out of the main suite for one reason, and it is a hard one: these specs build a TypeORM data
// source from the entity sources, and that needs the decorator metadata to carry real types. The
// main suite runs ts-jest transpile-only (tsconfig.json sets isolatedModules: true), which emits
// `design:type` as `Object` for any imported type — an enum column then fails metadata validation
// with `Data type "Object" ... is not supported`, and no projection spec could run at all. The same
// reasoning is why the Frick and coverage gates compile with tsconfig.coverage.json.
//
// The database gate is shared with the migration specs on purpose: without MIGRATION_TEST_PG these
// suites skip, so a machine with no database still runs a green suite.
const base = require('./package.json').jest;

module.exports = {
  ...base,
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.coverage.json' }] },
  testRegex: '.*\\.projection\\.spec\\.ts$',
  // The guard is installed once for the whole configuration; see jest-projection.setup.ts.
  setupFilesAfterEnv: ['<rootDir>/../jest-projection.setup.ts'],
  // The base config excludes these specs so the main suite does not pick them up. Spreading it in
  // would exclude them here too — this run is the one that must find them.
  testPathIgnorePatterns: ['/node_modules/'],
  // Each spec file creates and drops its own Postgres schema, which is what allows them to run in
  // parallel — but the schema is built by `synchronize` over 112 entities and costs about half a
  // minute, so the wall clock is dominated by how many files there are, not by how many assertions.
  testTimeout: 300000,
};
