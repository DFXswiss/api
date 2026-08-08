import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { FiatRepublicPaymentScheme, FiatRepublicPayeeType } from '../../dto/fiat-republic.dto';
import { FiatRepublicNotCreatedError, FiatRepublicNotFoundError, FiatRepublicService } from '../fiat-republic.service';

const CREDENTIALS = {
  baseUrl: 'https://synthetic.fr/api/v1',
  authUrl: 'https://synthetic.fr/passport/oauth/token',
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
};

function httpError(status: number, errorCode?: string): Error & { response: unknown } {
  return Object.assign(new Error('upstream'), { response: { status, data: { errorCode, message: 'never logged' } } });
}

describe('FiatRepublicService', () => {
  let service: FiatRepublicService;
  let http: DeepMocked<HttpService>;

  beforeEach(async () => {
    http = createMock<HttpService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [FiatRepublicService, { provide: HttpService, useValue: http }, TestUtil.provideConfig()],
    }).compile();

    service = module.get<FiatRepublicService>(FiatRepublicService);

    Object.assign(Config.bank.fiatRepublic, CREDENTIALS, {
      enabled: true,
      bankTxSyncEnabled: false,
      frontendEnabled: false,
      payoutEnabled: false,
      payoutRoutingEnabled: false,
      webhookSecret: undefined,
      masterFiatAccountId: 'fac_synthetic',
      ibanCountry: 'DE',
    });

    // Default: authentication succeeds, every API call resolves to an empty object.
    http.request.mockImplementation(async (config: { url: string }) =>
      config.url === CREDENTIALS.authUrl
        ? ({ access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never)
        : ({} as never),
    );
  });

  afterEach(() => {
    Object.assign(Config.bank.fiatRepublic, {
      baseUrl: undefined,
      authUrl: undefined,
      clientId: undefined,
      clientSecret: undefined,
      webhookSecret: undefined,
      masterFiatAccountId: undefined,
      enabled: false,
      bankTxSyncEnabled: false,
      frontendEnabled: false,
      payoutEnabled: false,
      payoutRoutingEnabled: false,
    });
    jest.restoreAllMocks();
  });

  describe('availability gates', () => {
    it('is configured only when every credential is present', () => {
      expect(service.isConfigured()).toBe(true);

      for (const key of ['baseUrl', 'authUrl', 'clientId', 'clientSecret'] as const) {
        const value = Config.bank.fiatRepublic[key];
        Config.bank.fiatRepublic[key] = undefined;
        expect(service.isConfigured()).toBe(false);
        Config.bank.fiatRepublic[key] = value;
      }
    });

    it('is unavailable with complete credentials but no master release', () => {
      Config.bank.fiatRepublic.enabled = false;

      expect(service.isConfigured()).toBe(true);
      expect(service.isAvailable()).toBe(false);
    });

    it('is unavailable with the master release but no credentials', () => {
      Config.bank.fiatRepublic.clientSecret = undefined;

      expect(service.isAvailable()).toBe(false);
    });

    it.each([
      ['isBankTxSyncEnabled', 'bankTxSyncEnabled'],
      ['isFrontendEnabled', 'frontendEnabled'],
      ['isPayoutEnabled', 'payoutEnabled'],
    ] as const)('%s requires both the master release and its own stage flag', (method, flag) => {
      expect(service[method]()).toBe(false);

      Config.bank.fiatRepublic[flag] = true;
      expect(service[method]()).toBe(true);

      Config.bank.fiatRepublic.enabled = false;
      expect(service[method]()).toBe(false);
    });

    it('never routes payouts without the payout stage being enabled first', () => {
      Config.bank.fiatRepublic.payoutRoutingEnabled = true;

      expect(service.isPayoutEnabled()).toBe(false);
      expect(service.isPayoutRoutingEnabled()).toBe(false);

      Config.bank.fiatRepublic.payoutEnabled = true;
      expect(service.isPayoutRoutingEnabled()).toBe(true);
    });

    it('does not accept webhooks without a webhook secret, even with sync enabled', () => {
      Config.bank.fiatRepublic.bankTxSyncEnabled = true;

      expect(service.isWebhookEnabled()).toBe(false);

      Config.bank.fiatRepublic.webhookSecret = 'synthetic-webhook-secret';
      expect(service.isWebhookEnabled()).toBe(true);
    });

    it('does not accept webhooks when sync is off, even with a secret', () => {
      Config.bank.fiatRepublic.webhookSecret = 'synthetic-webhook-secret';

      expect(service.isWebhookEnabled()).toBe(false);
    });
  });

  describe('authentication', () => {
    it('requests a client credentials token and sends it as a bearer', async () => {
      await service.getFiatAccount('fac_synthetic');

      const [authCall, apiCall] = http.request.mock.calls.map(([config]) => config);
      expect(authCall.url).toBe(CREDENTIALS.authUrl);
      expect(authCall.data).toContain('grant_type=client_credentials');
      expect(authCall.data).toContain('scope=PAYMENTS');
      expect(apiCall.headers.Authorization).toBe('Bearer synthetic-token');
    });

    it('reuses a cached token across calls', async () => {
      await service.getFiatAccount('fac_a');
      await service.getFiatAccount('fac_b');

      expect(http.request.mock.calls.filter(([c]) => c.url === CREDENTIALS.authUrl)).toHaveLength(1);
    });

    it('re-authenticates once the cached token expired', async () => {
      http.request.mockImplementation(async (config: { url: string }) =>
        config.url === CREDENTIALS.authUrl
          ? ({ access_token: 'synthetic-token', token_type: 'bearer', expires_in: 0 } as never)
          : ({} as never),
      );

      await service.getFiatAccount('fac_a');
      await service.getFiatAccount('fac_b');

      expect(http.request.mock.calls.filter(([c]) => c.url === CREDENTIALS.authUrl)).toHaveLength(2);
    });

    it('shares one token request between concurrent callers', async () => {
      await Promise.all([service.getFiatAccount('fac_a'), service.getFiatAccount('fac_b')]);

      expect(http.request.mock.calls.filter(([c]) => c.url === CREDENTIALS.authUrl)).toHaveLength(1);
    });

    it('fails when the token response carries no access token', async () => {
      http.request.mockResolvedValue({ token_type: 'bearer', expires_in: 3600 } as never);

      await expect(service.getFiatAccount('fac_synthetic')).rejects.toThrow('authentication failed');
    });

    it('does not cache a failed authentication', async () => {
      http.request.mockRejectedValueOnce(httpError(401, 'AUTHENTICATION_FAILED'));

      await expect(service.getFiatAccount('fac_a')).rejects.toThrow('authentication failed');

      http.request.mockImplementation(async (config: { url: string }) =>
        config.url === CREDENTIALS.authUrl
          ? ({ access_token: 'second-token', token_type: 'bearer', expires_in: 3600 } as never)
          : ({} as never),
      );
      await service.getFiatAccount('fac_b');

      const apiCall = http.request.mock.calls.map(([c]) => c).find((c) => c.url !== CREDENTIALS.authUrl);
      expect(apiCall.headers.Authorization).toBe('Bearer second-token');
    });

    it('retries an API call once with a fresh token after a 401', async () => {
      let apiCalls = 0;
      http.request.mockImplementation(async (config: { url: string }) => {
        if (config.url === CREDENTIALS.authUrl)
          return { access_token: `token-${apiCalls}`, token_type: 'bearer', expires_in: 3600 } as never;
        if (apiCalls++ === 0) throw httpError(401);
        return { id: 'fac_synthetic' } as never;
      });

      await expect(service.getFiatAccount('fac_synthetic')).resolves.toMatchObject({ id: 'fac_synthetic' });
      expect(apiCalls).toBe(2);
    });

    it('gives up after a second 401', async () => {
      http.request.mockImplementation(async (config: { url: string }) => {
        if (config.url === CREDENTIALS.authUrl)
          return { access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never;
        throw httpError(401);
      });

      await expect(service.getFiatAccount('fac_synthetic')).rejects.toBeInstanceOf(FiatRepublicNotCreatedError);
    });
  });

  describe('error classification', () => {
    it('refuses to call anything while the rail is not released', async () => {
      Config.bank.fiatRepublic.enabled = false;

      await expect(service.getFiatAccount('fac_synthetic')).rejects.toThrow('not configured');
      expect(http.request).not.toHaveBeenCalled();
    });

    it.each([
      [400, FiatRepublicNotCreatedError],
      [403, FiatRepublicNotCreatedError],
      [422, FiatRepublicNotCreatedError],
    ])('classifies a deterministic %i rejection as not-created', async (status, type) => {
      http.request.mockImplementation(async (config: { url: string }) => {
        if (config.url === CREDENTIALS.authUrl)
          return { access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never;
        throw httpError(status, 'INVALID_REQUEST_DATA');
      });

      await expect(service.createPayee({} as never)).rejects.toBeInstanceOf(type);
    });

    it('classifies 404 as not-found', async () => {
      http.request.mockImplementation(async (config: { url: string }) => {
        if (config.url === CREDENTIALS.authUrl)
          return { access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never;
        throw httpError(404, 'RESOURCE_MISSING');
      });

      await expect(service.getPayment('pmt_synthetic')).rejects.toBeInstanceOf(FiatRepublicNotFoundError);
    });

    it.each([409, 429, 500, 503])('leaves an ambiguous %i as a plain error', async (status) => {
      http.request.mockImplementation(async (config: { url: string }) => {
        if (config.url === CREDENTIALS.authUrl)
          return { access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never;
        throw httpError(status);
      });

      const error: unknown = await service.createPayee({} as never).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(FiatRepublicNotCreatedError);
      expect(error).not.toBeInstanceOf(FiatRepublicNotFoundError);
    });

    it('never carries the upstream payload into the thrown message', async () => {
      http.request.mockImplementation(async (config: { url: string }) => {
        if (config.url === CREDENTIALS.authUrl)
          return { access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never;
        throw Object.assign(new Error('upstream'), {
          response: {
            status: 400,
            data: {
              errorCode: 'INVALID_REQUEST_DATA',
              message: 'DE89370400440532013000 is invalid',
              warnings: [{ position: 'bankDetails.iban', issue: 'DE89370400440532013000' }],
            },
          },
        });
      });

      const error: unknown = await service.createPayee({} as never).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('DE89370400440532013000');
      expect((error as Error).message).toContain('INVALID_REQUEST_DATA');
    });

    it('reports a transport failure without a response body', async () => {
      http.request.mockImplementation(async (config: { url: string }) => {
        if (config.url === CREDENTIALS.authUrl)
          return { access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never;
        throw new Error('socket hang up');
      });

      await expect(service.getPayment('pmt_synthetic')).rejects.toThrow('status unknown, code unknown');
    });

    it('reports an authentication transport failure without a response body', async () => {
      http.request.mockRejectedValue(new Error('socket hang up'));

      await expect(service.getPayment('pmt_synthetic')).rejects.toThrow('socket hang up');
    });

    it('reports an authentication failure that is not an Error at all', async () => {
      http.request.mockRejectedValue('not an error');

      await expect(service.getPayment('pmt_synthetic')).rejects.toThrow('unknown error');
    });

    it('reports an authentication failure carrying only an error code', async () => {
      http.request.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { errorCode: 'NOPE' } } }));

      await expect(service.getPayment('pmt_synthetic')).rejects.toThrow('status unknown, code NOPE');
    });

    it('reports an authentication failure carrying only a status', async () => {
      http.request.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 503, data: {} } }));

      await expect(service.getPayment('pmt_synthetic')).rejects.toThrow('status 503, code unknown');
    });

    it('classifies an API failure that is not an Error at all', async () => {
      http.request.mockImplementation(async (config: { url: string }) => {
        if (config.url === CREDENTIALS.authUrl)
          return { access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never;
        throw 'not an error';
      });

      await expect(service.getPayment('pmt_synthetic')).rejects.toThrow('status unknown, code unknown');
    });

    it('keeps an authentication failure identifiable when the retry re-authenticates', async () => {
      let apiCalls = 0;
      http.request.mockImplementation(async (config: { url: string }) => {
        if (config.url === CREDENTIALS.authUrl) {
          if (apiCalls > 0) throw new Error('auth down');
          return { access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never;
        }
        apiCalls++;
        throw httpError(401);
      });

      await expect(service.getPayment('pmt_synthetic')).rejects.toThrow('authentication failed');
    });
  });

  describe('requests', () => {
    beforeEach(() => {
      http.request.mockImplementation(async (config: { url: string }) =>
        config.url === CREDENTIALS.authUrl
          ? ({ access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never)
          : ([] as never),
      );
    });

    const apiCalls = () => http.request.mock.calls.map(([c]) => c).filter((c) => c.url !== CREDENTIALS.authUrl);

    it('creates an individual end user', async () => {
      await service.createIndividualEndUser({ person: {} as never, ipAddress: '203.0.113.1' });

      expect(apiCalls()[0]).toMatchObject({
        url: `${CREDENTIALS.baseUrl}/end-users/individuals`,
        method: 'POST',
      });
    });

    it('reads an individual end user by id', async () => {
      await service.getIndividualEndUser('eus_synthetic');

      expect(apiCalls()[0].url).toBe(`${CREDENTIALS.baseUrl}/end-users/individuals/eus_synthetic`);
    });

    it('lists end users by e-mail', async () => {
      await service.listIndividualEndUsersByEmail('someone@example.com');

      expect(apiCalls()[0].url).toContain('email=someone%40example.com');
    });

    it('reads a fiat account statement for a date window', async () => {
      await service.getFiatAccountStatement('fac_synthetic', new Date('2026-08-01'), new Date('2026-08-05'));

      expect(apiCalls()[0].url).toContain('fiat-accounts/fac_synthetic/statement');
      expect(apiCalls()[0].url).toContain('2026-08-01');
      expect(apiCalls()[0].url).toContain('2026-08-05');
    });

    it('creates a virtual account with an idempotency key', async () => {
      await service.createVirtualAccount(
        { masterFiatAccountId: 'fac_synthetic', ibanCountry: 'DE', endUserId: 'eus_synthetic' },
        'dfx-fr-viban-42',
      );

      expect(apiCalls()[0].headers['Idempotency-Key']).toBe('dfx-fr-viban-42');
    });

    it('reads and lists virtual accounts', async () => {
      await service.getVirtualAccount('vac_synthetic');
      await service.listVirtualAccountsByEndUser('eus_synthetic');
      await service.getVirtualAccountTransactions('vac_synthetic');

      const urls = apiCalls().map((c) => c.url);
      expect(urls[0]).toContain('virtual-accounts/vac_synthetic');
      expect(urls[1]).toContain('endUserId=eus_synthetic');
      expect(urls[2]).toContain('virtual-account-transactions?virtualAccountId=vac_synthetic');
    });

    it('creates, reads and verifies a payee', async () => {
      await service.createPayee({
        type: FiatRepublicPayeeType.PERSON,
        name: 'Synthetic Person',
        currency: 'EUR',
        address: { line1: 'a', city: 'b', postalCode: 'c', country: 'DE' },
        bankDetails: { iban: 'DE00' },
      });
      await service.getPayee('pye_synthetic');
      await service.verifyPayee('pye_synthetic');
      await service.reviewPayeeVerification('pvn_synthetic', true);
      await service.getPayeeVerification('pvn_synthetic');

      const calls = apiCalls();
      expect(calls[0]).toMatchObject({ url: `${CREDENTIALS.baseUrl}/payees`, method: 'POST' });
      expect(calls[1].url).toBe(`${CREDENTIALS.baseUrl}/payees/pye_synthetic`);
      expect(calls[2]).toMatchObject({
        url: `${CREDENTIALS.baseUrl}/payees/pye_synthetic/verification`,
        method: 'POST',
      });
      expect(calls[3]).toMatchObject({
        url: `${CREDENTIALS.baseUrl}/payees/verifications/pvn_synthetic/review`,
        data: { accepted: true },
      });
      expect(calls[4].url).toBe(`${CREDENTIALS.baseUrl}/payees/verifications/pvn_synthetic`);
    });

    it('creates a payment with the idempotency key as a header', async () => {
      await service.createPayment(
        {
          fromId: 'vac_synthetic',
          toId: 'pye_synthetic',
          amount: '10.00',
          reference: 'DFX-FO-1',
          paymentScheme: FiatRepublicPaymentScheme.SCT,
          payeeVerificationId: 'pvn_synthetic',
        },
        'DFX-FO-1',
      );

      expect(apiCalls()[0]).toMatchObject({
        url: `${CREDENTIALS.baseUrl}/payments`,
        method: 'POST',
        headers: { 'Idempotency-Key': 'DFX-FO-1' },
      });
    });

    it('lists payments with the default page size and offset', async () => {
      await service.listPayments(new Date('2026-08-01'), new Date('2026-08-05'));

      expect(apiCalls()[0].url).toContain('limit=100');
      expect(apiCalls()[0].url).toContain('offset=0');
    });

    it('lists end users, virtual accounts and transactions with their default limits', async () => {
      await service.listIndividualEndUsersByEmail('someone@example.com');
      await service.listVirtualAccountsByEndUser('eus_synthetic');
      await service.getVirtualAccountTransactions('vac_synthetic');

      const urls = apiCalls().map((c) => c.url);
      expect(urls[0]).toContain('limit=50');
      expect(urls[1]).toContain('limit=50');
      expect(urls[2]).toContain('limit=100');
    });

    it('reads a payer', async () => {
      await service.getPayer('pyr_synthetic');

      expect(apiCalls()[0].url).toBe(`${CREDENTIALS.baseUrl}/payers/pyr_synthetic`);
    });
  });

  describe('findPaymentByReference', () => {
    function withPages(pages: unknown[][]): void {
      let page = 0;
      http.request.mockImplementation(async (config: { url: string }) =>
        config.url === CREDENTIALS.authUrl
          ? ({ access_token: 'synthetic-token', token_type: 'bearer', expires_in: 3600 } as never)
          : ((pages[page++] ?? []) as never),
      );
    }

    const from = new Date('2026-08-01');
    const to = new Date('2026-08-05');

    it('uses its default page budget and page size', async () => {
      withPages([[{ id: 'pmt_match', reference: 'DFX-FO-7' }]]);

      await expect(service.findPaymentByReference('DFX-FO-7', from, to)).resolves.toMatchObject({ id: 'pmt_match' });
    });

    it('returns the payment carrying the exact reference', async () => {
      withPages([
        [
          { id: 'pmt_other', reference: 'OTHER' },
          { id: 'pmt_match', reference: 'DFX-FO-7' },
        ],
      ]);

      await expect(service.findPaymentByReference('DFX-FO-7', from, to, 5, 2)).resolves.toMatchObject({
        id: 'pmt_match',
      });
    });

    it('returns undefined when the window is exhausted without a match', async () => {
      withPages([[{ id: 'pmt_other', reference: 'OTHER' }]]);

      await expect(service.findPaymentByReference('DFX-FO-7', from, to, 5, 2)).resolves.toBeUndefined();
    });

    it('returns undefined on an empty first page', async () => {
      withPages([[]]);

      await expect(service.findPaymentByReference('DFX-FO-7', from, to, 5, 2)).resolves.toBeUndefined();
    });

    it('pages until it finds the match', async () => {
      withPages([
        [
          { id: 'a', reference: 'A' },
          { id: 'b', reference: 'B' },
        ],
        [{ id: 'c', reference: 'DFX-FO-7' }],
      ]);

      await expect(service.findPaymentByReference('DFX-FO-7', from, to, 5, 2)).resolves.toMatchObject({ id: 'c' });
    });

    it('throws instead of reporting absence when the page budget is exhausted', async () => {
      withPages([
        [
          { id: 'a', reference: 'A' },
          { id: 'b', reference: 'B' },
        ],
        [
          { id: 'c', reference: 'C' },
          { id: 'd', reference: 'D' },
        ],
      ]);

      await expect(service.findPaymentByReference('DFX-FO-7', from, to, 2, 2)).rejects.toThrow(
        'exceeded 2 pages without exhausting the window',
      );
    });
  });
});
