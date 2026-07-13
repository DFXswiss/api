import { generateKeyPairSync, verify } from 'crypto';
import * as IbanTools from 'ibantools';
import { Config, ConfigService } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import {
  FrickPaymentCharge,
  FrickPaymentOrder,
  FrickPaymentState,
  FrickPaymentType,
  FrickTransactionsResponse,
} from '../../dto/frick.dto';
import { BankFrickService } from '../frick.service';

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
      customer: '0000000',
      payoutEnabled: false,
      approveWithoutTan: false,
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

  it('fails loud when connection configuration is incomplete', async () => {
    Config.bank.frick.privateKey = undefined;

    expect(service.isAvailable()).toBe(false);
    await expect(service.getBalances()).rejects.toThrow('Bank Frick is not configured');
    expect(http.request).not.toHaveBeenCalled();
  });

  it.each(['baseUrl', 'apiKey', 'privateKey', 'customer'] as const)(
    'reports the integration unavailable when %s is missing',
    (field) => {
      Config.bank.frick[field] = undefined;

      expect(service.isAvailable()).toBe(false);
    },
  );

  it('fails closed when a payment is attempted without the explicit payout flag', async () => {
    await expect(service.createPaymentOrder(paymentInput())).rejects.toThrow('payout is not explicitly enabled');
    await expect(service.approvePaymentWithoutTan('DFX-FO-42')).rejects.toThrow('payout is not explicitly enabled');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('fails closed when approval without TAN is not explicitly enabled', async () => {
    Config.bank.frick.payoutEnabled = true;

    await expect(service.approvePaymentWithoutTan('DFX-FO-42')).rejects.toThrow(
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
        bic: ' test de ff ',
        address: ' Synthetic Street 42 ',
        postalcode: ' 8000 ',
        city: ' Zurich ',
        country: ' CH ',
        creditInstitution: ' Synthetic Bank ',
      },
    });

    expect(() => service['assertSamePayment'](existing, requested)).not.toThrow();
  });

  it('matches an idempotent order when both references are omitted', () => {
    const requested = service['createTransaction']({ ...paymentInput(), reference: undefined });
    const existing = paymentOrder({ reference: undefined });

    expect(() => service['assertSamePayment'](existing, requested)).not.toThrow();
  });

  it('approves by stable customId and never converts an order id', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = true;
    const order = paymentOrder({ orderId: Number.MAX_SAFE_INTEGER + 1 });
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(transactionsResponse([order]));

    await service.approvePaymentWithoutTan('DFX-FO-42');

    const approval = http.request.mock.calls[1][0];
    expect(JSON.parse(approval.data)).toEqual({ customIds: ['DFX-FO-42'] });
    expect(service.getSafeOrderId(order)).toBeUndefined();
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
    await expect(service.getPaymentOrder('DFX-FO-42')).rejects.toThrow('payment order DFX-FO-42 not found');
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
    expect(() => service['validateTransactionsResponse'](undefined)).toThrow(
      'Invalid Bank Frick transactions response',
    );
    expect(() =>
      service['validateTransactionsResponse'](transactionsResponse([{ ...paymentOrder(), state: 'UNKNOWN' as never }])),
    ).toThrow('Invalid Bank Frick payment order response');
    expect(() =>
      service['validateTransactionsResponse'](transactionsResponse([paymentOrder({ orderId: -1 })])),
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
    await expect(service.getFrickTransactions(new Date('2026-07-01'), debtorIban)).resolves.toEqual([]);
  });

  it('maps debit CAMT entries as debit transactions', async () => {
    http.request
      .mockResolvedValueOnce({ token: jwt() })
      .mockResolvedValueOnce(camt053Fixture().replace('<CdtDbtInd>CRDT</CdtDbtInd>', '<CdtDbtInd>DBIT</CdtDbtInd>'));

    const [transaction] = await service.getFrickTransactions(new Date('2026-07-01'), debtorIban);

    expect(transaction.creditDebitIndicator).toBe(BankTxIndicator.DEBIT);
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

  it('maps a signed camt.053 response completely into BankTx fields', async () => {
    http.request.mockResolvedValueOnce({ token: jwt() }).mockResolvedValueOnce(camt053Fixture());

    const [transaction] = await service.getFrickTransactions(new Date('2026-07-01T00:00:00Z'), debtorIban);

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
      <Ntry>
        <Amt Ccy="EUR">12.34</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
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
