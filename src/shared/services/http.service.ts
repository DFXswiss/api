import { HttpService as Http } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { createWriteStream } from 'fs';
import { firstValueFrom } from 'rxjs';
import { Environment, GetConfig } from 'src/config/config';
import { Util } from '../utils/util';
import { DfxLogger } from './dfx-logger';
import { FrickMockGateway } from './frick-mock-gateway';

export interface HttpError {
  response?: {
    status?: number;
    data?: any;
  };
}

export type HttpRequestConfig = AxiosRequestConfig & {
  tryCount?: number;
  retryDelay?: number;
  // Raw response bytes, exactly as received - never decoded/transcoded before the caller verifies
  // them, so a legitimately signed response can never fail verification due to axios' own text decoding.
  // `status` is the HTTP status the bytes arrived with. It is passed on both the success and the
  // error path so a verifier that rejects a response can say which one it rejected: an unsigned 2xx
  // and an unsigned 5xx are indistinguishable in the body alone, but mean very different things.
  responseVerifier?: (rawBody: Buffer, headers: AxiosResponse['headers'], status?: number) => void;
};

type MockResponseFactory = (url: string, config?: HttpRequestConfig) => unknown;

// Mock responses for local development. Bank Frick's own mock is stateful and endpoint-aware -
// handled by the dedicated FrickMockGateway (its own file, its own instance-scoped state) rather than
// living inline here; every other integration below is a simple stateless stub.
const MOCK_RESPONSES: { pattern: RegExp; response: unknown | MockResponseFactory }[] = [
  { pattern: /alchemy\.com/, response: { result: '0x0', jsonrpc: '2.0', id: 1 } },
  { pattern: /tatum\.io/, response: { balance: '0', transactions: [] } },
  { pattern: /api\.sift\.com/, response: { status: 0, score: 0.1 } },
  { pattern: /coingecko\.com/, response: { bitcoin: { usd: 50000, chf: 45000 } } },
  { pattern: /sumsub\.com/, response: { id: 'mock-applicant', status: 'pending' } },
  { pattern: /online-ident\.ch/, response: { sessionId: 'mock-session', status: 'created' } },
  { pattern: /dilisense/, response: { matches: [], riskScore: 0 } },
  { pattern: /letterxpress/, response: { letterId: 'mock-letter', status: 'queued' } },
  { pattern: /blockfrost\.io/, response: { amount: [] } },
  { pattern: /goldsky\.com/, response: { data: { transfers: [] } } },
  {
    pattern: /sepatools\.eu/,
    response: {
      result: 'passed',
      iban: 'valid',
      sct: 'yes',
      sct_inst: 'yes',
      bic_candidates: [{ bic: 'MOCKBIC1XXX' }],
    },
  },
  { pattern: /login\.microsoftonline\.com/, response: { access_token: 'mock-token', expires_in: 3600 } },
  { pattern: /aktionariat\.com/, response: { priceInCHF: 1.57, priceInEUR: 1.71, availableShares: 65488 } },
];

@Injectable()
export class HttpService {
  private readonly logger = new DfxLogger(HttpService);
  private readonly isMockMode: boolean;
  // Instance-scoped, not shared across separately-constructed HttpService instances (e.g. across test
  // files) - a fresh gateway (and its stateful order Map) is created lazily only when actually mocking.
  private frickMockGateway?: FrickMockGateway;

  constructor(private readonly http: Http) {
    this.isMockMode = GetConfig().environment === Environment.LOC;
    if (this.isMockMode) {
      this.logger.info('HttpService running in MOCK mode - external calls will be mocked');
    }
  }

  private shouldMock(url: string): boolean {
    if (!this.isMockMode) return false;
    // Don't mock localhost calls
    if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
    return true;
  }

  private getMockResponse<T>(url: string, config?: HttpRequestConfig): T {
    this.frickMockGateway ??= new FrickMockGateway();
    let response: unknown;
    if (this.frickMockGateway.matches(url)) {
      response = this.frickMockGateway.resolve(url, config);
    } else {
      const mock = MOCK_RESPONSES.find((m) => m.pattern.test(url));
      response = typeof mock?.response === 'function' ? mock.response(url, config) : (mock?.response ?? { mock: true });
    }
    this.logger.verbose(`Mock HTTP: ${url.substring(0, 80)}... → ${JSON.stringify(response).substring(0, 50)}`);
    return response as T;
  }

  public async get<T>(url: string, config?: HttpRequestConfig): Promise<T> {
    if (this.shouldMock(url)) return this.getMockResponse<T>(url);
    return (await this.getRaw<T>(url, config)).data;
  }

  public async getRaw<T>(url: string, config?: HttpRequestConfig): Promise<AxiosResponse<T>> {
    if (this.shouldMock(url)) {
      return { data: this.getMockResponse<T>(url), status: 200, statusText: 'OK', headers: {}, config: {} as any };
    }
    return Util.retry(() => firstValueFrom(this.http.get<T>(url, config)), config?.tryCount ?? 1, config?.retryDelay);
  }

  public async put<T>(url: string, data: any, config?: HttpRequestConfig): Promise<T> {
    if (this.shouldMock(url)) return this.getMockResponse<T>(url);
    return (
      await Util.retry(
        () => firstValueFrom(this.http.put<T>(url, data, config)),
        config?.tryCount ?? 1,
        config?.retryDelay,
      )
    ).data;
  }

  public async post<T>(url: string, data: any, config?: HttpRequestConfig): Promise<T> {
    if (this.shouldMock(url)) return this.getMockResponse<T>(url);
    return (
      await Util.retry(
        () => firstValueFrom(this.http.post<T>(url, data, config)),
        config?.tryCount ?? 1,
        config?.retryDelay,
      )
    ).data;
  }

  public async postRaw<T>(url: string, data: any, config?: HttpRequestConfig): Promise<AxiosResponse<T>> {
    if (this.shouldMock(url)) {
      return { data: this.getMockResponse<T>(url), status: 200, statusText: 'OK', headers: {}, config: {} as any };
    }
    return Util.retry(
      () => firstValueFrom(this.http.post<T>(url, data, config)),
      config?.tryCount ?? 1,
      config?.retryDelay,
    );
  }

  public async patch<T>(url: string, data: any, config?: HttpRequestConfig): Promise<T> {
    if (this.shouldMock(url)) return this.getMockResponse<T>(url);
    return (
      await Util.retry(
        () => firstValueFrom(this.http.patch<T>(url, data, config)),
        config?.tryCount ?? 1,
        config?.retryDelay,
      )
    ).data;
  }

  public async delete<T>(url: string, config?: HttpRequestConfig): Promise<T> {
    if (this.shouldMock(url)) return this.getMockResponse<T>(url);
    return (
      await Util.retry(
        () => firstValueFrom(this.http.delete<T>(url, config)),
        config?.tryCount ?? 1,
        config?.retryDelay,
      )
    ).data;
  }

  public async request<T>(config: HttpRequestConfig): Promise<T> {
    if (config.url && this.shouldMock(config.url)) return this.getMockResponse<T>(config.url, config);
    const { tryCount, retryDelay, responseVerifier, ...axiosConfig } = config;
    const requestedResponseType = axiosConfig.responseType;
    if (responseVerifier) {
      // Preserve the exact response bytes as a Buffer until the detached signature was verified. Any
      // string decoding (even axios' own default UTF-8 text handling) can strip a BOM or lossily
      // transcode non-UTF-8 bytes before the verifier ever sees them - arraybuffer is the only
      // responseType that hands back the untouched bytes.
      axiosConfig.responseType = 'arraybuffer';
      axiosConfig.transformResponse = [(data) => data];
    }

    let response: AxiosResponse<T>;
    try {
      response = await Util.retry(() => firstValueFrom(this.http.request<T>(axiosConfig)), tryCount ?? 1, retryDelay);
    } catch (error) {
      // Non-2xx responses reject before the success-path verifier below. Without verifying those
      // error bodies too, a mid-flight spoofed HTTP error status (unsigned bytes) would skip crypto
      // checks and still surface as a concrete status to callers that treat 4xx as definitive.
      if (responseVerifier) this.verifySignedErrorResponse(error, responseVerifier);
      throw error;
    }

    if (!responseVerifier) return response.data;
    if (!Buffer.isBuffer(response.data)) throw new Error('Signed HTTP response body is not a raw byte buffer');

    responseVerifier(response.data, response.headers, response.status);
    const decoded = response.data.toString('utf8');
    if (requestedResponseType === 'text') return decoded as T;
    return JSON.parse(decoded) as T;
  }

  /**
   * When a signed request fails with an actual HTTP response, verify the detached signature on the
   * raw error body before the original axios error is allowed to propagate. Pure transport failures
   * (no `error.response`) have nothing to verify and pass through unchanged.
   */
  private verifySignedErrorResponse(
    error: unknown,
    responseVerifier: NonNullable<HttpRequestConfig['responseVerifier']>,
  ): void {
    const httpResponse = (
      error as {
        response?: { data?: unknown; headers?: AxiosResponse['headers']; status?: number };
      }
    )?.response;
    if (!httpResponse) return;

    if (!Buffer.isBuffer(httpResponse.data)) {
      throw new Error('Signed HTTP error response body is not a raw byte buffer');
    }

    // Verifier throws on bad/missing signature → that error must replace the original axios error.
    // On success, the caller re-throws the original so status classification stays intact. The status
    // is handed over because the replacing error is the only one the caller will ever see: without it,
    // a rejected error response loses the status that the original axios error carried.
    responseVerifier(httpResponse.data, httpResponse.headers, httpResponse.status);
  }

  async downloadFile(fileUrl: string, filePath: string) {
    if (this.shouldMock(fileUrl)) {
      this.logger.verbose(`Mock HTTP: Skipping file download from ${fileUrl}`);
      return true;
    }

    const stream = await this.http.axiosRef.request({ method: 'GET', url: fileUrl, responseType: 'stream' });
    const writer = createWriteStream(filePath);

    return new Promise((resolve, reject) => {
      stream.data.pipe(writer);

      let error = null;

      writer.on('error', (err) => {
        error = err;
        writer.close();
        reject(err);
      });

      writer.on('close', () => !error && resolve(true));
    });
  }
}
