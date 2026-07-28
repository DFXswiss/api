import { HttpService as NestHttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
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
    nestHttp.request.mockReturnValue(of({ data: Buffer.from(rawBody), headers }));
    const responseVerifier = jest.fn();

    await expect(
      service.request<{ answer: number }>({
        url: 'https://synthetic.example/signed',
        responseType: 'json',
        responseVerifier,
      }),
    ).resolves.toEqual({ answer: 42 });

    expect(responseVerifier).toHaveBeenCalledWith(Buffer.from(rawBody), headers);
    const transportConfig = nestHttp.request.mock.calls[0][0];
    expect(transportConfig.responseType).toBe('arraybuffer');
    expect(transportConfig.transformResponse[0](rawBody)).toBe(rawBody);
    expect(transportConfig).not.toHaveProperty('responseVerifier');
  });

  it('verifies a response containing a UTF-8 BOM and non-UTF-8 bytes against a signature computed over the exact raw bytes', async () => {
    // A legitimately signed response that includes a UTF-8 BOM and a byte sequence that is not valid
    // UTF-8 (0xFF) must still verify - decoding to a string (even correctly) before verification would
    // strip the BOM and mangle the invalid sequence, breaking a signature computed over the raw bytes.
    const rawBytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('{"answer":42}'),
      Buffer.from([0xff]),
    ]);
    const headers = { signature: 'synthetic-signature', algorithm: 'rsa-sha512' };
    nestHttp.request.mockReturnValue(of({ data: rawBytes, headers }));
    const responseVerifier = jest.fn();

    await service.request({ url: 'https://synthetic.example/signed', responseType: 'text', responseVerifier });

    expect(responseVerifier).toHaveBeenCalledWith(rawBytes, headers);
    expect(Buffer.isBuffer(responseVerifier.mock.calls[0][0])).toBe(true);
  });

  it('returns verified text without JSON parsing', async () => {
    nestHttp.request.mockReturnValue(of({ data: Buffer.from('<Document/>'), headers: {} }));

    await expect(
      service.request<string>({
        url: 'https://synthetic.example/signed.xml',
        responseType: 'text',
        responseVerifier: jest.fn(),
      }),
    ).resolves.toBe('<Document/>');
  });

  it('propagates verification failure before exposing the response body', async () => {
    nestHttp.request.mockReturnValue(of({ data: Buffer.from('{"unsafe":true}'), headers: {} }));

    await expect(
      service.request({
        url: 'https://synthetic.example/signed',
        responseVerifier: () => {
          throw new Error('synthetic signature mismatch');
        },
      }),
    ).rejects.toThrow('synthetic signature mismatch');
  });

  it('rejects a signed response that was not preserved as a raw byte buffer', async () => {
    nestHttp.request.mockReturnValue(of({ data: { already: 'parsed' }, headers: {} }));

    await expect(
      service.request({
        url: 'https://synthetic.example/signed',
        responseVerifier: jest.fn(),
      }),
    ).rejects.toThrow('Signed HTTP response body is not a raw byte buffer');
  });

  it('preserves the existing parsed-response path when no verifier is configured', async () => {
    const parsed = { answer: 42 };
    nestHttp.request.mockReturnValue(of({ data: parsed, headers: {} }));

    await expect(service.request({ url: 'https://synthetic.example/unsigned' })).resolves.toBe(parsed);
    expect(nestHttp.request.mock.calls[0][0].transformResponse).toBeUndefined();
  });

  it('verifies a signed error response body and re-throws the original axios error when the signature is valid', async () => {
    const errorBody = Buffer.from('{"error":"unauthorized"}');
    const headers = { signature: 'synthetic-signature', algorithm: 'rsa-sha512' };
    const originalError = Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401, data: errorBody, headers },
      isAxiosError: true,
    });
    nestHttp.request.mockReturnValue(throwError(() => originalError));
    const responseVerifier = jest.fn();

    await expect(service.request({ url: 'https://synthetic.example/signed', responseVerifier })).rejects.toBe(
      originalError,
    );

    expect(responseVerifier).toHaveBeenCalledWith(errorBody, headers);
    expect(originalError.response.status).toBe(401);
  });

  it('propagates the verifier error instead of the original axios error when the error-response signature is invalid', async () => {
    const errorBody = Buffer.from('{"error":"unauthorized"}');
    const headers = { signature: 'bad', algorithm: 'rsa-sha512' };
    const originalError = Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401, data: errorBody, headers },
      isAxiosError: true,
    });
    const verifierError = new Error('synthetic signature mismatch on error body');
    nestHttp.request.mockReturnValue(throwError(() => originalError));

    const rejected = service.request({
      url: 'https://synthetic.example/signed',
      responseVerifier: () => {
        throw verifierError;
      },
    });
    await expect(rejected).rejects.toBe(verifierError);
    await expect(rejected).rejects.not.toBe(originalError);
  });

  it('does not call responseVerifier on pure transport failures without an HTTP response', async () => {
    const transportError = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
      isAxiosError: true,
    });
    nestHttp.request.mockReturnValue(throwError(() => transportError));
    const responseVerifier = jest.fn();

    await expect(service.request({ url: 'https://synthetic.example/signed', responseVerifier })).rejects.toBe(
      transportError,
    );

    expect(responseVerifier).not.toHaveBeenCalled();
  });

  it('rejects a signed error response whose body is not a raw byte buffer without treating it as verified', async () => {
    const originalError = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { already: 'parsed' }, headers: {} },
      isAxiosError: true,
    });
    nestHttp.request.mockReturnValue(throwError(() => originalError));
    const responseVerifier = jest.fn();

    const rejected = service.request({ url: 'https://synthetic.example/signed', responseVerifier });
    await expect(rejected).rejects.toThrow('Signed HTTP error response body is not a raw byte buffer');
    await expect(rejected).rejects.not.toBe(originalError);
    expect(responseVerifier).not.toHaveBeenCalled();
  });

  it('rejects with the exact original axios error when no responseVerifier is configured', async () => {
    const originalError = Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: 'plain error body', headers: {} },
      isAxiosError: true,
    });
    nestHttp.request.mockReturnValue(throwError(() => originalError));

    await expect(service.request({ url: 'https://synthetic.example/unsigned' })).rejects.toBe(originalError);
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

  it('does not leak mock Frick order state across separately-constructed HttpService instances', async () => {
    process.env.ENVIRONMENT = Environment.LOC;
    const baseUrl = 'https://olbtest.bankfrick.li/webapi/v2';
    const firstInstance = new HttpService({ request: jest.fn() } as unknown as NestHttpService);
    const secondInstance = new HttpService({ request: jest.fn() } as unknown as NestHttpService);

    await firstInstance.request({
      url: `${baseUrl}/transactions`,
      method: 'PUT',
      data: JSON.stringify({
        transactions: [
          {
            customId: 'DFX-FO-ISOLATED-1',
            type: 'SEPA',
            amount: 1,
            currency: 'EUR',
            debitor: { iban: 'LI00SYNTHETIC' },
            creditor: { iban: 'DE00SYNTHETIC', name: 'Local Recipient' },
          },
        ],
      }),
    });

    await expect(
      secondInstance.request<{ resultSetSize: number }>({
        url: `${baseUrl}/transactions?customId=DFX-FO-ISOLATED-1`,
      }),
    ).resolves.toEqual(expect.objectContaining({ resultSetSize: 0 }));
  });
});
