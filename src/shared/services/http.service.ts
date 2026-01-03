import { HttpService as Http } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { createWriteStream } from 'fs';
import { firstValueFrom } from 'rxjs';
import { Environment, GetConfig } from 'src/config/config';
import { Util } from '../utils/util';
import { DfxLogger } from './dfx-logger';

export interface HttpError {
  response?: {
    status?: number;
    data?: any;
  };
}

export type HttpRequestConfig = AxiosRequestConfig & { tryCount?: number; retryDelay?: number };

// Mock responses for local development
const MOCK_RESPONSES: { pattern: RegExp; response: any }[] = [
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
  { pattern: /api\.applicationinsights\.io/, response: { tables: [{ name: 'PrimaryResult', columns: [], rows: [] }] } },
];

@Injectable()
export class HttpService {
  private readonly logger = new DfxLogger(HttpService);
  private readonly isMockMode: boolean;

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

  private getMockResponse<T>(url: string): T {
    const mock = MOCK_RESPONSES.find((m) => m.pattern.test(url));
    this.logger.verbose(
      `Mock HTTP: ${url.substring(0, 80)}... → ${JSON.stringify(mock?.response ?? {}).substring(0, 50)}`,
    );
    return (mock?.response ?? { mock: true }) as T;
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
    if (config.url && this.shouldMock(config.url)) return this.getMockResponse<T>(config.url);
    return (
      await Util.retry(() => firstValueFrom(this.http.request<T>(config)), config?.tryCount ?? 1, config?.retryDelay)
    ).data;
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
