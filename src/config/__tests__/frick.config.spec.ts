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

  it('restores PEM line breaks when the private key is set', () => {
    const config = buildFrickConfig(env({ FRICK_PRIVATE_KEY: 'synthetic-line-one<br>synthetic-line-two' }));

    expect(config.privateKey).toBe('synthetic-line-one\nsynthetic-line-two');
  });

  it('leaves the private key undefined when it is not set', () => {
    const config = buildFrickConfig(env());

    expect(config.privateKey).toBeUndefined();
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
});
