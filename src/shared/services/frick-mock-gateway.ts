import { HttpRequestConfig } from './http.service';

// Local-development mock for the Bank Frick WebAPI. Bank Frick is endpoint-aware (unlike the generic
// `{ mock: true }` responses in http.service.ts) because a bare stub response makes the integration
// appear reachable while every validator fails, hiding local wiring errors instead of simulating them.
// This state is genuinely stateful (created orders must be findable/approvable across subsequent
// calls), which is the wrong shape for the shared, stateless HttpService - kept in its own class with
// its own instance-scoped Map so it never leaks state across separately-constructed HttpService
// instances (e.g. across test files).

export interface FrickMockOrder {
  customId: string;
  orderId?: number;
  state: string;
  [field: string]: unknown;
}

interface FrickMockTransactionsRequest {
  transactions?: FrickMockOrder[];
}

interface FrickMockApproveRequest {
  orderIds?: (number | string)[];
  customIds?: string[];
}

function parseMockRequestBody<T>(config?: HttpRequestConfig): Partial<T> {
  if (typeof config?.data === 'string') return JSON.parse(config.data) as Partial<T>;
  return (config?.data as Partial<T>) ?? {};
}

function frickTransactionsResponse(transactions: FrickMockOrder[]): {
  moreResults: boolean;
  resultSetSize: number;
  transactions: FrickMockOrder[];
} {
  return { moreResults: false, resultSetSize: transactions.length, transactions };
}

export class FrickMockGateway {
  private readonly orders = new Map<string, FrickMockOrder>();

  matches(url: string): boolean {
    return /bankfrick\.li\/webapi\/v2\//.test(url);
  }

  resolve(url: string, config?: HttpRequestConfig): unknown {
    if (/\/authorize(?:\?|$)/.test(url)) return this.handleAuthorize();
    if (/\/camt053(?:\?|$)/.test(url)) return this.handleCamt053(url);
    if (/\/accounts(?:\/|\?|$)/.test(url)) return this.handleAccounts();
    if (/\/signTransactionWithoutTan(?:\?|$)/.test(url)) return this.handleSignTransactionWithoutTan(config);
    if (/\/transactions(?:\?|$)/.test(url)) return this.handleTransactions(url, config);
    return { mock: true };
  }

  private handleAuthorize(): { token: string } {
    const header = Buffer.from(JSON.stringify({ alg: 'RS512', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    return { token: `${header}.${payload}.local-mock-signature` };
  }

  private handleCamt053(url: string): string {
    const iban = new URL(url).searchParams.get('iban') ?? 'SYNTHETIC-UNCONFIGURED-IBAN';
    return `<?xml version="1.0" encoding="UTF-8"?><Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>${iban}</IBAN></Id></Acct></Stmt></BkToCstmrStmt></Document>`;
  }

  private handleAccounts(): { date: string; moreResults: boolean; resultSetSize: number; accounts: unknown[] } {
    return { date: '2026-01-01', moreResults: false, resultSetSize: 0, accounts: [] };
  }

  private handleSignTransactionWithoutTan(config?: HttpRequestConfig) {
    const request = parseMockRequestBody<FrickMockApproveRequest>(config);
    const orderIds = new Set((request.orderIds ?? []).map(String));
    const customIds = new Set(request.customIds ?? []);
    const orders = [...this.orders.values()]
      .filter((order) => orderIds.has(String(order.orderId)) || customIds.has(String(order.customId)))
      .map((order) => ({ ...order, state: 'IN_PROGRESS' }));
    orders.forEach((order) => this.orders.set(String(order.customId), order));
    return frickTransactionsResponse(orders);
  }

  private handleTransactions(url: string, config?: HttpRequestConfig) {
    if (config?.method?.toString().toUpperCase() === 'PUT') {
      const transaction = parseMockRequestBody<FrickMockTransactionsRequest>(config).transactions?.[0];
      if (!transaction) return frickTransactionsResponse([]);
      const order: FrickMockOrder = { ...transaction, orderId: this.orders.size + 1, state: 'PREPARED' };
      this.orders.set(String(order.customId), order);
      return frickTransactionsResponse([order]);
    }

    const customId = new URL(url).searchParams.get('customId');
    const order = customId ? this.orders.get(customId) : undefined;
    return frickTransactionsResponse(order ? [order] : []);
  }
}
