import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';

interface MockResponse {
  pattern: RegExp;
  response: any;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
}

@Injectable()
export class MockHttpService {
  private readonly logger = new DfxLogger(MockHttpService);

  private readonly mockResponses: MockResponse[] = [
    // Alchemy
    {
      pattern: /alchemy\.com/,
      response: { result: '0x0', jsonrpc: '2.0', id: 1 },
    },
    // Tatum
    {
      pattern: /tatum\.io/,
      response: { balance: '0', transactions: [] },
    },
    // Sift
    {
      pattern: /api\.sift\.com/,
      response: { status: 0, score: 0.1 },
    },
    // CoinGecko
    {
      pattern: /coingecko\.com/,
      response: { bitcoin: { usd: 50000, chf: 45000 } },
    },
    // SumSub
    {
      pattern: /sumsub\.com/,
      response: { id: 'mock-applicant', status: 'pending' },
    },
    // Ident.ch
    {
      pattern: /online-ident\.ch/,
      response: { sessionId: 'mock-session', status: 'created' },
    },
    // Dilisense
    {
      pattern: /dilisense/,
      response: { matches: [], riskScore: 0 },
    },
    // Letter
    {
      pattern: /letterxpress/,
      response: { letterId: 'mock-letter', status: 'queued' },
    },
    // Default fallback
    {
      pattern: /.*/,
      response: { mock: true, message: 'Mocked response' },
    },
  ];

  async get<T>(url: string, _config?: any): Promise<T> {
    return this.mock('GET', url);
  }

  async post<T>(url: string, _data?: any, _config?: any): Promise<T> {
    return this.mock('POST', url);
  }

  async put<T>(url: string, _data?: any, _config?: any): Promise<T> {
    return this.mock('PUT', url);
  }

  async patch<T>(url: string, _data?: any, _config?: any): Promise<T> {
    return this.mock('PATCH', url);
  }

  async delete<T>(url: string, _config?: any): Promise<T> {
    return this.mock('DELETE', url);
  }

  async request<T>(_config: any): Promise<T> {
    return this.mock('GET', _config.url || 'unknown');
  }

  async downloadFile(_fileUrl: string, _filePath: string): Promise<void> {
    this.logger.verbose('Mock: Skipping file download');
  }

  private mock<T>(method: string, url: string): T {
    const mockResponse = this.mockResponses.find((m) => m.pattern.test(url) && (!m.method || m.method === method));

    this.logger.verbose(`Mock ${method} ${url} → ${JSON.stringify(mockResponse?.response).substring(0, 100)}`);

    return (mockResponse?.response ?? { mock: true }) as T;
  }
}
