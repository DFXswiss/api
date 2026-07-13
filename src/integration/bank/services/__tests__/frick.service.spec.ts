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

  it('fails closed when a payment is attempted without the explicit payout flag', async () => {
    await expect(service.createPaymentOrder(paymentInput())).rejects.toThrow('payout is not explicitly enabled');
    await expect(service.approvePaymentWithoutTan('DFX-FO-42')).rejects.toThrow('payout is not explicitly enabled');
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

  it('rejects CHF payments without both BIC and charge before creating an order', async () => {
    Config.bank.frick.payoutEnabled = true;
    const input = { ...paymentInput(), currency: 'CHF' as const };

    await expect(service.createPaymentOrder(input)).rejects.toThrow('requires creditor BIC');
    expect(http.request).not.toHaveBeenCalled();

    const inputWithBic = { ...input, creditor: { ...input.creditor, bic: 'TESTLI22' } };
    await expect(service.createPaymentOrder(inputWithBic)).rejects.toThrow('requires a valid charge');
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
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sequence })).toString(
      'base64url',
    );
    return `${header}.${payload}.synthetic-signature`;
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
