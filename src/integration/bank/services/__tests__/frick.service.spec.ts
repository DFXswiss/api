import { createSign, generateKeyPairSync, verify } from 'crypto';
import * as IbanTools from 'ibantools';
import { Config, ConfigService } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { FrickVirtualIbanState } from '../../dto/frick-vban.dto';
import {
  FrickPaymentCharge,
  FrickPaymentOrder,
  FrickPaymentOrderNotFoundError,
  FrickPaymentState,
  FrickPaymentType,
  FrickSignatureVerificationError,
  FrickTransactionsResponse,
} from '../../dto/frick.dto';
import { BankFrickService, FrickVibanNotCreatedError } from '../frick.service';

describe('BankFrickService', () => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const debtorIban = createSyntheticIban('LI', '00000TESTACCOUNT1');
  const creditorIban = createSyntheticIban('DE', '000000000000000001');

  let http: { request: jest.Mock };
  let service: BankFrickService;

  beforeAll(() => new ConfigService());

  beforeEach(() => {
    Config.bank.frick = {
      baseUrl: 'https://bank.invalid/webapi/v2/',
      apiKey: 'synthetic-api-key',
      privateKey: keys.privateKey,
      serverPublicKey: keys.publicKey,
      customer: '0000000',
      payoutEnabled: false,
      approveWithoutTan: false,
      vbanBaseUrl: 'https://vban.bank.invalid/vban/',
    };
    http = { request: jest.fn() };
    service = new BankFrickService(http as unknown as HttpService);
  });

  it('signs the exact serialized authorize body and normalizes the base URL', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(accountsResponse());

    await service.getBalances();

    const authorize = http.request.mock.calls[0][0];
    expect(authorize.url).toBe('https://bank.invalid/webapi/v2/authorize');
    expect(authorize.data).toBe(JSON.stringify({ key: 'synthetic-api-key' }));
    expect(authorize.headers.algorithm).toBe('rsa-sha512');
    expect(authorize.headers.Authorization).toBeUndefined();
    expectSignature(authorize.data, authorize.headers.Signature);
    expect(http.request.mock.calls[1][0].url).toBe('https://bank.invalid/webapi/v2/accounts/0000000');
    // Combined with the unbounded cron lock on the status poller, a hung connection with no timeout
    // would silently kill it permanently.
    expect(authorize.timeout).toBe(30_000);
    expect(http.request.mock.calls[1][0].timeout).toBe(30_000);

    for (const [index, [request]] of http.request.mock.calls.entries()) {
      const rawResponse = JSON.stringify({ syntheticResponse: index });
      const signer = createSign('sha512');
      signer.update(rawResponse);
      expect(() =>
        request.responseVerifier(rawResponse, {
          signature: signer.sign(keys.privateKey, 'base64'),
          algorithm: 'rsa-sha512',
        }),
      ).not.toThrow();
    }
  });

  it('signs bodyless GET requests over the empty string and caches the JWT', async () => {
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce(accountsResponse())
      .mockResolvedValueOnce(accountsResponse());

    await service.getBalances();
    await service.getBalances();

    const accountCalls = http.request.mock.calls
      .map(([request]) => request)
      .filter((request) => request.url.endsWith('/accounts/0000000'));
    expect(accountCalls).toHaveLength(2);
    expect(accountCalls[0].data).toBe('');
    expect(accountCalls[0].headers.Authorization).toMatch(/^Bearer /);
    expectSignature('', accountCalls[0].headers.Signature);
    expect(http.request.mock.calls.filter(([request]) => request.url.endsWith('/authorize'))).toHaveLength(1);
  });

  it('shares one in-flight authorization across concurrent requests', async () => {
    let resolveAuthorization: (value: { token: string }) => void;
    const authorization = new Promise<{ token: string }>((resolve) => (resolveAuthorization = resolve));
    http.request.mockImplementation((request) =>
      request.url.endsWith('/authorize') ? authorization : Promise.resolve(accountsResponse()),
    );

    const requests = [service.getBalances(), service.getBalances(), service.getBalances()];
    await Promise.resolve();
    expect(http.request.mock.calls.filter(([request]) => request.url.endsWith('/authorize'))).toHaveLength(1);
    resolveAuthorization({ token: jwt() });
    await Promise.all(requests);
  });

  it('refreshes once after a 401 and retries the original request once', async () => {
    let authorizationCount = 0;
    let accountCount = 0;
    http.request.mockImplementation((request) => {
      if (request.url.endsWith('/authorize')) return Promise.resolve({ token: jwt(++authorizationCount) });
      if (request.url.endsWith('/accounts/0000000') && ++accountCount === 1)
        return Promise.reject({ response: { status: 401 } });
      return Promise.resolve(accountsResponse());
    });

    await expect(service.getBalances()).resolves.toHaveLength(1);
    expect(authorizationCount).toBe(2);
    expect(accountCount).toBe(2);
  });

  it('never retries an unauthorized request more than once', async () => {
    let authorizationCount = 0;
    let accountCount = 0;
    http.request.mockImplementation((request) => {
      if (request.url.endsWith('/authorize')) return Promise.resolve({ token: jwt(++authorizationCount) });
      accountCount += 1;
      return Promise.reject({ response: { status: 401 } });
    });

    await expect(service.getBalances()).rejects.toThrow('HTTP 401');
    expect(authorizationCount).toBe(2);
    expect(accountCount).toBe(2);
  });

  it('does not propagate arbitrary transport messages that could contain credentials', async () => {
    http.request.mockRejectedValueOnce(new Error('transport included synthetic-api-key'));
    const request = service.getBalances();

    await expect(request).rejects.toThrow('Bank Frick authorization failed: request failed');
    await expect(request).rejects.not.toThrow('synthetic-api-key');
  });

  it('reports a tampered response signature distinctly from a generic transport failure, both during authorization and a normal request', async () => {
    // A FrickSignatureVerificationError is what HttpService.request() throws internally when
    // verifyResponse rejects a response - simulated directly here since http.request is mocked at
    // the HttpService boundary.
    http.request.mockRejectedValueOnce(new FrickSignatureVerificationError('Invalid Bank Frick response signature'));
    await expect(service.getBalances()).rejects.toThrow(
      'Bank Frick authorization response signature verification failed: Invalid Bank Frick response signature',
    );

    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockRejectedValueOnce(new FrickSignatureVerificationError('Invalid Bank Frick response signature headers'));
    await expect(service.getBalances()).rejects.toThrow(
      'Bank Frick response signature verification failed (GET accounts/0000000): Invalid Bank Frick response signature headers',
    );
  });

  it('fails loud when connection configuration is incomplete', async () => {
    Config.bank.frick.privateKey = undefined;

    expect(service.isAvailable()).toBe(false);
    await expect(service.getBalances()).rejects.toThrow('Bank Frick is not configured');
    expect(http.request).not.toHaveBeenCalled();
  });

  it.each(['baseUrl', 'apiKey', 'privateKey', 'serverPublicKey', 'customer'] as const)(
    'reports the integration unavailable when %s is missing',
    (field) => {
      Config.bank.frick[field] = undefined;

      expect(service.isAvailable()).toBe(false);
    },
  );

  it.each([
    ['rsa-sha512', 'sha512'],
    ['rsa-sha384', 'sha384'],
    ['rsa-sha256', 'sha256'],
  ] as const)('verifies exact response bytes for %s', (headerAlgorithm, hashAlgorithm) => {
    const body = '{ "synthetic": "response bytes" }';
    const signer = createSign(hashAlgorithm);
    signer.update(body);
    const signature = signer.sign(keys.privateKey, 'base64');

    expect(() =>
      service['verifyResponse'](Buffer.from(body), { Signature: signature, Algorithm: headerAlgorithm } as never),
    ).not.toThrow();
  });

  it.each([
    [{}, 'Invalid Bank Frick response signature headers'],
    [{ signature: 'not-a-signature', algorithm: 'rsa-sha512' }, 'Invalid Bank Frick response signature'],
    [{ signature: 'irrelevant', algorithm: 'rsa-pss-sha512' }, 'Invalid Bank Frick response signature headers'],
  ])('rejects missing, invalid or unsupported response signatures', (headers, expectedError) => {
    expect(() => service['verifyResponse'](Buffer.from('{"synthetic":true}'), headers as never)).toThrow(expectedError);
  });

  it('fails closed when a payment is attempted without the explicit payout flag', async () => {
    await expect(service.createPaymentOrder(paymentInput())).rejects.toThrow('payout is not explicitly enabled');
    await expect(service.approvePaymentWithoutTan(paymentOrder())).rejects.toThrow('payout is not explicitly enabled');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('fails closed when approval without TAN is not explicitly enabled', async () => {
    Config.bank.frick.payoutEnabled = true;

    await expect(service.approvePaymentWithoutTan(paymentOrder())).rejects.toThrow(
      'approval without TAN is not explicitly enabled',
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  it('recovers an existing idempotent order by customId without sending a PUT', async () => {
    Config.bank.frick.payoutEnabled = true;
    const order = paymentOrder();
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(transactionsResponse([order]));

    await expect(service.createPaymentOrder(paymentInput())).resolves.toEqual(order);

    expect(http.request.mock.calls.some(([request]) => request.method === 'PUT')).toBe(false);
    expect(http.request.mock.calls[1][0].url).toContain('transactions?customId=DFX-FO-42');
    expect(http.request.mock.calls[1][0].url).toContain('fromDate=1970-01-01');
  });

  it('recovers BOOKED orders through the explicit historical lookup', async () => {
    Config.bank.frick.payoutEnabled = true;
    const order = paymentOrder({ state: FrickPaymentState.BOOKED });
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce(transactionsResponse([]))
      .mockResolvedValueOnce(transactionsResponse([order]));

    await expect(service.createPaymentOrder(paymentInput())).resolves.toEqual(order);

    const requests = http.request.mock.calls.map(([request]) => request);
    expect(requests[1].url).toContain('transactions?customId=DFX-FO-42');
    expect(requests[1].url).toContain('fromDate=1970-01-01');
    expect(requests[2].url).toContain('status=BOOKED');
    expect(requests[2].url).toContain('fromDate=1970-01-01');
    expect(requests.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('signs and sends the payment JSON exactly once serialized', async () => {
    Config.bank.frick.payoutEnabled = true;
    const order = paymentOrder();
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce(transactionsResponse([]))
      .mockResolvedValueOnce(transactionsResponse([]))
      .mockResolvedValueOnce(transactionsResponse([order]));

    await service.createPaymentOrder(paymentInput());

    const put = http.request.mock.calls.map(([request]) => request).find((request) => request.method === 'PUT');
    expect(JSON.parse(put.data)).toEqual({
      transactions: [
        {
          customId: 'DFX-FO-42',
          type: 'SEPA',
          amount: 10.25,
          currency: 'EUR',
          express: false,
          reference: 'Synthetic payout 42',
          debitor: { iban: debtorIban },
          creditor: { name: 'Synthetic Recipient', iban: creditorIban },
        },
      ],
    });
    expectSignature(put.data, put.headers.Signature);
  });

  it('creates an instant SEPA transaction and rejects instant CHF', () => {
    expect(service['createTransaction']({ ...paymentInput(), instant: true })).toMatchObject({
      type: FrickPaymentType.SEPA_INSTANT,
      currency: 'EUR',
    });
    expect(service['createTransaction']({ ...paymentInput(), instant: true })).not.toHaveProperty('express');

    expect(() =>
      service['createTransaction']({
        ...paymentInput(),
        currency: 'CHF',
        instant: true,
        charge: FrickPaymentCharge.SHARED,
        creditor: { ...paymentInput().creditor, bic: 'TESTDEFF' },
      }),
    ).toThrow('instant payments are only supported for EUR');
  });

  it('rejects unsupported currencies before contacting Bank Frick', async () => {
    Config.bank.frick.payoutEnabled = true;

    await expect(service.createPaymentOrder({ ...paymentInput(), currency: 'USD' as 'EUR' })).rejects.toThrow(
      'Unsupported Bank Frick currency: USD',
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  it('rejects CHF payments without both BIC and charge before creating an order', async () => {
    Config.bank.frick.payoutEnabled = true;
    const input = { ...paymentInput(), currency: 'CHF' as const };

    await expect(service.createPaymentOrder(input)).rejects.toThrow('requires creditor BIC');
    expect(http.request).not.toHaveBeenCalled();

    const inputWithBic = { ...input, creditor: { ...input.creditor, bic: 'TESTLI22' } };
    await expect(service.createPaymentOrder(inputWithBic)).rejects.toThrow('requires a valid charge');
  });

  it('rejects a non-SEPA creditor IBAN before creating an EUR order', async () => {
    Config.bank.frick.payoutEnabled = true;
    const input = {
      ...paymentInput(),
      creditor: { ...paymentInput().creditor, iban: 'BR1500000000000010932840814P2' },
    };

    await expect(service.createPaymentOrder(input)).rejects.toThrow('EUR payout requires a SEPA creditor IBAN');
    expect(http.request).not.toHaveBeenCalled();
  });

  it("enforces Bank Frick's documented 35-character creditor name limit", async () => {
    Config.bank.frick.payoutEnabled = true;
    const input = {
      ...paymentInput(),
      creditor: { ...paymentInput().creditor, name: 'A'.repeat(36) },
    };

    await expect(service.createPaymentOrder(input)).rejects.toThrow('creditor name exceeds 35 characters');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('normalizes every optional FOREIGN creditor field', () => {
    const transaction = service['createTransaction']({
      ...paymentInput(),
      currency: 'CHF',
      charge: FrickPaymentCharge.OUR,
      creditor: {
        name: ' Synthetic Recipient ',
        iban: creditorIban.toLowerCase(),
        bic: ' test de ff ',
        address: ' Synthetic Street 42 ',
        postalcode: ' 8000 ',
        city: ' Zurich ',
        country: ' CH ',
        creditInstitution: ' Synthetic Bank ',
      },
    });

    expect(transaction).toMatchObject({
      type: FrickPaymentType.FOREIGN,
      charge: FrickPaymentCharge.OUR,
      creditor: {
        name: 'Synthetic Recipient',
        iban: creditorIban,
        bic: 'TESTDEFF',
        address: 'Synthetic Street 42',
        postalcode: '8000',
        city: 'Zurich',
        country: 'CH',
        creditInstitution: 'Synthetic Bank',
      },
    });
  });

  it.each([
    [undefined, 'creditor is required'],
    [{ name: 'Synthetic Recipient', iban: creditorIban, address: 'A'.repeat(71) }, 'creditor address exceeds'],
    [{ name: 'Synthetic Recipient', iban: creditorIban, postalcode: '1'.repeat(12) }, 'creditor postal code exceeds'],
    [{ name: 'Synthetic Recipient', iban: creditorIban, city: 'A'.repeat(71) }, 'creditor city exceeds'],
    [{ name: 'Synthetic Recipient', iban: creditorIban, country: 'A'.repeat(71) }, 'creditor country exceeds'],
    [{ name: 'Synthetic Recipient', iban: creditorIban, bic: 'INVALID' }, 'Invalid creditor BIC'],
    [
      { name: 'Synthetic Recipient', iban: creditorIban, creditInstitution: 'A'.repeat(51) },
      'credit institution exceeds',
    ],
  ])('rejects malformed creditor details %#', (creditor, expectedError) => {
    expect(() => service['validateCreditor'](creditor)).toThrow(expectedError);
  });

  it.each([Number.NaN, 0, 1_000_000_000_000, 1.001])('rejects invalid payment amount %s', (amount) => {
    expect(() => service['validateAmount'](amount)).toThrow('Invalid Bank Frick payment amount');
  });

  it('rejects blank identifiers and invalid IBAN values', () => {
    expect(() => service['validateString']('', 'customId', 50, true)).toThrow('Invalid Bank Frick customId');
    expect(() => service['normalizeAndValidateIban'](undefined, 'account IBAN')).toThrow(
      'Invalid Bank Frick account IBAN',
    );
    expect(() => service['normalizeAndValidateIban']('DE00INVALID', 'account IBAN')).toThrow(
      'Invalid Bank Frick account IBAN',
    );
  });

  it('rejects an existing customId when any sent payment detail differs', async () => {
    Config.bank.frick.payoutEnabled = true;
    const input = {
      ...paymentInput(),
      currency: 'CHF' as const,
      charge: FrickPaymentCharge.SHARED,
      creditor: { ...paymentInput().creditor, bic: 'TESTDEFF' },
    };
    const conflicting = paymentOrder({
      type: FrickPaymentType.FOREIGN,
      currency: 'CHF',
      charge: FrickPaymentCharge.SHARED,
      creditor: { ...paymentOrder().creditor, bic: 'OTHERDFF' },
    });
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(transactionsResponse([conflicting]));

    await expect(service.createPaymentOrder(input)).rejects.toThrow('customId collision');
    expect(http.request.mock.calls.some(([request]) => request.method === 'PUT')).toBe(false);
  });

  it('accepts a semantically identical FOREIGN order with normalized optional fields', () => {
    const input = {
      ...paymentInput(),
      currency: 'CHF' as const,
      charge: FrickPaymentCharge.SHARED,
      creditor: {
        ...paymentInput().creditor,
        bic: 'TESTDEFF',
        address: 'Synthetic Street 42',
        postalcode: '8000',
        city: 'Zurich',
        country: 'CH',
        creditInstitution: 'Synthetic Bank',
      },
    };
    const requested = service['createTransaction'](input);
    const existing = paymentOrder({
      type: FrickPaymentType.FOREIGN,
      currency: 'CHF',
      charge: FrickPaymentCharge.SHARED,
      debitor: { iban: ` ${debtorIban.toLowerCase()} ` },
      creditor: {
        name: ' Synthetic Recipient ',
        iban: ` ${creditorIban.toLowerCase()} `,
        bic: ' testdeffxxx ',
        address: ' Synthetic Street 42 ',
        postalcode: ' 8000 ',
        city: ' Zurich ',
        country: ' CH ',
        creditInsitution: ' Synthetic Bank ',
      },
    });

    expect(() => service['assertSamePayment'](existing, requested)).not.toThrow();
  });

  it('matches an idempotent order when both references are omitted', () => {
    const requested = service['createTransaction']({ ...paymentInput(), reference: undefined });
    const existing = paymentOrder({ reference: undefined });

    expect(() => service['assertSamePayment'](existing, requested)).not.toThrow();
  });

  it('falls back to the documented customId selector when the JSON order id is unsafe', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = true;
    const order = paymentOrder({ orderId: Number.MAX_SAFE_INTEGER + 1 });
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(transactionsResponse([order]));

    await service.approvePaymentWithoutTan(order);

    const approval = http.request.mock.calls[1][0];
    expect(JSON.parse(approval.data)).toEqual({ customIds: ['DFX-FO-42'] });
    expect(service.getSafeOrderId(order)).toBeUndefined();
    expectSignature(approval.data, approval.headers.Signature);
  });

  it('uses the bank order id selector when the order id is safely representable', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = true;
    const order = paymentOrder();
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(transactionsResponse([order]));

    await service.approvePaymentWithoutTan(order);

    const approval = http.request.mock.calls[1][0];
    expect(JSON.parse(approval.data)).toEqual({ orderIds: [4242] });
    expectSignature(approval.data, approval.headers.Signature);
  });

  it('returns a safe positive order id', () => {
    expect(service.getSafeOrderId(paymentOrder())).toBe('4242');
    expect(service.getSafeOrderId(paymentOrder({ orderId: 0 }))).toBeUndefined();
  });

  it('gets an existing payment order and rejects a missing one', async () => {
    const order = paymentOrder();
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(transactionsResponse([order]));

    await expect(service.getPaymentOrder('DFX-FO-42')).resolves.toEqual(order);

    http = { request: jest.fn() };
    service = new BankFrickService(http as unknown as HttpService);
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce(transactionsResponse([]))
      .mockResolvedValueOnce(transactionsResponse([]));
    await expect(service.getPaymentOrder('DFX-FO-42')).rejects.toThrow(FrickPaymentOrderNotFoundError);
  });

  it('resolves a real Bank Frick BOOKED response that carries neither customId nor type', async () => {
    // Reproduces the Bank Frick spec's actual BOOKED transaction shape: settled payouts never echo
    // customId/type, only orderId/state/amount/currency/debitor/creditor. A prior, stricter validator
    // unconditionally required both fields and made this the normal success path throw forever.
    const bookedPayload = {
      orderId: 4242,
      state: FrickPaymentState.BOOKED,
      amount: '10.25',
      currency: 'EUR',
      debitor: { iban: debtorIban },
      creditor: { name: 'Synthetic Recipient', iban: creditorIban },
    };
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce(transactionsResponse([bookedPayload as unknown as FrickPaymentOrder]));

    await expect(service.getPaymentOrder('DFX-FO-42')).resolves.toEqual(bookedPayload);
  });

  it('trusts the customId-scoped filter for a BOOKED response missing customId, but still rejects one with a genuinely mismatched customId', async () => {
    const bookedWithoutCustomId = {
      orderId: 1,
      state: FrickPaymentState.BOOKED,
      amount: '1.00',
      currency: 'EUR',
      debitor: { iban: debtorIban },
      creditor: { name: 'Synthetic Recipient', iban: creditorIban },
    };
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce(transactionsResponse([bookedWithoutCustomId as unknown as FrickPaymentOrder]));

    await expect(
      service['getFilteredPaymentOrder'](new URLSearchParams({ customId: 'DFX-FO-42' }), 'DFX-FO-42'),
    ).resolves.toEqual(bookedWithoutCustomId);

    http.request.mockResolvedValueOnce(
      transactionsResponse([{ ...bookedWithoutCustomId, customId: 'DFX-FO-OTHER' } as unknown as FrickPaymentOrder]),
    );
    await expect(
      service['getFilteredPaymentOrder'](new URLSearchParams({ customId: 'DFX-FO-42' }), 'DFX-FO-42'),
    ).rejects.toThrow('Invalid Bank Frick payment lookup response for DFX-FO-42');
  });

  it.each([
    [undefined],
    [{}],
    [{ moreResults: false, resultSetSize: 0 }],
    [{ moreResults: false, resultSetSize: 0, transactions: [] }],
  ])('treats empty Bank Frick transaction lookup shapes as no-match %#', async (response) => {
    expect(service['isEmptyTransactionsResponse'](response)).toBe(true);

    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await expect(
      service['getFilteredPaymentOrder'](new URLSearchParams({ customId: 'DFX-FO-42' }), 'DFX-FO-42'),
    ).resolves.toBeUndefined();
  });

  it.each([
    [{ moreResults: false, resultSetSize: 1, transactions: [] }],
    [{ moreResults: true, resultSetSize: 0 }],
    ['x'],
  ])('does not treat responses with a positive signal as empty %#', async (response) => {
    expect(service['isEmptyTransactionsResponse'](response)).toBe(false);

    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await expect(
      service['getFilteredPaymentOrder'](new URLSearchParams({ customId: 'DFX-FO-42' }), 'DFX-FO-42'),
    ).rejects.toThrow('Invalid Bank Frick transactions response');
  });

  it.each([
    [{ data: { transactions: [{ orderId: 1, state: 'BOOKED' }] } }],
    [[{ orderId: 1 }]],
    [{ error: 'maintenance' }],
    [{ resultSetSize: '0' }],
    [{ moreResults: 'false' }],
    [{ transactions: {} }],
    [false],
    [0],
  ])('does not treat non-whitelisted lookup shapes as empty %#', async (response) => {
    expect(service['isEmptyTransactionsResponse'](response)).toBe(false);

    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await expect(
      service['getFilteredPaymentOrder'](new URLSearchParams({ customId: 'DFX-FO-42' }), 'DFX-FO-42'),
    ).rejects.toThrow('Invalid Bank Frick transactions response');
  });

  it('still rejects an invalid PUT payment response after empty lookup results', async () => {
    Config.bank.frick.payoutEnabled = true;
    // Both lookups return the whitelisted empty shape so createPaymentOrder proceeds to PUT; the PUT
    // response deliberately violates requireTypeAndCustomId (missing customId) so getSinglePayment
    // must still fail closed.
    const putWithoutCustomId = {
      moreResults: false,
      resultSetSize: 1,
      transactions: [
        {
          orderId: 4242,
          state: FrickPaymentState.PREPARED,
          type: FrickPaymentType.SEPA,
          amount: 10.25,
          currency: 'EUR',
          debitor: { iban: debtorIban },
          creditor: { name: 'Synthetic Recipient', iban: creditorIban },
        },
      ],
    };
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(putWithoutCustomId);

    await expect(service.createPaymentOrder(paymentInput())).rejects.toThrow(
      'Invalid Bank Frick payment order response',
    );
  });

  it('includes a sanitized shape diagnosis when the transactions envelope is invalid', () => {
    const invalid = {
      moreResults: 'not-a-boolean',
      resultSetSize: 1,
      transactions: [paymentOrder()],
    };

    expect(() => service['validateTransactionsResponse'](invalid as never, true)).toThrow(
      'Invalid Bank Frick transactions response',
    );

    let message = '';
    try {
      service['validateTransactionsResponse'](invalid as never, true);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/moreResults=|transactions=/);
    expect(message).not.toContain('Synthetic Recipient');
    expect(message).not.toContain(creditorIban);
    expect(message).not.toContain(debtorIban);
  });

  it('does not leak string resultSetSize values in the shape diagnosis', () => {
    const invalid = { resultSetSize: 'SECRET' };

    let message = '';
    try {
      service['validateTransactionsResponse'](invalid as never, true);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('Invalid Bank Frick transactions response');
    expect(message).toContain('typeof string');
    expect(message).not.toContain('SECRET');
  });

  it('caps key names and key count in the shape diagnosis', () => {
    const longKey = 'aVeryLongUnexpectedResponseKeyName';
    const invalid = Object.fromEntries([[longKey, 1], ...Array.from({ length: 11 }, (_, i) => [`k${i}`, i])]);

    let message = '';
    try {
      service['validateTransactionsResponse'](invalid as never, true);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain(`keys: [${longKey.slice(0, 24)}, k0`);
    expect(message).toContain('k8, +2 more], moreResults=');
    expect(message).not.toContain(longKey);
  });

  it('recognises an already-BOOKED order missing customId/type as idempotent instead of a collision', async () => {
    Config.bank.frick.payoutEnabled = true;
    const bookedWithoutCustomIdOrType = {
      orderId: 1,
      state: FrickPaymentState.BOOKED,
      amount: 10.25,
      currency: 'EUR',
      express: false,
      reference: 'Synthetic payout 42',
      debitor: { iban: debtorIban },
      creditor: { name: 'Synthetic Recipient', iban: creditorIban },
    };
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce(transactionsResponse([bookedWithoutCustomIdOrType as unknown as FrickPaymentOrder]));

    await expect(service.createPaymentOrder(paymentInput())).resolves.toEqual(bookedWithoutCustomIdOrType);
    expect(http.request.mock.calls.some(([request]) => request.method === 'PUT')).toBe(false);
  });

  it.each([
    [{ moreResults: true, resultSetSize: 1, transactions: [paymentOrder()] }, 'Ambiguous Bank Frick payment lookup'],
    [transactionsResponse([paymentOrder({ customId: 'OTHER' })]), 'Invalid Bank Frick payment lookup response'],
    [transactionsResponse([paymentOrder(), paymentOrder()]), 'Duplicate Bank Frick payment orders'],
  ])('rejects unsafe payment lookup responses %#', async (response, expectedError) => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await expect(service.getPaymentOrder('DFX-FO-42')).rejects.toThrow(expectedError);
  });

  it('rejects ambiguous or non-matching single-payment responses', () => {
    expect(() =>
      service['getSinglePayment']({ moreResults: true, resultSetSize: 1, transactions: [paymentOrder()] }, 'DFX-FO-42'),
    ).toThrow('Ambiguous Bank Frick payment response');
    expect(() => service['getSinglePayment'](transactionsResponse([]), 'DFX-FO-42')).toThrow(
      'Invalid Bank Frick payment response',
    );
  });

  it('validates transaction and account response envelopes and rows', () => {
    expect(() => service['validateTransactionsResponse'](undefined, true)).toThrow(
      'Invalid Bank Frick transactions response',
    );
    expect(() =>
      service['validateTransactionsResponse'](
        transactionsResponse([{ ...paymentOrder(), state: 'UNKNOWN' as never }]),
        true,
      ),
    ).toThrow('Invalid Bank Frick payment order response');
    expect(() =>
      service['validateTransactionsResponse'](transactionsResponse([paymentOrder({ orderId: -1 })]), true),
    ).toThrow('Invalid Bank Frick orderId response');

    expect(() => service['validateAccountsResponse'](undefined)).toThrow('Invalid Bank Frick accounts response');
    expect(() =>
      service['validateAccountsResponse']({
        date: '2026-07-13',
        moreResults: false,
        resultSetSize: 1,
        accounts: [{ account: 42 } as never],
      }),
    ).toThrow('Invalid Bank Frick account response');
  });

  it('parses signed and European-formatted response amounts and rejects unsafe values', () => {
    expect(service['parseResponseAmount']('-12.34')).toBe(12.34);
    expect(service['parseResponseAmount']('-1.234,56')).toBe(1234.56);
    expect(() => service['parseResponseAmount'](undefined)).toThrow('Invalid Bank Frick payment amount response');
    expect(() => service['parseResponseAmount']('12.345')).toThrow('Invalid Bank Frick payment amount response');
    expect(() => service['parseResponseAmount']('9'.repeat(400))).toThrow('Invalid Bank Frick payment amount response');
  });

  it('rejects incomplete account pagination and filters accounts without an IBAN', async () => {
    const response = accountsResponse();
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce({
      ...response,
      resultSetSize: 2,
      accounts: [...response.accounts, { ...response.accounts[0], iban: undefined }],
    });
    await expect(service.getBalances()).resolves.toHaveLength(1);

    http = { request: jest.fn() };
    service = new BankFrickService(http as unknown as HttpService);
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce({ ...accountsResponse(), moreResults: true });
    await expect(service.getBalances()).rejects.toThrow('Incomplete Bank Frick accounts response');
  });

  it('rejects invalid transaction dates and unsafe CAMT responses', async () => {
    await expect(service.getFrickTransactions(new Date('invalid'), debtorIban)).rejects.toThrow(
      'Invalid Bank Frick transaction start date',
    );

    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce({ not: 'xml' });
    await expect(service.getFrickTransactions(new Date('2026-07-01'), debtorIban)).rejects.toThrow(
      'Invalid Bank Frick camt.053 response',
    );

    http = { request: jest.fn() };
    service = new BankFrickService(http as unknown as HttpService);
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce('   ');
    await expect(service.getFrickTransactions(new Date('2026-07-01'), debtorIban)).resolves.toEqual({
      transactions: [],
      fullyParsed: true,
    });
  });

  it('maps debit CAMT entries as debit transactions', async () => {
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce(camt053Fixture().replace('<CdtDbtInd>CRDT</CdtDbtInd>', '<CdtDbtInd>DBIT</CdtDbtInd>'));

    const { transactions, fullyParsed } = await service.getFrickTransactions(new Date('2026-07-01'), debtorIban);

    expect(transactions[0].creditDebitIndicator).toBe(BankTxIndicator.DEBIT);
    expect(fullyParsed).toBe(true);
  });

  it('parses a booked debit with Amt=1005.00 and Chrgs=5.00 into a real chargeAmount instead of hard-coding 0', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(camt053ChargedDebitFixture());

    const { transactions } = await service.getFrickTransactions(new Date('2026-07-01'), debtorIban);

    expect(transactions[0]).toMatchObject({ amount: 1005, chargeAmount: 5, chargeCurrency: 'CHF' });
  });

  it('accepts JWTs without exp and caches them indefinitely', async () => {
    http.request
      .mockResolvedValueOnce({ token: jwtWithPayload({}) })
      .mockResolvedValueOnce(accountsResponse())
      .mockResolvedValueOnce(accountsResponse());

    await service.getBalances();
    await service.getBalances();

    expect(http.request.mock.calls.filter(([request]) => request.url.endsWith('/authorize'))).toHaveLength(1);
  });

  it.each([
    ['missing payload', 'not-a-jwt'],
    ['missing signature', `${jwtWithPayload({}).split('.').slice(0, 2).join('.')}.`],
    ['invalid expiry', jwtWithPayload({ exp: 0 })],
    ['unsafe millisecond expiry', jwtWithPayload({ exp: Number.MAX_SAFE_INTEGER })],
    ['malformed payload', `header.${Buffer.from('{').toString('base64url')}.signature`],
  ])('rejects a JWT with %s', async (_case, token) => {
    http.request.mockResolvedValueOnce({ token });

    await expect(service.getBalances()).rejects.toThrow('Invalid Bank Frick JWT');
  });

  it('rejects an invalid authorization response and signing configuration', async () => {
    http.request.mockResolvedValueOnce({ token: '' });
    await expect(service.getBalances()).rejects.toThrow('Invalid Bank Frick authorization response');

    Config.bank.frick.privateKey = 'not-a-private-key';
    expect(() => service['sign']('synthetic body')).toThrow('Invalid Bank Frick signing configuration');
  });

  it('reports bounded transport codes without exposing upstream messages', () => {
    expect(service['getHttpFailureReason']({ code: 'ECONNRESET', message: 'secret response body' })).toBe('ECONNRESET');
    expect(service['getHttpFailureReason']({ response: { status: 99 }, code: 'unsafe-code' })).toBe('request failed');
  });

  it('rejects an unsafe customer path segment', () => {
    Config.bank.frick.customer = '../customer';

    expect(() => service['validateCustomer']()).toThrow('Invalid Bank Frick customer configuration');
  });

  it('rejects a customer number exceeding the documented 7-digit limit', () => {
    Config.bank.frick.customer = '12345678';

    expect(() => service['validateCustomer']()).toThrow('Invalid Bank Frick customer configuration');
  });

  it('maps a signed camt.053 response completely into BankTx fields', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(camt053Fixture());

    const { transactions, fullyParsed } = await service.getFrickTransactions(
      new Date('2026-07-01T00:00:00Z'),
      debtorIban,
    );
    const [transaction] = transactions;

    expect(fullyParsed).toBe(true);
    expect(transaction).toMatchObject({
      accountServiceRef: expect.stringMatching(/^FRICK-[a-f0-9]{64}$/),
      txId: 'SYNTHETIC-REF-1',
      txCount: 1,
      amount: 12.34,
      instructedAmount: 12.34,
      txAmount: 12.34,
      chargeAmount: 0,
      currency: 'EUR',
      instructedCurrency: 'EUR',
      txCurrency: 'EUR',
      chargeCurrency: 'EUR',
      creditDebitIndicator: BankTxIndicator.CREDIT,
      iban: creditorIban,
      bic: 'TESTDEFF',
      name: 'Synthetic Sender',
      remittanceInfo: 'Synthetic transfer',
      endToEndId: 'SYNTHETIC-E2E-1',
      accountIban: debtorIban,
      type: null,
    });
    expect(transaction.bookingDate).toEqual(new Date('2026-07-02'));

    const camtRequest = http.request.mock.calls[1][0];
    expect(camtRequest.url).toContain('/camt053?');
    expect(camtRequest.headers.Accept).toBe('application/xml');
    expect(camtRequest.data).toBe('');
    expectSignature('', camtRequest.headers.Signature);
  });

  it('reports fullyParsed=false and drops only the malformed entry when a statement mixes a well-formed and a reference-less debit', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(camt053MixedFixture());

    const { transactions, fullyParsed } = await service.getFrickTransactions(new Date('2026-07-01'), debtorIban);

    expect(fullyParsed).toBe(false);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ txId: 'GOOD-ENTRY-REF', amount: 5 });
  });

  it('formats statement boundaries in Bank Frick local time', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce('');

    await service.getFrickTransactions(new Date('2026-07-01T22:30:00.000Z'), debtorIban);

    const statementUrl = new URL(http.request.mock.calls[1][0].url);
    expect(statementUrl.searchParams.get('fromDate')).toBe('2026-07-02');
  });

  it('reports isVibanAvailable only when base config and vbanBaseUrl are both present', () => {
    expect(service.isVibanAvailable()).toBe(true);

    Config.bank.frick.vbanBaseUrl = undefined;
    expect(service.isVibanAvailable()).toBe(false);

    Config.bank.frick.vbanBaseUrl = 'https://vban.bank.invalid/vban/';
    Config.bank.frick.apiKey = '';
    expect(service.isVibanAvailable()).toBe(false);
  });

  it('creates a virtual IBAN with a signed POST to the VBAN base URL', async () => {
    const response = virtualIbanResponse();
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await expect(service.createViban(` ${debtorIban.toLowerCase()} `)).resolves.toEqual(response);

    const createRequest = http.request.mock.calls[1][0];
    expect(createRequest.url).toBe('https://vban.bank.invalid/vban/virtual-ibans');
    expect(createRequest.method).toBe('POST');
    expect(createRequest.data).toBe(JSON.stringify({ referenceAccountIban: debtorIban }));
    expectSignature(createRequest.data, createRequest.headers.Signature);
    expect(createRequest.headers.Authorization).toMatch(/^Bearer /);
    expect(createRequest.headers.algorithm).toBe('rsa-sha512');
  });

  it('preflights vIBAN validation, signing, and authorization without sending a create request', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() });

    await expect(
      service.prepareVibanCreate(` ${debtorIban.toLowerCase()} `, 'dfx-viban-technical-reference'),
    ).resolves.toBeUndefined();

    expect(http.request).toHaveBeenCalledTimes(1);
    expect(http.request.mock.calls[0][0].url).toBe('https://bank.invalid/webapi/v2/authorize');
  });

  it('includes the technical issuance reference as description in the signed create request', async () => {
    const response = virtualIbanResponse();
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await service.createViban(debtorIban, 'dfx-viban-technical-reference');

    const createRequest = http.request.mock.calls[1][0];
    expect(JSON.parse(createRequest.data)).toEqual({
      referenceAccountIban: debtorIban,
      description: 'dfx-viban-technical-reference',
    });
    expectSignature(createRequest.data, createRequest.headers.Signature);
  });

  it('classifies a concrete client rejection as definitely not created', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockRejectedValueOnce({ response: { status: 422 } });

    await expect(service.createViban(debtorIban)).rejects.toBeInstanceOf(FrickVibanNotCreatedError);
  });

  it.each([{ code: 'ECONNREFUSED', request: {} }, { isAxiosError: true }])(
    'classifies a provably pre-send transport failure as definitely not created',
    async (error) => {
      http.request.mockResolvedValueOnce({ token: jwt() }).mockRejectedValueOnce(error);

      await expect(service.createViban(debtorIban)).rejects.toBeInstanceOf(FrickVibanNotCreatedError);
    },
  );

  it('keeps a timeout response ambiguous because the create may have reached Bank Frick', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockRejectedValueOnce({
      request: {},
      response: { status: 408 },
    });

    await expect(service.createViban(debtorIban)).rejects.not.toBeInstanceOf(FrickVibanNotCreatedError);
  });

  it('canonicalizes a non-canonical response vban on create and approve', async () => {
    const nonCanonical = `${debtorIban.slice(0, 6).toLowerCase()} ${debtorIban.slice(6).toLowerCase()}`;
    const createResponse = { ...virtualIbanResponse(), vban: nonCanonical };
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(createResponse);

    const created = await service.createViban(debtorIban);
    expect(created.vban).toBe(debtorIban);
    expect(created.vban).not.toBe(nonCanonical);

    const approveResponse = {
      ...virtualIbanResponse({ state: FrickVirtualIbanState.ACTIVE }),
      vban: nonCanonical,
    };
    http.request.mockResolvedValueOnce(approveResponse);

    const approved = await service.approveVibanActivation(debtorIban);
    expect(approved.vban).toBe(debtorIban);
    expect(approved.vban).not.toBe(nonCanonical);
  });

  it('rejects an invalid reference IBAN before any HTTP call when creating a virtual IBAN', async () => {
    await expect(service.createViban('not-an-iban')).rejects.toThrow('Invalid Bank Frick reference account IBAN');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('throws when virtual IBAN is not configured and never calls http.request', async () => {
    Config.bank.frick.vbanBaseUrl = undefined;

    await expect(service.createViban(debtorIban)).rejects.toThrow('Bank Frick virtual IBAN is not configured');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('rejects malformed virtual IBAN responses', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce({ ...virtualIbanResponse(), vban: '' });
    await expect(service.createViban(debtorIban)).rejects.toThrow('Invalid Bank Frick virtual IBAN response');

    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce({ ...virtualIbanResponse(), state: 'UNKNOWN' });
    await expect(service.createViban(debtorIban)).rejects.toThrow('Invalid Bank Frick virtual IBAN response');

    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce({ ...virtualIbanResponse(), activationApprovals: null });
    await expect(service.createViban(debtorIban)).rejects.toThrow('Invalid Bank Frick virtual IBAN response');

    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce({ ...virtualIbanResponse(), deactivationApprovals: 'nope' });
    await expect(service.createViban(debtorIban)).rejects.toThrow('Invalid Bank Frick virtual IBAN response');
  });

  it('rejects virtual IBAN responses with a too-long or non-IBAN vban via create and approve', async () => {
    const tooLongVban = 'LI' + '0'.repeat(39);
    const notIbanVban = 'NOTANIBAN000000000000000000000000';

    // First call authorizes; subsequent calls reuse the cached JWT (one http.request each).
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce({ ...virtualIbanResponse(), vban: tooLongVban });
    await expect(service.createViban(debtorIban)).rejects.toThrow(/^Invalid Bank Frick virtual IBAN$/);
    expect(http.request).toHaveBeenCalledTimes(2);

    http.request.mockResolvedValueOnce({ ...virtualIbanResponse(), vban: notIbanVban });
    await expect(service.createViban(debtorIban)).rejects.toThrow(/^Invalid Bank Frick virtual IBAN$/);
    expect(http.request).toHaveBeenCalledTimes(3);

    http.request.mockResolvedValueOnce({ ...virtualIbanResponse(), vban: tooLongVban });
    await expect(service.approveVibanActivation(debtorIban)).rejects.toThrow(/^Invalid Bank Frick virtual IBAN$/);
    expect(http.request).toHaveBeenCalledTimes(4);

    http.request.mockResolvedValueOnce({ ...virtualIbanResponse(), vban: notIbanVban });
    await expect(service.approveVibanActivation(debtorIban)).rejects.toThrow(/^Invalid Bank Frick virtual IBAN$/);
    expect(http.request).toHaveBeenCalledTimes(5);
  });

  it('rejects virtual IBAN responses with missing or wrong-typed createdAt/createdBy', async () => {
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce({ ...virtualIbanResponse(), createdAt: undefined });
    await expect(service.createViban(debtorIban)).rejects.toThrow('Invalid Bank Frick virtual IBAN response');

    http.request.mockResolvedValueOnce({ ...virtualIbanResponse(), createdAt: 123 });
    await expect(service.createViban(debtorIban)).rejects.toThrow('Invalid Bank Frick virtual IBAN response');

    http.request.mockResolvedValueOnce({ ...virtualIbanResponse(), createdBy: undefined });
    await expect(service.createViban(debtorIban)).rejects.toThrow('Invalid Bank Frick virtual IBAN response');

    http.request.mockResolvedValueOnce({ ...virtualIbanResponse(), createdBy: 456 });
    await expect(service.createViban(debtorIban)).rejects.toThrow('Invalid Bank Frick virtual IBAN response');
  });

  it('approves a virtual IBAN activation with a signed PUT', async () => {
    const response = virtualIbanResponse({ state: FrickVirtualIbanState.ACTIVE });
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await expect(service.approveVibanActivation(response.vban)).resolves.toEqual(response);

    const approveRequest = http.request.mock.calls[1][0];
    expect(approveRequest.url).toBe('https://vban.bank.invalid/vban/virtual-ibans/activations/approvals');
    expect(approveRequest.method).toBe('PUT');
    expect(approveRequest.data).toBe(JSON.stringify({ vban: response.vban }));
    expectSignature(approveRequest.data, approveRequest.headers.Signature);
    expect(approveRequest.headers.Authorization).toMatch(/^Bearer /);
    expect(approveRequest.headers.algorithm).toBe('rsa-sha512');
  });

  it('rejects an empty vban before any HTTP call when approving activation', async () => {
    await expect(service.approveVibanActivation('')).rejects.toThrow('Invalid Bank Frick vban');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('gets a virtual IBAN with encodeURIComponent applied to the path segment', async () => {
    // Path segment may contain reserved characters; response vban must still be a valid IBAN.
    const vbanWithSlash = 'LI/TEST VBAN';
    const response = virtualIbanResponse({ state: FrickVirtualIbanState.ACTIVE });
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await expect(service.getViban(vbanWithSlash)).resolves.toEqual(response);

    const getRequest = http.request.mock.calls[1][0];
    expect(getRequest.url).toBe(`https://vban.bank.invalid/vban/virtual-ibans/${encodeURIComponent(vbanWithSlash)}`);
    expect(getRequest.method).toBe('GET');
    expect(getRequest.data).toBe('');
    expectSignature('', getRequest.headers.Signature);
  });

  it('lists virtual IBANs with and without query filters and validates the envelope', async () => {
    const item = virtualIbanResponse({ state: FrickVirtualIbanState.ACTIVE });
    const listResponse = {
      pagination: { hasMore: false, pageIndex: 0, pageSize: 50, totalCount: 1 },
      virtualIbans: [item],
    };
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(listResponse);

    await expect(service.listVibans()).resolves.toEqual(listResponse);
    expect(http.request.mock.calls[1][0].url).toBe(
      'https://vban.bank.invalid/vban/virtual-ibans?pageIndex=0&pageSize=50',
    );

    http.request.mockResolvedValueOnce(listResponse);
    await service.listVibans(debtorIban, [FrickVirtualIbanState.ACTIVE, FrickVirtualIbanState.PREPARED]);
    const filteredUrl = new URL(http.request.mock.calls[2][0].url);
    expect(filteredUrl.searchParams.get('account')).toBe(debtorIban);
    expect(filteredUrl.searchParams.getAll('state')).toEqual([
      FrickVirtualIbanState.ACTIVE,
      FrickVirtualIbanState.PREPARED,
    ]);

    http.request.mockResolvedValueOnce({
      pagination: { hasMore: false, pageIndex: 0, pageSize: 50, totalCount: 0 },
    });
    await expect(service.listVibans()).rejects.toThrow('Invalid Bank Frick virtual IBANs response');

    http.request.mockResolvedValueOnce({
      pagination: { hasMore: false, pageIndex: 0, pageSize: 50, totalCount: 1 },
      virtualIbans: [{ ...item, vban: '' }],
    });
    await expect(service.listVibans()).rejects.toThrow('Invalid Bank Frick virtual IBAN response');
  });

  it('traverses every virtual-IBAN page and rejects pagination that does not advance', async () => {
    const first = virtualIbanResponse({ state: FrickVirtualIbanState.PREPARED });
    const second = virtualIbanResponse({
      state: FrickVirtualIbanState.ACTIVE,
      vban: createSyntheticIban('LI', '00000VBANACCOUNT2'),
    });
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce({
        pagination: { hasMore: true, pageIndex: 0, pageSize: 1, totalCount: 2 },
        virtualIbans: [first],
      })
      .mockResolvedValueOnce({
        pagination: { hasMore: false, pageIndex: 1, pageSize: 1, totalCount: 2 },
        virtualIbans: [second],
      });

    await expect(
      service.listAllVibans(debtorIban, [FrickVirtualIbanState.PREPARED, FrickVirtualIbanState.ACTIVE], 1),
    ).resolves.toEqual([first, second]);
    expect(new URL(http.request.mock.calls[2][0].url).searchParams.get('pageIndex')).toBe('1');

    http = { request: jest.fn() };
    service = new BankFrickService(http as unknown as HttpService);
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce({
      pagination: { hasMore: true, pageIndex: 1, pageSize: 1, totalCount: 2 },
      virtualIbans: [first],
    });
    await expect(service.listAllVibans(undefined, undefined, 1)).rejects.toThrow('unexpected pageIndex');
  });

  it('rejects invalid virtual-IBAN page sizes and inconsistent pagination envelopes', async () => {
    await expect(service.listVibans(undefined, undefined, -1)).rejects.toThrow(
      'Invalid Bank Frick virtual IBAN pageIndex',
    );
    await expect(service.listVibans(undefined, undefined, 0.5)).rejects.toThrow(
      'Invalid Bank Frick virtual IBAN pageIndex',
    );
    await expect(service.listVibans(undefined, undefined, 0, 0)).rejects.toThrow(
      'Invalid Bank Frick virtual IBAN pageSize',
    );
    await expect(service.listVibans(undefined, undefined, 0, 1.5)).rejects.toThrow(
      'Invalid Bank Frick virtual IBAN pageSize',
    );
    await expect(service.listVibans(undefined, undefined, 0, 201)).rejects.toThrow(
      'Invalid Bank Frick virtual IBAN pageSize',
    );

    const first = virtualIbanResponse({ state: FrickVirtualIbanState.PREPARED });
    const second = virtualIbanResponse({
      state: FrickVirtualIbanState.ACTIVE,
      vban: createSyntheticIban('LI', '00000VBANACCOUNT2'),
    });
    const listSpy = jest.spyOn(service, 'listVibans');

    listSpy.mockResolvedValueOnce({
      pagination: { hasMore: false, pageIndex: 0, pageSize: 50, totalCount: 0 },
      virtualIbans: [],
    });
    await expect(service.listAllVibans()).resolves.toEqual([]);

    listSpy
      .mockResolvedValueOnce({
        pagination: { hasMore: true, pageIndex: 0, pageSize: 1, totalCount: 2 },
        virtualIbans: [first],
      })
      .mockResolvedValueOnce({
        pagination: { hasMore: false, pageIndex: 1, pageSize: 1, totalCount: 3 },
        virtualIbans: [second],
      });
    await expect(service.listAllVibans(undefined, undefined, 1)).rejects.toThrow(
      'changed totalCount during pagination',
    );

    listSpy.mockReset().mockResolvedValueOnce({
      pagination: { hasMore: true, pageIndex: 0, pageSize: 1, totalCount: 1 },
      virtualIbans: [],
    });
    await expect(service.listAllVibans(undefined, undefined, 1)).rejects.toThrow(
      'reported more pages but returned no items',
    );

    listSpy
      .mockReset()
      .mockResolvedValueOnce({
        pagination: { hasMore: true, pageIndex: 0, pageSize: 1, totalCount: 2 },
        virtualIbans: [first],
      })
      .mockResolvedValueOnce({
        pagination: { hasMore: false, pageIndex: 1, pageSize: 1, totalCount: 2 },
        virtualIbans: [first],
      });
    await expect(service.listAllVibans(undefined, undefined, 1)).rejects.toThrow('duplicate item across pages');

    listSpy.mockReset().mockResolvedValueOnce({
      pagination: { hasMore: false, pageIndex: 0, pageSize: 1, totalCount: 2 },
      virtualIbans: [first],
    });
    await expect(service.listAllVibans(undefined, undefined, 1)).rejects.toThrow('returned 1 of 2 items');
  });

  it('fails closed when virtual-IBAN pagination exceeds the safety limit', async () => {
    jest.spyOn(service, 'listVibans').mockImplementation(async (_account, _states, pageIndex = 0) => ({
      pagination: { hasMore: true, pageIndex, pageSize: 1, totalCount: 10_001 },
      virtualIbans: [{ ...virtualIbanResponse(), vban: `synthetic-vban-${pageIndex}` }],
    }));

    await expect(service.listAllVibans(undefined, undefined, 1)).rejects.toThrow('exceeded maximum page count');
  });

  it('validates an optional virtual-IBAN description returned by Bank Frick', async () => {
    const response = { ...virtualIbanResponse(), description: 'dfx-viban-reference' };
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await expect(service.createViban(debtorIban)).resolves.toEqual(response);
  });

  it('refreshes once after a 401 on the VBAN path and retries the original request once', async () => {
    let authorizationCount = 0;
    let createCount = 0;
    const response = virtualIbanResponse();
    http.request.mockImplementation((request) => {
      if (request.url.endsWith('/authorize')) return Promise.resolve({ token: jwt(++authorizationCount) });
      if (request.url.endsWith('/virtual-ibans') && ++createCount === 1)
        return Promise.reject({ response: { status: 401 } });
      return Promise.resolve(response);
    });

    await expect(service.createViban(debtorIban)).resolves.toEqual(response);
    expect(authorizationCount).toBe(2);
    expect(createCount).toBe(2);
  });

  it('throws when virtual IBAN is not configured and never calls http.request (approveVibanActivation)', async () => {
    Config.bank.frick.vbanBaseUrl = undefined;

    await expect(service.approveVibanActivation(debtorIban)).rejects.toThrow(
      'Bank Frick virtual IBAN is not configured',
    );
    expect(http.request).not.toHaveBeenCalled();
  });

  it('throws when virtual IBAN is not configured and never calls http.request (getViban)', async () => {
    Config.bank.frick.vbanBaseUrl = undefined;

    await expect(service.getViban(debtorIban)).rejects.toThrow('Bank Frick virtual IBAN is not configured');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('throws when virtual IBAN is not configured and never calls http.request (listVibans)', async () => {
    Config.bank.frick.vbanBaseUrl = undefined;

    await expect(service.listVibans()).rejects.toThrow('Bank Frick virtual IBAN is not configured');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('applies response-signature verification to VBAN requests too', async () => {
    const response = virtualIbanResponse();
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(response);

    await service.createViban(debtorIban);

    const vbanRequest = http.request.mock.calls[1][0];
    const rawResponse = JSON.stringify(response);
    const signer = createSign('sha512');
    signer.update(rawResponse);
    const validSignature = signer.sign(keys.privateKey, 'base64');

    expect(() =>
      vbanRequest.responseVerifier(rawResponse, { signature: validSignature, algorithm: 'rsa-sha512' }),
    ).not.toThrow();
    expect(() =>
      vbanRequest.responseVerifier(rawResponse, { signature: 'tampered-signature', algorithm: 'rsa-sha512' }),
    ).toThrow();
  });

  it('rejects a malformed reference IBAN filter before any HTTP call, and normalizes a valid one to canonical form', async () => {
    await expect(service.listVibans('not-an-iban')).rejects.toThrow('Invalid Bank Frick reference account IBAN filter');
    expect(http.request).not.toHaveBeenCalled();

    const listResponse = {
      pagination: { hasMore: false, pageIndex: 0, pageSize: 50, totalCount: 0 },
      virtualIbans: [],
    };
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(listResponse);
    await service.listVibans(` ${debtorIban.toLowerCase()} `);

    const url = new URL(http.request.mock.calls[1][0].url);
    expect(url.searchParams.get('account')).toBe(debtorIban);
  });

  function virtualIbanResponse(
    overrides: Partial<{
      vban: string;
      referenceAccountIban: string;
      state: FrickVirtualIbanState;
    }> = {},
  ) {
    return {
      vban: overrides.vban ?? createSyntheticIban('LI', '00000VBANACCOUNT1'),
      referenceAccountIban: overrides.referenceAccountIban ?? debtorIban,
      state: overrides.state ?? FrickVirtualIbanState.PREPARED,
      createdAt: '2026-07-01T00:00:00Z',
      createdBy: 'synthetic',
      activationApprovals: [],
      deactivationApprovals: [],
    };
  }

  function expectSignature(body: string, signature: string): void {
    expect(verify('RSA-SHA512', Buffer.from(body), keys.publicKey, Buffer.from(signature, 'base64'))).toBe(true);
  }

  function paymentInput() {
    return {
      customId: 'DFX-FO-42',
      amount: 10.25,
      currency: 'EUR' as const,
      reference: 'Synthetic payout 42',
      debtorIban,
      creditor: { name: 'Synthetic Recipient', iban: creditorIban },
    };
  }

  function paymentOrder(overrides: Partial<FrickPaymentOrder> = {}): FrickPaymentOrder {
    return {
      orderId: 4242,
      customId: 'DFX-FO-42',
      type: FrickPaymentType.SEPA,
      state: FrickPaymentState.PREPARED,
      amount: 10.25,
      currency: 'EUR',
      express: false,
      reference: 'Synthetic payout 42',
      debitor: { iban: debtorIban },
      creditor: { name: 'Synthetic Recipient', iban: creditorIban },
      ...overrides,
    };
  }

  function transactionsResponse(transactions: FrickPaymentOrder[]): FrickTransactionsResponse {
    return { moreResults: false, resultSetSize: transactions.length, transactions };
  }

  function accountsResponse() {
    return {
      date: '2026-07-13',
      moreResults: false,
      resultSetSize: 1,
      accounts: [
        {
          account: '0000000/000.000.001',
          type: 'CURRENT ACCOUNT',
          iban: debtorIban,
          customer: '0000000 Synthetic Customer',
          currency: 'EUR',
          balance: 100,
          available: 90,
        },
      ],
    };
  }

  function jwt(sequence = 1): string {
    return jwtWithPayload({ exp: Math.floor(Date.now() / 1000) + 3600, sequence });
  }

  function jwtWithPayload(payload: object): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${encodedPayload}.synthetic-signature`;
  }

  function camt053Fixture(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrStmt>
    <Stmt>
      <Acct><Id><IBAN>${debtorIban}</IBAN></Id></Acct>
      <Ntry>
        <Amt Ccy="EUR">12.34</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-07-02</Dt></BookgDt>
        <ValDt><Dt>2026-07-02</Dt></ValDt>
        <AcctSvcrRef>SYNTHETIC-REF-1</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>SYNTHETIC-E2E-1</EndToEndId></Refs>
            <RltdPties>
              <Dbtr><Nm>Synthetic Sender</Nm></Dbtr>
              <DbtrAcct><Id><IBAN>${creditorIban}</IBAN></Id></DbtrAcct>
            </RltdPties>
            <RltdAgts><DbtrAgt><FinInstnId><BIC>TESTDEFF</BIC></FinInstnId></DbtrAgt></RltdAgts>
            <RmtInf><Ustrd>Synthetic transfer</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
  }

  function camt053MixedFixture(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrStmt>
    <Stmt>
      <Acct><Id><IBAN>${debtorIban}</IBAN></Id></Acct>
      <Ntry>
        <Amt Ccy="EUR">5</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-07-02</Dt></BookgDt>
        <ValDt><Dt>2026-07-02</Dt></ValDt>
        <AcctSvcrRef>GOOD-ENTRY-REF</AcctSvcrRef>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">7</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-07-02</Dt></BookgDt>
        <ValDt><Dt>2026-07-02</Dt></ValDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
  }

  function camt053ChargedDebitFixture(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrStmt>
    <Stmt>
      <Acct><Id><IBAN>${debtorIban}</IBAN></Id></Acct>
      <Ntry>
        <Amt Ccy="CHF">1005</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-07-02</Dt></BookgDt>
        <ValDt><Dt>2026-07-02</Dt></ValDt>
        <AcctSvcrRef>CHARGED-DEBIT-REF</AcctSvcrRef>
        <Chrgs><TtlChrgsAndTaxAmt Ccy="CHF">5</TtlChrgsAndTaxAmt></Chrgs>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
  }
});

function createSyntheticIban(country: string, bban: string): string {
  const rearranged = `${bban}${country}00`;
  const numeric = rearranged
    .split('')
    .map((char) => (/[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char))
    .join('');
  const checkDigits = String(98n - (BigInt(numeric) % 97n)).padStart(2, '0');
  const iban = `${country}${checkDigits}${bban}`;
  if (!IbanTools.validateIBAN(iban).valid) throw new Error('Synthetic IBAN fixture is invalid');
  return iban;
}
