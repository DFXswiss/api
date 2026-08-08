import { buildFiatRepublicConfig } from '../fiat-republic.config';

function env(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe('buildFiatRepublicConfig', () => {
  it('passes the credentials through unchanged', () => {
    const config = buildFiatRepublicConfig(
      env({
        FIAT_REPUBLIC_BASE_URL: 'https://synthetic.fr/api/v1',
        FIAT_REPUBLIC_AUTH_URL: 'https://synthetic.fr/passport/oauth/token',
        FIAT_REPUBLIC_CLIENT_ID: 'synthetic-client',
        FIAT_REPUBLIC_CLIENT_SECRET: 'synthetic-secret',
        FIAT_REPUBLIC_WEBHOOK_SECRET: 'synthetic-webhook-secret',
        FIAT_REPUBLIC_MASTER_FIAT_ACCOUNT_ID: 'fac_synthetic',
      }),
    );

    expect(config.baseUrl).toBe('https://synthetic.fr/api/v1');
    expect(config.authUrl).toBe('https://synthetic.fr/passport/oauth/token');
    expect(config.clientId).toBe('synthetic-client');
    expect(config.clientSecret).toBe('synthetic-secret');
    expect(config.webhookSecret).toBe('synthetic-webhook-secret');
    expect(config.masterFiatAccountId).toBe('fac_synthetic');
  });

  it('leaves every credential undefined when nothing is set', () => {
    const config = buildFiatRepublicConfig(env());

    expect(config.baseUrl).toBeUndefined();
    expect(config.authUrl).toBeUndefined();
    expect(config.clientId).toBeUndefined();
    expect(config.clientSecret).toBeUndefined();
    expect(config.webhookSecret).toBeUndefined();
    expect(config.masterFiatAccountId).toBeUndefined();
  });

  it('defaults the EUR IBAN country to DE', () => {
    expect(buildFiatRepublicConfig(env()).ibanCountry).toBe('DE');
  });

  it('lets the environment override the IBAN country', () => {
    expect(buildFiatRepublicConfig(env({ FIAT_REPUBLIC_IBAN_COUNTRY: 'LU' })).ibanCountry).toBe('LU');
  });

  it('leaves every release flag off when the environment is silent', () => {
    const config = buildFiatRepublicConfig(env());

    expect(config.enabled).toBe(false);
    expect(config.bankTxSyncEnabled).toBe(false);
    expect(config.frontendEnabled).toBe(false);
    expect(config.payoutEnabled).toBe(false);
    expect(config.payoutRoutingEnabled).toBe(false);
  });

  it('turns each release flag on independently of the others', () => {
    expect(buildFiatRepublicConfig(env({ FIAT_REPUBLIC_ENABLED: 'true' })).enabled).toBe(true);
    expect(buildFiatRepublicConfig(env({ FIAT_REPUBLIC_BANK_TX_SYNC_ENABLED: 'true' })).bankTxSyncEnabled).toBe(true);
    expect(buildFiatRepublicConfig(env({ FIAT_REPUBLIC_FRONTEND_ENABLED: 'true' })).frontendEnabled).toBe(true);
    expect(buildFiatRepublicConfig(env({ FIAT_REPUBLIC_PAYOUT_ENABLED: 'true' })).payoutEnabled).toBe(true);
    expect(buildFiatRepublicConfig(env({ FIAT_REPUBLIC_PAYOUT_ROUTING_ENABLED: 'true' })).payoutRoutingEnabled).toBe(
      true,
    );
  });

  it('treats anything other than the exact string "true" as off', () => {
    const config = buildFiatRepublicConfig(
      env({
        FIAT_REPUBLIC_ENABLED: 'TRUE',
        FIAT_REPUBLIC_BANK_TX_SYNC_ENABLED: '1',
        FIAT_REPUBLIC_FRONTEND_ENABLED: 'yes',
        FIAT_REPUBLIC_PAYOUT_ENABLED: '',
        FIAT_REPUBLIC_PAYOUT_ROUTING_ENABLED: 'false',
      }),
    );

    expect(config.enabled).toBe(false);
    expect(config.bankTxSyncEnabled).toBe(false);
    expect(config.frontendEnabled).toBe(false);
    expect(config.payoutEnabled).toBe(false);
    expect(config.payoutRoutingEnabled).toBe(false);
  });

  it.each(['', '   '])('keeps the IBAN country default when the variable is blank (%j)', (value) => {
    // An empty or whitespace-only deploy value must not travel to Fiat Republic as an invalid
    // ibanCountry — it falls back to the committed default like an unset variable would.
    expect(buildFiatRepublicConfig(env({ FIAT_REPUBLIC_IBAN_COUNTRY: value })).ibanCountry).toBe('DE');
  });

  it('trims a padded IBAN country', () => {
    expect(buildFiatRepublicConfig(env({ FIAT_REPUBLIC_IBAN_COUNTRY: ' LU ' })).ibanCountry).toBe('LU');
  });
});
