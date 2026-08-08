import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import {
  FiatRepublicCreateEndUserRequest,
  FiatRepublicCreatePayeeRequest,
  FiatRepublicCreatePaymentRequest,
  FiatRepublicCreateVirtualAccountRequest,
  FiatRepublicEndUserResponse,
  FiatRepublicErrorResponse,
  FiatRepublicFiatAccountResponse,
  FiatRepublicPayeeResponse,
  FiatRepublicPayeeVerificationResponse,
  FiatRepublicPayerResponse,
  FiatRepublicPaymentResponse,
  FiatRepublicTokenResponse,
  FiatRepublicVirtualAccountResponse,
  FiatRepublicVirtualAccountTransaction,
} from '../dto/fiat-republic.dto';

/** The call was rejected before Fiat Republic could create anything — a retry is safe. */
export class FiatRepublicNotCreatedError extends Error {}

/** Fiat Republic answered 404 for an object we expected to exist. */
export class FiatRepublicNotFoundError extends Error {}

/**
 * The client could not obtain an access token at all. Kept distinct from every API-level error so a
 * credential or connectivity problem is diagnosable as such instead of being reported as a failure of
 * whichever endpoint happened to be called first.
 */
export class FiatRepublicAuthError extends Error {}

const HTTP_TIMEOUT_MS = 30_000;
/** Refresh the access token this long before its nominal expiry, to survive clock skew and latency. */
const TOKEN_REFRESH_SKEW_MS = 30_000;
const OAUTH_SCOPE = 'PAYMENTS';

@Injectable()
export class FiatRepublicService {
  private readonly logger = new DfxLogger(FiatRepublicService);

  private accessToken?: string;
  private accessTokenExpiry = 0;
  /** De-duplicates concurrent token requests — the /oauth/token endpoint is rate limited per client. */
  private authorizeInFlight?: Promise<string>;

  constructor(private readonly http: HttpService) {}

  // --- AVAILABILITY --- //

  /**
   * True once every credential the client needs is present. Deliberately separate from
   * {@link isAvailable}: a half-configured environment must look the same as an unconfigured one
   * to every caller, while operations can still tell the two apart in a health check.
   */
  isConfigured(): boolean {
    const { baseUrl, authUrl, clientId, clientSecret } = Config.bank.fiatRepublic;
    return !!(baseUrl && authUrl && clientId && clientSecret);
  }

  /** The master gate: credentials complete AND the explicit environment release set. */
  isAvailable(): boolean {
    return this.isConfigured() && Config.bank.fiatRepublic.enabled;
  }

  /** Stage 1 — ingest Fiat Republic payins into bank_tx. */
  isBankTxSyncEnabled(): boolean {
    return this.isAvailable() && Config.bank.fiatRepublic.bankTxSyncEnabled;
  }

  /** Stage 2 — offer Fiat Republic IBANs (collection and personal) to customers. */
  isFrontendEnabled(): boolean {
    return this.isAvailable() && Config.bank.fiatRepublic.frontendEnabled;
  }

  /** Stage 3 — transmit fiat outputs that are already assigned to Fiat Republic. */
  isPayoutEnabled(): boolean {
    return this.isAvailable() && Config.bank.fiatRepublic.payoutEnabled;
  }

  /**
   * Stage 4 — let the payout bank selection choose Fiat Republic for new EUR outputs instead of
   * Olkypay. Requires stage 3: routing a payout to a rail that may not transmit would strand it.
   */
  isPayoutRoutingEnabled(): boolean {
    return this.isPayoutEnabled() && Config.bank.fiatRepublic.payoutRoutingEnabled;
  }

  /** Webhook delivery needs its own secret on top of the master gate — see the controller. */
  isWebhookEnabled(): boolean {
    return this.isBankTxSyncEnabled() && !!Config.bank.fiatRepublic.webhookSecret;
  }

  // --- END USER --- //

  async createIndividualEndUser(request: FiatRepublicCreateEndUserRequest): Promise<FiatRepublicEndUserResponse> {
    return this.callApi<FiatRepublicEndUserResponse>('end-users/individuals', 'POST', request);
  }

  async getIndividualEndUser(endUserId: string): Promise<FiatRepublicEndUserResponse> {
    return this.callApi<FiatRepublicEndUserResponse>(`end-users/individuals/${encodeURIComponent(endUserId)}`, 'GET');
  }

  /**
   * Lists individual end users filtered by e-mail. This is the recovery listing after an ambiguous
   * create: a match proves the POST reached Fiat Republic, so no second one is ever issued. An empty
   * result is NOT proof of absence (a concurrent create may still be in flight) — callers fail closed.
   */
  async listIndividualEndUsersByEmail(email: string, limit = 50): Promise<FiatRepublicEndUserResponse[]> {
    const params = new URLSearchParams({ email, limit: `${limit}` });
    return this.callApi<FiatRepublicEndUserResponse[]>(`end-users/individuals?${params.toString()}`, 'GET');
  }

  // --- ACCOUNTS --- //

  async getFiatAccount(fiatAccountId: string): Promise<FiatRepublicFiatAccountResponse> {
    return this.callApi<FiatRepublicFiatAccountResponse>(`fiat-accounts/${encodeURIComponent(fiatAccountId)}`, 'GET');
  }

  /**
   * Returns the statement of the master fiat account as the raw CSV Fiat Republic serves
   * (`Date,Type,Scheme,Counterparty,Reference,Dr/Cr,Currency,Amount,Balance`). Used by
   * reconciliation as the authoritative record next to the per-payment view.
   */
  async getFiatAccountStatement(fiatAccountId: string, fromDate: Date, toDate: Date): Promise<string> {
    const params = new URLSearchParams({
      'createdAt(gte)': this.isoDate(fromDate),
      'createdAt(lte)': this.isoDate(toDate),
    });
    return this.callApi<string>(
      `fiat-accounts/${encodeURIComponent(fiatAccountId)}/statement?${params.toString()}`,
      'GET',
    );
  }

  /**
   * Creates a named sub-account (virtual account) for an end user. The idempotency key is derived
   * from the customer, so a retried create returns the original account instead of issuing a second
   * IBAN to the same person.
   */
  async createVirtualAccount(
    request: FiatRepublicCreateVirtualAccountRequest,
    idempotencyKey: string,
  ): Promise<FiatRepublicVirtualAccountResponse> {
    return this.callApi<FiatRepublicVirtualAccountResponse>('virtual-accounts', 'POST', request, idempotencyKey);
  }

  async getVirtualAccount(virtualAccountId: string): Promise<FiatRepublicVirtualAccountResponse> {
    return this.callApi<FiatRepublicVirtualAccountResponse>(
      `virtual-accounts/${encodeURIComponent(virtualAccountId)}`,
      'GET',
    );
  }

  /**
   * Lists virtual accounts of one end user. Used as the recovery listing after an ambiguous create:
   * an object found here is proof the create actually reached Fiat Republic, so no second POST is
   * ever issued for the same end user.
   */
  async listVirtualAccountsByEndUser(endUserId: string, limit = 50): Promise<FiatRepublicVirtualAccountResponse[]> {
    const params = new URLSearchParams({ endUserId, limit: `${limit}` });
    return this.callApi<FiatRepublicVirtualAccountResponse[]>(`virtual-accounts?${params.toString()}`, 'GET');
  }

  async getVirtualAccountTransactions(
    virtualAccountId: string,
    limit = 100,
    offset = 0,
  ): Promise<FiatRepublicVirtualAccountTransaction[]> {
    const params = new URLSearchParams({ virtualAccountId, limit: `${limit}`, offset: `${offset}` });
    return this.callApi<FiatRepublicVirtualAccountTransaction[]>(
      `virtual-account-transactions?${params.toString()}`,
      'GET',
    );
  }

  // --- PAYEE --- //

  /**
   * Creates a payee. The idempotency key is mandatory, not optional: an ambiguous failure would
   * otherwise let a retry — or a second concurrent payout to the same beneficiary — create a
   * duplicate payee, splitting one customer's beneficiaries across two objects.
   */
  async createPayee(
    request: FiatRepublicCreatePayeeRequest,
    idempotencyKey: string,
  ): Promise<FiatRepublicPayeeResponse> {
    return this.callApi<FiatRepublicPayeeResponse>('payees', 'POST', request, idempotencyKey);
  }

  async getPayee(payeeId: string): Promise<FiatRepublicPayeeResponse> {
    return this.callApi<FiatRepublicPayeeResponse>(`payees/${encodeURIComponent(payeeId)}`, 'GET');
  }

  /**
   * Starts the SEPA EUR Verification of Payee. Mandatory before every SCT payout: without an
   * `ACCEPTED`/`EXEMPT` verification id the payment call is rejected by Fiat Republic.
   */
  async verifyPayee(payeeId: string): Promise<FiatRepublicPayeeVerificationResponse> {
    return this.callApi<FiatRepublicPayeeVerificationResponse>(
      `payees/${encodeURIComponent(payeeId)}/verification`,
      'POST',
      {},
    );
  }

  /** Accepts (or declines) a CLOSE_MATCH/NO_MATCH verification result. */
  async reviewPayeeVerification(
    verificationId: string,
    accepted: boolean,
  ): Promise<FiatRepublicPayeeVerificationResponse> {
    return this.callApi<FiatRepublicPayeeVerificationResponse>(
      `payees/verifications/${encodeURIComponent(verificationId)}/review`,
      'POST',
      { accepted },
    );
  }

  async getPayeeVerification(verificationId: string): Promise<FiatRepublicPayeeVerificationResponse> {
    return this.callApi<FiatRepublicPayeeVerificationResponse>(
      `payees/verifications/${encodeURIComponent(verificationId)}`,
      'GET',
    );
  }

  // --- PAYMENT --- //

  /**
   * Creates a payout. The idempotency key is mandatory here, not optional: it is what turns a
   * network-level retry into a lookup of the original payment instead of a second transfer.
   */
  async createPayment(
    request: FiatRepublicCreatePaymentRequest,
    idempotencyKey: string,
  ): Promise<FiatRepublicPaymentResponse> {
    return this.callApi<FiatRepublicPaymentResponse>('payments', 'POST', request, idempotencyKey);
  }

  async getPayment(paymentId: string): Promise<FiatRepublicPaymentResponse> {
    return this.callApi<FiatRepublicPaymentResponse>(`payments/${encodeURIComponent(paymentId)}`, 'GET');
  }

  /**
   * Lists payments of the configured master account within a date window. `createdAt` filters are
   * whole days on Fiat Republic's side, so callers must still de-duplicate by payment id.
   */
  async listPayments(fromDate: Date, toDate: Date, limit = 100, offset = 0): Promise<FiatRepublicPaymentResponse[]> {
    const params = new URLSearchParams({
      'createdAt(gte)': this.isoDate(fromDate),
      'createdAt(lte)': this.isoDate(toDate),
      limit: `${limit}`,
      offset: `${offset}`,
    });
    return this.callApi<FiatRepublicPaymentResponse[]>(`payments?${params.toString()}`, 'GET');
  }

  /**
   * Finds the payment carrying an exact reference, paging until the window is exhausted.
   *
   * This is the recovery lookup for a payout whose create outcome is unknown: our references are
   * prefixed with the row's deterministic custom id, so a match is proof the payment exists and no
   * second one may be created. Returns undefined only when the window was searched completely and
   * contained no match — an incomplete search throws instead, because "not found" and "could not
   * look" must never collapse into the same answer for a money movement.
   */
  async findPaymentByReference(
    reference: string,
    fromDate: Date,
    toDate: Date,
    maxPages = 20,
    pageSize = 100,
  ): Promise<FiatRepublicPaymentResponse | undefined> {
    for (let page = 0; page < maxPages; page++) {
      const payments = await this.listPayments(fromDate, toDate, pageSize, page * pageSize);
      if (!payments?.length) return undefined;

      const match = payments.find((payment) => payment.reference === reference);
      if (match) return match;

      if (payments.length < pageSize) return undefined;
    }

    throw new Error(`FIAT REPUBLIC payment lookup exceeded ${maxPages} pages without exhausting the window`);
  }

  async getPayer(payerId: string): Promise<FiatRepublicPayerResponse> {
    return this.callApi<FiatRepublicPayerResponse>(`payers/${encodeURIComponent(payerId)}`, 'GET');
  }

  // --- HELPER METHODS --- //

  private isoDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry) return this.accessToken;

    // Concurrent callers share one request: the token endpoint is rate limited per client id, and a
    // burst of payout transmissions would otherwise each authenticate on their own.
    this.authorizeInFlight ??= this.requestAccessToken().finally(() => (this.authorizeInFlight = undefined));
    return this.authorizeInFlight;
  }

  private async requestAccessToken(): Promise<string> {
    const { authUrl, clientId, clientSecret } = Config.bank.fiatRepublic;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: OAUTH_SCOPE,
      client_id: clientId,
      client_secret: clientSecret,
    });

    try {
      const response = await this.http.request<FiatRepublicTokenResponse>({
        url: authUrl,
        method: 'POST',
        data: body.toString(),
        timeout: HTTP_TIMEOUT_MS,
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (!response?.access_token) throw new Error('response contained no access token');

      this.accessToken = response.access_token;
      this.accessTokenExpiry = Date.now() + Math.max(0, response.expires_in * 1000 - TOKEN_REFRESH_SKEW_MS);
      return this.accessToken;
    } catch (error) {
      this.accessToken = undefined;
      this.accessTokenExpiry = 0;
      throw new FiatRepublicAuthError(`FIAT REPUBLIC authentication failed: ${this.errorMessage(error)}`);
    }
  }

  private async callApi<T>(url: string, method: Method, data?: unknown, idempotencyKey?: string): Promise<T> {
    if (!this.isAvailable()) throw new Error('FIAT REPUBLIC is not configured');

    try {
      return await this.execute<T>(url, method, data, idempotencyKey);
    } catch (error) {
      // Authentication failures keep their own identity: masking them as an error of the endpoint
      // that happened to trigger the token request would hide a credential or connectivity problem
      // behind an unrelated payment or account path.
      if (error instanceof FiatRepublicAuthError) throw error;

      // A 401 means the cached token was rejected (rotated key, early expiry). Drop it and retry
      // exactly once so a single stale token does not fail an otherwise healthy call. The retry
      // reuses the same idempotency key, so a POST that did reach Fiat Republic is not duplicated.
      if (error?.['response']?.status !== 401 || !this.accessToken) throw this.toDomainError(error, method, url);

      this.accessToken = undefined;
      this.accessTokenExpiry = 0;

      try {
        return await this.execute<T>(url, method, data, idempotencyKey);
      } catch (retryError) {
        if (retryError instanceof FiatRepublicAuthError) throw retryError;
        throw this.toDomainError(retryError, method, url);
      }
    }
  }

  private async execute<T>(url: string, method: Method, data?: unknown, idempotencyKey?: string): Promise<T> {
    const { baseUrl } = Config.bank.fiatRepublic;
    const token = await this.getAccessToken();

    return this.http.request<T>({
      url: `${baseUrl}/${url}`,
      method,
      data,
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
      },
    });
  }

  /**
   * Classifies an upstream failure without carrying its payload into the message. Fiat Republic
   * echoes request data in `warnings`, and our requests contain IBANs, names and addresses — those
   * messages end up persisted on fiat_output rows and in alert mails, so only the fixed
   * `errorCode`/HTTP status is propagated. The full body is logged once, at error level, here.
   */
  private toDomainError(error: unknown, method: Method, url: string): Error {
    const status = error?.['response']?.status;
    const body = error?.['response']?.data as FiatRepublicErrorResponse | undefined;
    const errorCode = typeof body?.errorCode === 'string' ? body.errorCode : undefined;
    const path = url.split('?')[0];

    this.logger.error(
      `FIAT REPUBLIC API error (${method} ${path}, status ${status ?? 'unknown'}, code ${errorCode ?? 'unknown'})`,
      error instanceof Error ? error : undefined,
    );

    const summary = `FIAT REPUBLIC API error (${method} ${path}): status ${status ?? 'unknown'}, code ${
      errorCode ?? 'unknown'
    }`;

    if (status === 404) return new FiatRepublicNotFoundError(summary);
    // 4xx other than 409 (idempotency conflict) and 429 (rate limit) are deterministic rejections:
    // Fiat Republic validated and refused the request, so nothing was created and a retry with the
    // same key is safe. 409/429/5xx stay ambiguous and must not be classified as "not created".
    if (status >= 400 && status < 500 && status !== 409 && status !== 429)
      return new FiatRepublicNotCreatedError(summary);

    return new Error(summary);
  }

  private errorMessage(error: unknown): string {
    const status = error?.['response']?.status;
    const errorCode = (error?.['response']?.data as FiatRepublicErrorResponse | undefined)?.errorCode;
    if (status || errorCode) return `status ${status ?? 'unknown'}, code ${errorCode ?? 'unknown'}`;
    return error instanceof Error ? error.message : 'unknown error';
  }
}
