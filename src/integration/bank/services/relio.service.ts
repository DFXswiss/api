import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import {
  RelioAccount,
  RelioAuthContext,
  RelioCurrency,
  RelioFxPaymentRequest,
  RelioFxQuoteRequest,
  RelioFxQuoteResponse,
  RelioPaymentOrderRequest,
  RelioPaymentOrderResponse,
  RelioWallet,
  RelioWalletListResponse,
} from '../dto/relio.dto';

export interface RelioBalanceInfo {
  walletId: string;
  iban: string;
  currency: string;
  availableBalance: number;
  totalBalance: number;
}

@Injectable()
export class RelioService {
  private readonly logger = new DfxLogger(RelioService);
  private privateKey: crypto.KeyObject | undefined;

  constructor(private readonly http: HttpService) {
    this.initializePrivateKey();
  }

  private initializePrivateKey(): void {
    const keyPem = Config.bank.relio?.privateKey;
    if (!keyPem) return;

    try {
      this.privateKey = crypto.createPrivateKey({
        key: keyPem,
        format: 'pem',
        type: 'pkcs8',
      });
    } catch (e) {
      this.logger.error('Failed to initialize Relio Ed25519 private key:', e);
    }
  }

  // --- AVAILABILITY CHECK --- //

  isAvailable(): boolean {
    const { baseUrl, apiKey, privateKey, organizationId } = Config.bank.relio ?? {};
    return !!(baseUrl && apiKey && privateKey && organizationId && this.privateKey);
  }

  // --- AUTH METHODS --- //

  async getAuthContext(): Promise<RelioAuthContext> {
    return this.callApi<RelioAuthContext>('auth/context', 'GET');
  }

  // --- ACCOUNT METHODS --- //

  async getAccounts(pageNumber = 1, pageSize = 1000): Promise<RelioAccount[]> {
    return this.callApi<RelioAccount[]>(`accounts?pageNumber=${pageNumber}&pageSize=${pageSize}`, 'GET');
  }

  async getAccount(accountId: string): Promise<RelioAccount> {
    return this.callApi<RelioAccount>(`accounts/${accountId}`, 'GET');
  }

  // --- WALLET METHODS --- //

  async getWallets(pageNumber = 1, pageSize = 1000): Promise<RelioWalletListResponse> {
    return this.callApi<RelioWalletListResponse>(`wallets?pageNumber=${pageNumber}&pageSize=${pageSize}`, 'GET');
  }

  async getWallet(walletId: string): Promise<RelioWallet> {
    return this.callApi<RelioWallet>(`wallets/${walletId}`, 'GET');
  }

  async getBalances(): Promise<RelioBalanceInfo[]> {
    const walletsResponse = await this.getWallets();

    // Fetch all wallet details in parallel for better performance
    const wallets = await Promise.all(walletsResponse.data.map((item) => this.getWallet(item.id)));

    return wallets.map((wallet) => ({
      walletId: wallet.id,
      iban: wallet.iban,
      currency: wallet.currency,
      availableBalance: this.convertRelioAmount(wallet.availableBalance.amount),
      totalBalance: this.convertRelioAmount(wallet.balance.amount),
    }));
  }

  // --- PAYMENT METHODS --- //

  async createPaymentOrder(request: RelioPaymentOrderRequest): Promise<RelioPaymentOrderResponse> {
    return this.callApi<RelioPaymentOrderResponse>('payment-orders', 'POST', request);
  }

  async sendPayment(
    walletId: string,
    amount: number,
    currency: RelioCurrency,
    recipientName: string,
    recipientIban: string,
    recipientCountry: string,
    reference?: string,
    recipientAddress?: string,
    recipientCity?: string,
    recipientPostCode?: string,
  ): Promise<RelioPaymentOrderResponse> {
    const request: RelioPaymentOrderRequest = {
      walletId,
      name: `Payment to ${recipientName}`,
      payment: {
        payee: {
          name: recipientName,
          accountNumber: recipientIban,
          country: recipientCountry,
          ...(recipientAddress && { addressLine1: recipientAddress }),
          ...(recipientCity && { city: recipientCity }),
          ...(recipientPostCode && { postCode: recipientPostCode }),
        },
        amount: {
          currency,
          amount: this.toRelioAmount(amount),
        },
        ...(reference && { reference }),
      },
    };

    return this.createPaymentOrder(request);
  }

  async cancelScheduledPayment(accountId: string, paymentId: string): Promise<void> {
    await this.callApi<unknown>(`accounts/${accountId}/payments-not-executed/${paymentId}`, 'DELETE');
  }

  // --- FX METHODS --- //

  async getFxQuote(
    sourceWalletId: string,
    targetWalletId: string,
    amount: string,
    amountType: 'SOURCE' | 'TARGET' = 'SOURCE',
  ): Promise<RelioFxQuoteResponse> {
    const request: RelioFxQuoteRequest = {
      sourceWalletId,
      targetWalletId,
      amount: {
        type: amountType,
        value: amount,
      },
    };

    return this.callApi<RelioFxQuoteResponse>('quotes-fx', 'POST', request);
  }

  async executeFxPayment(quoteId: string, quoteOptionId: string, name: string, reference?: string): Promise<void> {
    const request: RelioFxPaymentRequest = {
      quoteId,
      quoteOptionId,
      name,
      ...(reference && { reference }),
    };

    await this.callApi<void>('payment-orders/from-quote', 'POST', request);
  }

  // --- AMOUNT CONVERSION --- //

  /**
   * Convert Relio amount string (minor units) to number
   * e.g., "98434500" -> 984345.00
   */
  convertRelioAmount(amount: string): number {
    const numericAmount = parseInt(amount, 10);
    if (isNaN(numericAmount)) return 0;
    return numericAmount / 100;
  }

  /**
   * Convert number to Relio amount string (minor units)
   * e.g., 984345.00 -> "98434500"
   */
  toRelioAmount(amount: number): string {
    return Math.round(amount * 100).toString();
  }

  // --- ED25519 SIGNING --- //

  /**
   * Create canonical request string for signing
   * Format: ${METHOD}${originalUrl}${sortedBody}
   *
   * Based on Relio NodeJS example:
   * - originalUrl = path + queryString AS-IS (no sorting!)
   * - body keys sorted at top-level only
   *
   * @see Relio API documentation - "Requests signing in NodeJS" section
   */
  private createCanonicalString(method: string, originalUrl: string, body?: unknown): string {
    const canonicalBody = this.buildCanonicalBody(body);
    return `${method.toUpperCase()}${originalUrl}${canonicalBody}`;
  }

  /**
   * Build canonical body string with top-level sorted keys
   *
   * From Relio NodeJS example (page 4):
   * ```
   * let body = "";
   * if (request.body) {
   *   if (typeof request.body === "object") {
   *     const sortedKeys = Object.keys(request.body).sort();
   *     body = JSON.stringify(
   *       sortedKeys.reduce((acc, key) => ((acc[key] = request.body[key]), acc), {})
   *     );
   *   } else if (typeof request.body === "string") {
   *     body = request.body;
   *   }
   * }
   * ```
   *
   * Key behaviors (matching NodeJS example exactly):
   * - null/undefined → '' (falsy check: if (request.body))
   * - empty object {} → '{}' (truthy, gets stringified)
   * - arrays → JSON.stringify as-is (no sorting)
   * - objects → sort top-level keys only, then stringify
   * - strings → use as-is
   */
  private buildCanonicalBody(body: unknown): string {
    // Matches: if (request.body) - falsy values return empty string
    if (!body) {
      return '';
    }

    // Matches: if (typeof request.body === "object")
    if (typeof body === 'object') {
      // Arrays: stringify as-is without sorting
      if (Array.isArray(body)) {
        return JSON.stringify(body);
      }

      // Objects (including empty {}): sort top-level keys and stringify
      const obj = body as Record<string, unknown>;
      const sortedKeys = Object.keys(obj).sort();
      const sortedObj: Record<string, unknown> = {};

      for (const key of sortedKeys) {
        sortedObj[key] = obj[key];
      }

      return JSON.stringify(sortedObj);
    }

    // Matches: else if (typeof request.body === "string")
    if (typeof body === 'string') {
      return body;
    }

    // Other primitives (number, boolean) - stringify
    return JSON.stringify(body);
  }

  /**
   * Sign the canonical string with Ed25519 private key
   */
  private signRequest(canonicalString: string): string {
    if (!this.privateKey) {
      throw new Error('Relio Ed25519 private key not initialized');
    }

    const signature = crypto.sign(null, Buffer.from(canonicalString, 'utf8'), this.privateKey);
    return signature.toString('base64');
  }

  // --- API CALL METHOD --- //

  private async callApi<T>(endpoint: string, method: Method = 'GET', data?: unknown): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error('Relio is not configured');
    }

    const { baseUrl, apiKey } = Config.bank.relio;

    // Build originalUrl for signing: /v1/path?query (query params AS-IS, no sorting)
    // This matches the Relio NodeJS example exactly
    const [pathPart, queryPart] = endpoint.split('?');
    const originalUrl = `/v1/${pathPart}${queryPart ? '?' + queryPart : ''}`;

    // Create canonical string and sign
    const canonicalString = this.createCanonicalString(method, originalUrl, data);
    const signature = this.signRequest(canonicalString);

    try {
      return await this.http.request<T>({
        url: `${baseUrl}/${endpoint}`,
        method,
        data,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-signature': signature,
        },
      });
    } catch (error) {
      const message = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || error;

      this.logger.error(`Relio API error (${method} ${endpoint}): ${message}`);
      throw new Error(`Relio API error (${method} ${endpoint}): ${message}`);
    }
  }
}
