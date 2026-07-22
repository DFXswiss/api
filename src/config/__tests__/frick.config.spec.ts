import { buildFrickConfig } from '../frick.config';

function env(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe('buildFrickConfig', () => {
  it('passes through baseUrl, apiKey and customer', () => {
    const config = buildFrickConfig(
      env({
        FRICK_BASE_URL: 'https://synthetic.frick',
        FRICK_API_KEY: 'synthetic-key',
        FRICK_CUSTOMER: 'synthetic-customer',
      }),
    );

    expect(config.baseUrl).toBe('https://synthetic.frick');
    expect(config.apiKey).toBe('synthetic-key');
    expect(config.customer).toBe('synthetic-customer');
  });

  it('restores PEM line breaks when private and server public keys are set', () => {
    const config = buildFrickConfig(
      env({
        FRICK_PRIVATE_KEY: 'synthetic-private-one<br>synthetic-private-two',
        FRICK_SERVER_PUBLIC_KEY: 'synthetic-public-one<br>synthetic-public-two',
      }),
    );

    expect(config.privateKey).toBe('synthetic-private-one\nsynthetic-private-two');
    expect(config.serverPublicKey).toBe('synthetic-public-one\nsynthetic-public-two');
  });

  it('leaves both signing keys undefined when they are not set', () => {
    const config = buildFrickConfig(env());

    expect(config.privateKey).toBeUndefined();
    expect(config.serverPublicKey).toBeUndefined();
  });

  it.each([
    ['true', true],
    ['false', false],
    [undefined, false],
  ])('resolves payoutEnabled from %s to %s', (value, expected) => {
    const config = buildFrickConfig(env({ FRICK_PAYOUT_ENABLED: value }));

    expect(config.payoutEnabled).toBe(expected);
  });

  it.each([
    ['true', true],
    ['false', false],
    [undefined, false],
  ])('resolves approveWithoutTan from %s to %s', (value, expected) => {
    const config = buildFrickConfig(env({ FRICK_APPROVE_WITHOUT_TAN: value }));

    expect(config.approveWithoutTan).toBe(expected);
  });

  it('passes through vbanBaseUrl from FRICK_VBAN_BASE_URL when set, and is undefined when unset', () => {
    const withUrl = buildFrickConfig(env({ FRICK_VBAN_BASE_URL: 'https://api.bankfrick.li/vban' }));
    expect(withUrl.vbanBaseUrl).toBe('https://api.bankfrick.li/vban');

    const withoutUrl = buildFrickConfig(env());
    expect(withoutUrl.vbanBaseUrl).toBeUndefined();
  });
});
