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

export type HttpRequestConfig = AxiosRequestConfig & {
  tryCount?: number;
  retryDelay?: number;
  responseVerifier?: (rawBody: string, headers: AxiosResponse['headers']) => void;
};

type MockResponseFactory = (url: string, config?: HttpRequestConfig) => unknown;
const FRICK_MOCK_ORDERS = new Map<string, Record<string, unknown>>();

function parseMockRequestBody(config?: HttpRequestConfig): any {
  if (typeof config?.data === 'string') return JSON.parse(config.data);
  return config?.data ?? {};
}

function frickTransactionsResponse(transactions: Record<string, unknown>[]) {
  return { moreResults: false, resultSetSize: transactions.length, transactions };
}

// Mock responses for local development. Bank Frick is endpoint-aware because a generic `{}` response makes the
// integration appear reachable while every validator fails, which hides local wiring errors instead of simulating it.
const MOCK_RESPONSES: { pattern: RegExp; response: unknown | MockResponseFactory }[] = [
  {
    pattern: /bankfrick\.li\/webapi\/v2\/authorize(?:\?|$)/,
    response: () => {
      const header = Buffer.from(JSON.stringify({ alg: 'RS512', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      return { token: `${header}.${payload}.local-mock-signature` };
    },
  },
  {
    pattern: /bankfrick\.li\/webapi\/v2\/camt053(?:\?|$)/,
    response: (url) => {
      const iban = new URL(url).searchParams.get('iban') ?? 'SYNTHETIC-UNCONFIGURED-IBAN';
      return `<?xml version="1.0" encoding="UTF-8"?><Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>${iban}</IBAN></Id></Acct></Stmt></BkToCstmrStmt></Document>`;
    },
  },
  {
    pattern: /bankfrick\.li\/webapi\/v2\/accounts(?:\/|\?|$)/,
    response: { date: '2026-01-01', moreResults: false, resultSetSize: 0, accounts: [] },
  },
  {
    pattern: /bankfrick\.li\/webapi\/v2\/signTransactionWithoutTan(?:\?|$)/,
    response: (_url, config) => {
      const request = parseMockRequestBody(config);
      const orderIds = new Set((request.orderIds ?? []).map(String));
      const customIds = new Set(request.customIds ?? []);
      const orders = [...FRICK_MOCK_ORDERS.values()]
        .filter((order) => orderIds.has(String(order.orderId)) || customIds.has(String(order.customId)))
        .map<Record<string, unknown>>((order) => ({ ...order, state: 'IN_PROGRESS' }));
      orders.forEach((order) => FRICK_MOCK_ORDERS.set(String(order.customId), order));
      return frickTransactionsResponse(orders);
    },
  },
  {
    pattern: /bankfrick\.li\/webapi\/v2\/transactions(?:\?|$)/,
    response: (url, config) => {
      if (config?.method?.toUpperCase() === 'PUT') {
        const transaction = parseMockRequestBody(config).transactions?.[0];
        if (!transaction) return frickTransactionsResponse([]);
        const order = { ...transaction, orderId: FRICK_MOCK_ORDERS.size + 1, state: 'PREPARED' };
        FRICK_MOCK_ORDERS.set(String(order.customId), order);
        return frickTransactionsResponse([order]);
      }

      const customId = new URL(url).searchParams.get('customId');
      const order = customId ? FRICK_MOCK_ORDERS.get(customId) : undefined;
      return frickTransactionsResponse(order ? [order] : []);
    },
  },
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
    const mock = MOCK_RESPONSES.find((m) => m.pattern.test(url));
    const response =
      typeof mock?.response === 'function' ? mock.response(url, config) : (mock?.response ?? { mock: true });
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
      // Preserve the exact response bytes as a UTF-8 string until the detached signature was verified. Axios' JSON
      // transform would otherwise parse/re-serialize the body and make verification both unreliable and unsafe.
      axiosConfig.responseType = 'text';
      axiosConfig.transformResponse = [(data) => data];
    }

    const response = await Util.retry(
      () => firstValueFrom(this.http.request<T>(axiosConfig)),
      tryCount ?? 1,
      retryDelay,
    );
    if (!responseVerifier) return response.data;
    if (typeof response.data !== 'string') throw new Error('Signed HTTP response body is not raw text');

    responseVerifier(response.data, response.headers);
    if (requestedResponseType === 'text') return response.data as T;
    return JSON.parse(response.data) as T;
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
