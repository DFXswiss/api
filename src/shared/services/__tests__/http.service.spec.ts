import { HttpService as NestHttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { Environment } from 'src/config/config';
import { HttpService } from '../http.service';

describe('HttpService signed responses', () => {
  const previousEnvironment = process.env.ENVIRONMENT;
  let nestHttp: { request: jest.Mock };
  let service: HttpService;

  beforeEach(() => {
    process.env.ENVIRONMENT = Environment.DEV;
    nestHttp = { request: jest.fn() };
    service = new HttpService(nestHttp as unknown as NestHttpService);
  });

  afterAll(() => {
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
  });

  it('verifies exact raw JSON bytes before parsing them', async () => {
    const rawBody = '{ "answer": 42 }';
    const headers = { signature: 'synthetic-signature', algorithm: 'rsa-sha512' };
    nestHttp.request.mockReturnValue(of({ data: rawBody, headers }));
    const responseVerifier = jest.fn();

    await expect(
      service.request<{ answer: number }>({
        url: 'https://synthetic.example/signed',
        responseType: 'json',
        responseVerifier,
      }),
    ).resolves.toEqual({ answer: 42 });

    expect(responseVerifier).toHaveBeenCalledWith(rawBody, headers);
    const transportConfig = nestHttp.request.mock.calls[0][0];
    expect(transportConfig.responseType).toBe('text');
    expect(transportConfig.transformResponse[0](rawBody)).toBe(rawBody);
    expect(transportConfig).not.toHaveProperty('responseVerifier');
  });

  it('returns verified text without JSON parsing', async () => {
    nestHttp.request.mockReturnValue(of({ data: '<Document/>', headers: {} }));

    await expect(
      service.request<string>({
        url: 'https://synthetic.example/signed.xml',
        responseType: 'text',
        responseVerifier: jest.fn(),
      }),
    ).resolves.toBe('<Document/>');
  });

  it('propagates verification failure before exposing the response body', async () => {
    nestHttp.request.mockReturnValue(of({ data: '{"unsafe":true}', headers: {} }));

    await expect(
      service.request({
        url: 'https://synthetic.example/signed',
        responseVerifier: () => {
          throw new Error('synthetic signature mismatch');
        },
      }),
    ).rejects.toThrow('synthetic signature mismatch');
  });

  it('rejects a signed response that was not preserved as raw text', async () => {
    nestHttp.request.mockReturnValue(of({ data: { already: 'parsed' }, headers: {} }));

    await expect(
      service.request({
        url: 'https://synthetic.example/signed',
        responseVerifier: jest.fn(),
      }),
    ).rejects.toThrow('Signed HTTP response body is not raw text');
  });

  it('preserves the existing parsed-response path when no verifier is configured', async () => {
    const parsed = { answer: 42 };
    nestHttp.request.mockReturnValue(of({ data: parsed, headers: {} }));

    await expect(service.request({ url: 'https://synthetic.example/unsigned' })).resolves.toBe(parsed);
    expect(nestHttp.request.mock.calls[0][0].transformResponse).toBeUndefined();
  });
});

describe('HttpService local Bank Frick mocks', () => {
  const previousEnvironment = process.env.ENVIRONMENT;

  afterAll(() => {
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
  });

  it('supports authorize, accounts, CAMT, create, lookup and approval as one coherent local flow', async () => {
    process.env.ENVIRONMENT = Environment.LOC;
    const nestHttp = { request: jest.fn() };
    const service = new HttpService(nestHttp as unknown as NestHttpService);
    const baseUrl = 'https://olbtest.bankfrick.li/webapi/v2';

    const authorization = await service.request<{ token: string }>({ url: `${baseUrl}/authorize`, method: 'POST' });
    expect(authorization.token.split('.')).toHaveLength(3);
    await expect(service.request({ url: `${baseUrl}/accounts/0000000` })).resolves.toEqual(
      expect.objectContaining({ resultSetSize: 0, accounts: [] }),
    );
    await expect(service.request({ url: `${baseUrl}/camt053?iban=LI00SYNTHETIC` })).resolves.toContain(
      '<IBAN>LI00SYNTHETIC</IBAN>',
    );

    const createResponse = await service.request<any>({
      url: `${baseUrl}/transactions`,
      method: 'PUT',
      data: JSON.stringify({
        transactions: [
          {
            customId: 'DFX-FO-LOCAL-1',
            type: 'SEPA',
            amount: 1,
            currency: 'EUR',
            debitor: { iban: 'LI00SYNTHETIC' },
            creditor: { iban: 'DE00SYNTHETIC', name: 'Local Recipient' },
          },
        ],
      }),
    });
    expect(createResponse.transactions[0]).toEqual(
      expect.objectContaining({ customId: 'DFX-FO-LOCAL-1', state: 'PREPARED', orderId: expect.any(Number) }),
    );

    await expect(service.request<any>({ url: `${baseUrl}/transactions?customId=DFX-FO-LOCAL-1` })).resolves.toEqual(
      expect.objectContaining({ resultSetSize: 1 }),
    );
    await expect(
      service.request<any>({
        url: `${baseUrl}/signTransactionWithoutTan`,
        method: 'POST',
        data: JSON.stringify({ orderIds: [createResponse.transactions[0].orderId] }),
      }),
    ).resolves.toEqual(expect.objectContaining({ transactions: [expect.objectContaining({ state: 'IN_PROGRESS' })] }));
    expect(nestHttp.request).not.toHaveBeenCalled();
  });
});
