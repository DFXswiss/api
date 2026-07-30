import { Configuration } from 'src/config/config';

const HISTORICAL_SIGN_MESSAGE =
  'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_DeFiChain_address_and_are_in_possession_of_its_private_key._Your_ID:_';
const HISTORICAL_SIGN_MESSAGE_GENERAL =
  'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_';

// Configured sign-message *text* per ENVIRONMENT only — no sign/verify here.
// Cryptographic cross-env replay proof lives in sign-message-cross-env-replay.spec.ts.
describe('sign-message env scope (configured message text differs by ENVIRONMENT)', () => {
  const originalEnv = process.env.ENVIRONMENT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENVIRONMENT;
    } else {
      process.env.ENVIRONMENT = originalEnv;
    }
  });

  it('PRD keeps the historical sign message text byte-for-byte (no prefix)', () => {
    process.env.ENVIRONMENT = 'prd';
    const config = new Configuration();

    expect(config.auth.signMessage).toBe(HISTORICAL_SIGN_MESSAGE);
    expect(config.auth.signMessageGeneral).toBe(HISTORICAL_SIGN_MESSAGE_GENERAL);
  });

  it('DEV uses a distinct sign message text prefixed with [dev]_ (not a crypto proof)', () => {
    process.env.ENVIRONMENT = 'dev';
    const config = new Configuration();

    expect(config.auth.signMessage).not.toBe(HISTORICAL_SIGN_MESSAGE);
    expect(config.auth.signMessageGeneral).not.toBe(HISTORICAL_SIGN_MESSAGE_GENERAL);
    expect(config.auth.signMessage.startsWith('[dev]_')).toBe(true);
    expect(config.auth.signMessageGeneral.startsWith('[dev]_')).toBe(true);
  });

  it('LOC uses a sign message text distinct from the historical PRD text', () => {
    process.env.ENVIRONMENT = 'loc';
    const config = new Configuration();

    expect(config.auth.signMessage).not.toBe(HISTORICAL_SIGN_MESSAGE);
    expect(config.auth.signMessageGeneral).not.toBe(HISTORICAL_SIGN_MESSAGE_GENERAL);
  });

  it('unset ENVIRONMENT uses a sign message text distinct from the historical PRD text', () => {
    delete process.env.ENVIRONMENT;
    const config = new Configuration();

    expect(config.auth.signMessage).not.toBe(HISTORICAL_SIGN_MESSAGE);
    expect(config.auth.signMessageGeneral).not.toBe(HISTORICAL_SIGN_MESSAGE_GENERAL);
  });

  it('an unknown ENVIRONMENT value uses a sign message text distinct from the historical PRD text', () => {
    process.env.ENVIRONMENT = 'staging';
    const config = new Configuration();

    expect(config.auth.signMessage).not.toBe(HISTORICAL_SIGN_MESSAGE);
    expect(config.auth.signMessageGeneral).not.toBe(HISTORICAL_SIGN_MESSAGE_GENERAL);
  });
});
