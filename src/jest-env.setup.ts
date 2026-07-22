// Jest-only test fixture defaults for env vars that config.ts requires fail-loud in production.
// This file is wired via package.json "jest.setupFiles" and runs before every test file, BEFORE
// any `new Configuration()`/`GetConfig()` call (directly or via TestUtil.provideConfig). It must
// NEVER be imported by production code — it exists solely so the test suite doesn't have to set
// every required-but-irrelevant-to-the-test env var in 30+ individual spec files. This is not a
// silent production fallback: config.ts still throws fail-loud for a real, unset boot.
if (!process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD) {
  process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD = '0.05';
}
