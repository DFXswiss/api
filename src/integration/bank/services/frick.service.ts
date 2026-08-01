import { Injectable } from '@nestjs/common';
import { AxiosError, AxiosResponse, Method } from 'axios';
import * as IbanTools from 'ibantools';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import {
  FrickApproveVirtualIbanActivationRequest,
  FrickCreateVirtualIbanRequest,
  FrickVirtualIban,
  FrickVirtualIbanState,
  FrickVirtualIbansResponse,
} from '../dto/frick-vban.dto';
import {
  FrickAccountsResponse,
  FrickApproveWithoutTanRequest,
  FrickAuthorizeRequest,
  FrickAuthorizeResponse,
  FrickBalance,
  FrickCreateTransaction,
  FrickCreateTransactionsRequest,
  FrickPaymentAccount,
  FrickPaymentCharge,
  FrickPaymentOrder,
  FrickPaymentOrderInput,
  FrickPaymentOrderNotFoundError,
  FrickPaymentState,
  FrickPaymentType,
  FrickSignatureVerificationError,
  FrickTransactionsResponse,
} from '../dto/frick.dto';
import { CamtTransaction, Iso20022Service } from './iso20022.service';

type FrickResponseType = 'json' | 'text';

/** A vIBAN create failure for which no Bank Frick object can have been created. */
export class FrickVibanNotCreatedError extends Error {}

export interface FrickTransactionsFetchResult {
  transactions: Partial<BankTx>[];
  // False when at least one CAMT entry in this fetch failed strict validation (bad money-critical
  // field, or no bank-provided reference) and was dropped. The caller must not advance its watermark
  // past a fetch that is not fully parsed, even though the other, well-formed entries are returned and
  // should still be imported this cycle.
  fullyParsed: boolean;
}

/** Result of a full virtual-IBAN list traversal (mirrors {@link FrickTransactionsFetchResult}). */
export interface FrickVirtualIbansFetchResult {
  virtualIbans: FrickVirtualIban[];
  // False when at least one list entry failed per-entry validation and was dropped. Callers that
  // inspect listing misses must treat fullyValidated=false as an incomplete check, never as proof of
  // absence. Reconciliation is alert-only; well-formed entries may still prove positive matches.
  fullyValidated: boolean;
  /** Local instant immediately before the first page request was dispatched. */
  listingStartedAt: Date;
  /** Local instant after the final page was received and validated. */
  listingCompletedAt: Date;
}

@Injectable()
export class BankFrickService {
  private readonly logger = new DfxLogger(BankFrickService);

  private static readonly TOKEN_REFRESH_SKEW_MS = 30_000;
  // Bank Frick's transaction search silently limits results to a short recent window unless a fromDate
  // is supplied. Every customId lookup must send this wide fromDate, not only the BOOKED fallback, so a
  // stale or slow-settling order can never be missed and re-submitted as a duplicate payout.
  private static readonly EARLIEST_FROM_DATE = '1970-01-01';
  // Every Bank Frick request combined with an unbounded cron lock (see checkFrickOrderStatus's
  // DfxCron timeout) means a single hung connection would otherwise stall the payout status poller
  // permanently and silently.
  private static readonly HTTP_TIMEOUT_MS = 30_000;

  private accessToken?: string;
  private tokenExpiryMs = 0;
  private authorizeInFlight?: Promise<string>;

  constructor(private readonly http: HttpService) {}

  isAvailable(): boolean {
    const { baseUrl, apiKey, privateKey, serverPublicKey, customer } = Config.bank.frick;
    return !!(baseUrl && apiKey && privateKey && serverPublicKey && customer);
  }

  async getBalances(): Promise<FrickBalance[]> {
    this.assertAvailable();

    const customer = this.validateCustomer();
    const response = await this.callApi<FrickAccountsResponse>(
      `accounts/${encodeURIComponent(customer)}`,
      'GET',
      undefined,
      'application/json',
      'json',
      true,
    );
    this.validateAccountsResponse(response);
    // Pagination is deliberately not implemented yet. Returning only the first page would understate the customer's
    // balances, so this integration fails closed until every result page can be fetched deterministically.
    if (response.moreResults) throw new Error('Incomplete Bank Frick accounts response');

    return response.accounts
      .filter((account) => account.iban)
      .map((account) => ({
        iban: this.normalizeAndValidateIban(account.iban, 'account response IBAN'),
        currency: account.currency,
        balance: account.balance,
        availableBalance: account.available,
      }));
  }

  async getFrickTransactions(lastModificationTime: Date, accountIban: string): Promise<FrickTransactionsFetchResult> {
    this.assertAvailable();
    if (!(lastModificationTime instanceof Date) || Number.isNaN(lastModificationTime.getTime()))
      throw new Error('Invalid Bank Frick transaction start date');

    const iban = this.normalizeAndValidateIban(accountIban, 'account IBAN');
    const params = new URLSearchParams({
      iban,
      // Bank Frick applies banking dates in Liechtenstein local time. Deriving both boundaries in that zone avoids
      // a one-day lag around CET/CEST midnight when the API host itself runs in UTC.
      fromDate: Util.isoDateInTimeZone('Europe/Vaduz', lastModificationTime),
      toDate: Util.isoDateInTimeZone('Europe/Vaduz'),
    });

    const statement = await this.callApi<string>(
      `camt053?${params.toString()}`,
      'GET',
      undefined,
      'application/xml',
      'text',
      true,
    );
    if (typeof statement !== 'string') throw new Error('Invalid Bank Frick camt.053 response');
    if (!statement.trim()) return { transactions: [], fullyParsed: true };

    let rejectedCount = 0;
    const transactions = Iso20022Service.parseCamt053Xml(statement, iban, true, () => {
      rejectedCount++;
    }).map((tx) => this.parseTransaction(tx, iban));

    return { transactions, fullyParsed: rejectedCount === 0 };
  }

  async createPaymentOrder(input: FrickPaymentOrderInput): Promise<FrickPaymentOrder> {
    this.assertAvailable();
    this.assertPayoutEnabled();
    const transaction = this.createTransaction(input);

    const existing = await this.getPaymentOrderOrUndefined(transaction.customId);
    if (existing) {
      this.assertSamePayment(existing, transaction);
      return existing;
    }

    const request: FrickCreateTransactionsRequest = { transactions: [transaction] };
    const response = await this.callApi<FrickTransactionsResponse>(
      'transactions',
      'PUT',
      request,
      'application/json',
      'json',
      true,
    );
    const created = this.getSinglePayment(response, transaction.customId);
    this.assertSamePayment(created, transaction);
    return created;
  }

  async getPaymentOrder(customId: string): Promise<FrickPaymentOrder> {
    this.assertAvailable();
    this.validateString(customId, 'customId', 50, true);

    const payment = await this.getPaymentOrderOrUndefined(customId);
    if (!payment) throw new FrickPaymentOrderNotFoundError(customId);
    return payment;
  }

  async approvePaymentWithoutTan(payment: FrickPaymentOrder): Promise<FrickPaymentOrder> {
    this.assertAvailable();
    this.assertPayoutEnabled();
    if (!Config.bank.frick.approveWithoutTan)
      throw new Error('Bank Frick approval without TAN is not explicitly enabled');
    const customId = payment?.customId;
    this.validateString(customId, 'customId', 50, true);

    const safeOrderId = this.getSafeOrderId(payment);
    const request: FrickApproveWithoutTanRequest = safeOrderId
      ? { orderIds: [Number(safeOrderId)] }
      : { customIds: [customId] };
    const response = await this.callApi<FrickTransactionsResponse>(
      'signTransactionWithoutTan',
      'POST',
      request,
      'application/json',
      'json',
      true,
    );
    return this.getSinglePayment(response, customId);
  }

  isVibanAvailable(): boolean {
    return this.isAvailable() && !!Config.bank.frick.vbanBaseUrl;
  }

  /** Validates and authenticates a create request without sending it to the vIBAN endpoint. */
  async prepareVibanCreate(referenceAccountIban: string, description?: string): Promise<void> {
    const request = this.buildCreateVibanRequest(referenceAccountIban, description);
    this.sign(JSON.stringify(request));
    await this.getAccessToken();
  }

  async createViban(referenceAccountIban: string, description?: string): Promise<FrickVirtualIban> {
    const request = this.buildCreateVibanRequest(referenceAccountIban, description);
    const response = await this.callVbanApi<FrickVirtualIban>(
      'virtual-ibans',
      'POST',
      request,
      'application/json',
      'json',
      true,
      true,
    );
    this.validateVirtualIbanResponse(response);
    return response;
  }

  async approveVibanActivation(vban: string): Promise<FrickVirtualIban> {
    this.assertVibanAvailable();
    this.validateString(vban, 'vban', 34, true);
    const request: FrickApproveVirtualIbanActivationRequest = { vban };
    const response = await this.callVbanApi<FrickVirtualIban>(
      'virtual-ibans/activations/approvals',
      'PUT',
      request,
      'application/json',
      'json',
      true,
      false,
    );
    this.validateVirtualIbanResponse(response);
    return response;
  }

  async getViban(vban: string): Promise<FrickVirtualIban> {
    this.assertVibanAvailable();
    this.validateString(vban, 'vban', 34, true);
    const response = await this.callVbanApi<FrickVirtualIban>(
      `virtual-ibans/${encodeURIComponent(vban)}`,
      'GET',
      undefined,
      'application/json',
      'json',
      true,
      false,
    );
    this.validateVirtualIbanResponse(response);
    return response;
  }

  async listVibans(
    referenceAccountIban: string | undefined,
    states: FrickVirtualIbanState[] | undefined,
    pageIndex: number,
    pageSize: number,
  ): Promise<FrickVirtualIbansResponse> {
    // Public contract stays a plain FrickVirtualIbansResponse; drop count is only consumed by listAllVibans.
    const { response } = await this.listVibansPage(referenceAccountIban, states, pageIndex, pageSize);
    return response;
  }

  /**
   * Deterministically traverses every page of the virtual-IBAN list. Fails closed when pagination
   * does not advance (stale pageIndex / empty raw page with hasMore), so recovery never silently
   * skips an already-issued PREPARED/ACTIVE vIBAN.
   *
   * Returns well-formed entries plus {@link FrickVirtualIbansFetchResult.fullyValidated}: false when
   * any entry was dropped by per-entry validation (foreign/malformed). Callers that treat absence
   * as proof must treat that as an incomplete listing.
   */
  async listAllVibans(
    referenceAccountIban: string | undefined,
    states: FrickVirtualIbanState[] | undefined,
    pageSize: number,
  ): Promise<FrickVirtualIbansFetchResult> {
    this.assertVibanAvailable();
    const listingStartedAt = new Date();
    const all: FrickVirtualIban[] = [];
    const seenVibans = new Set<string>();
    let expectedTotalCount: number | undefined;
    // Entries dropped locally by per-entry validation (foreign/malformed). Server totalCount still
    // includes them, so the completion invariant must discount these — otherwise one bad shared-
    // account entry would make recovery throw for every customer.
    let totalDropped = 0;
    let pageIndex = 0;
    const maxPages = 10_000;

    while (pageIndex < maxPages) {
      // Thread drop count via private page helper so listVibans's public return type stays unchanged.
      const { response: page, droppedCount } = await this.listVibansPage(
        referenceAccountIban,
        states,
        pageIndex,
        pageSize,
      );
      totalDropped += droppedCount;
      if (page.pagination.pageIndex !== pageIndex)
        throw new Error(
          `Bank Frick virtual IBAN listing returned unexpected pageIndex ${page.pagination.pageIndex} (expected ${pageIndex})`,
        );
      expectedTotalCount ??= page.pagination.totalCount;
      if (page.pagination.totalCount !== expectedTotalCount)
        throw new Error('Bank Frick virtual IBAN listing changed totalCount during pagination');

      // page.virtualIbans is already post-filter (validateVirtualIbansResponse drops invalids in
      // place). Reconstruct the server's raw entry count so an all-foreign page (every entry
      // dropped while hasMore is still true) is not misread as a structural pagination gap.
      const rawEntryCount = page.virtualIbans.length + droppedCount;
      if (page.pagination.hasMore && rawEntryCount === 0)
        throw new Error('Bank Frick virtual IBAN listing reported more pages but returned no raw items');

      for (const virtualIban of page.virtualIbans) {
        if (seenVibans.has(virtualIban.vban))
          throw new Error('Bank Frick virtual IBAN listing returned a duplicate item across pages');
        seenVibans.add(virtualIban.vban);
        all.push(virtualIban);
      }

      if (!page.pagination.hasMore) {
        if (all.length + totalDropped !== expectedTotalCount)
          throw new Error(
            `Bank Frick virtual IBAN listing returned ${all.length} of ${expectedTotalCount} items` +
              ` (${totalDropped} dropped as invalid)`,
          );
        return {
          virtualIbans: all,
          fullyValidated: totalDropped === 0,
          listingStartedAt,
          listingCompletedAt: new Date(),
        };
      }
      pageIndex += 1;
    }

    throw new Error('Bank Frick virtual IBAN listing exceeded maximum page count');
  }

  /**
   * Fetches one virtual-IBAN list page and applies envelope + per-entry validation.
   * Returns how many entries were dropped locally so listAllVibans can reconcile server totalCount.
   */
  private async listVibansPage(
    referenceAccountIban: string | undefined,
    states: FrickVirtualIbanState[] | undefined,
    pageIndex: number,
    pageSize: number,
  ): Promise<{ response: FrickVirtualIbansResponse; droppedCount: number }> {
    this.assertVibanAvailable();
    if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error('Invalid Bank Frick virtual IBAN pageIndex');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200)
      throw new Error('Invalid Bank Frick virtual IBAN pageSize');

    const params = new URLSearchParams();
    if (referenceAccountIban)
      params.append('account', this.normalizeAndValidateIban(referenceAccountIban, 'reference account IBAN filter'));
    if (states) for (const state of states) params.append('state', state);
    params.append('pageIndex', String(pageIndex));
    params.append('pageSize', String(pageSize));
    const query = params.toString();

    const response = await this.callVbanApi<FrickVirtualIbansResponse>(
      `virtual-ibans?${query}`,
      'GET',
      undefined,
      'application/json',
      'json',
      true,
      false,
    );
    const droppedCount = this.validateVirtualIbansResponse(response);
    return { response, droppedCount };
  }

  getSafeOrderId(payment: FrickPaymentOrder): string | undefined {
    return Number.isSafeInteger(payment.orderId) && payment.orderId > 0 ? payment.orderId.toString() : undefined;
  }

  private parseTransaction(tx: CamtTransaction, accountIban: string): Partial<BankTx> {
    return {
      accountServiceRef: `FRICK-${Util.createHash(`${accountIban}:${tx.accountServiceRef}`, 'sha256', 'hex')}`,
      bookingDate: tx.bookingDate,
      valueDate: tx.valueDate,
      txCount: 1,
      txId: tx.accountServiceRef,
      amount: tx.amount,
      instructedAmount: tx.instructedAmount ?? tx.amount,
      txAmount: tx.txAmount ?? tx.amount,
      // Real, parsed Ntry/Chrgs total (0 only when the entry genuinely carries no charge) - a booked
      // debit that included a bank charge must reconcile net of it, not against the full booked amount.
      chargeAmount: tx.chargeAmount,
      currency: tx.currency,
      instructedCurrency: tx.instructedCurrency ?? tx.currency,
      txCurrency: tx.txCurrency ?? tx.currency,
      chargeCurrency: tx.chargeCurrency,
      creditDebitIndicator:
        tx.creditDebitIndicator === BankTxIndicator.CREDIT ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
      iban: tx.iban,
      bic: tx.bic,
      name: tx.name,
      addressLine1: tx.addressLine1,
      addressLine2: tx.addressLine2,
      country: tx.country,
      ultimateName: tx.ultimateName,
      ultimateAddressLine1: tx.ultimateAddressLine1,
      ultimateAddressLine2: tx.ultimateAddressLine2,
      ultimateCountry: tx.ultimateCountry,
      remittanceInfo: tx.remittanceInfo,
      endToEndId: tx.endToEndId,
      accountIban,
      domainCode: tx.domainCode,
      familyCode: tx.familyCode,
      subFamilyCode: tx.subFamilyCode,
      type: null,
    };
  }

  private createTransaction(input: FrickPaymentOrderInput): FrickCreateTransaction {
    this.validateString(input.customId, 'customId', 50, true);
    this.validateAmount(input.amount);
    if (!['CHF', 'EUR'].includes(input.currency)) throw new Error(`Unsupported Bank Frick currency: ${input.currency}`);

    const debtorIban = this.normalizeAndValidateIban(input.debtorIban, 'debtor IBAN');
    const creditor = this.validateCreditor(input.creditor);
    const reference = input.reference?.trim();
    if (reference) this.validateString(reference, 'reference', 140, false);

    if (input.currency === 'EUR') {
      if (!IbanTools.isSEPACountry(creditor.iban.substring(0, 2)))
        throw new Error('Bank Frick EUR payout requires a SEPA creditor IBAN');
      const type = input.instant ? FrickPaymentType.SEPA_INSTANT : FrickPaymentType.SEPA;
      return {
        customId: input.customId,
        type,
        amount: input.amount,
        currency: input.currency,
        ...(!input.instant && { express: false }),
        ...(reference && { reference }),
        debitor: { iban: debtorIban },
        creditor: { name: creditor.name, iban: creditor.iban },
      };
    }

    if (input.instant) throw new Error('Bank Frick instant payments are only supported for EUR');

    if (!creditor.bic) throw new Error('Bank Frick FOREIGN payment requires creditor BIC');
    if (!input.charge || !Object.values(FrickPaymentCharge).includes(input.charge))
      throw new Error('Bank Frick FOREIGN payment requires a valid charge');

    return {
      customId: input.customId,
      type: FrickPaymentType.FOREIGN,
      amount: input.amount,
      currency: input.currency,
      express: false,
      ...(reference && { reference }),
      charge: input.charge,
      debitor: { iban: debtorIban },
      creditor,
    };
  }

  private validateCreditor(account: FrickPaymentAccount): FrickPaymentAccount {
    if (!account || typeof account !== 'object') throw new Error('Bank Frick creditor is required');

    const name = account.name?.trim();
    this.validateString(name, 'creditor name', 35, true);
    const iban = this.normalizeAndValidateIban(account.iban, 'creditor IBAN');

    const address = account.address?.trim();
    const postalcode = account.postalcode?.trim();
    const city = account.city?.trim();
    const country = account.country?.trim();
    const bic = account.bic?.replace(/\s/g, '').toUpperCase();
    const creditInstitution = account.creditInstitution?.trim();

    if (address) this.validateString(address, 'creditor address', 70, false);
    if (postalcode) this.validateString(postalcode, 'creditor postal code', 11, false);
    if (city) this.validateString(city, 'creditor city', 70, false);
    if (country) this.validateString(country, 'creditor country', 70, false);
    if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) throw new Error('Invalid creditor BIC');
    if (creditInstitution) this.validateString(creditInstitution, 'credit institution', 50, false);

    return {
      name,
      iban,
      ...(address && { address }),
      ...(postalcode && { postalcode }),
      ...(city && { city }),
      ...(country && { country }),
      ...(bic && { bic }),
      ...(creditInstitution && { creditInstitution }),
    };
  }

  private validateAmount(amount: number): void {
    const cents = amount * 100;
    if (
      !Number.isFinite(amount) ||
      amount < 0.01 ||
      amount > 999_999_999_999.99 ||
      Math.abs(cents - Math.round(cents)) > Number.EPSILON * Math.max(1, Math.abs(cents)) * 2
    )
      throw new Error('Invalid Bank Frick payment amount');
  }

  private validateString(value: unknown, field: string, maxLength: number, required: boolean): void {
    if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`Invalid Bank Frick ${field}`);
    if (value.length > maxLength) throw new Error(`Bank Frick ${field} exceeds ${maxLength} characters`);
  }

  private normalizeAndValidateIban(value: string | undefined, field: string): string {
    if (typeof value !== 'string') throw new Error(`Invalid Bank Frick ${field}`);
    const iban = value.replace(/\s/g, '').toUpperCase();
    if (iban.length > 34 || !IbanTools.validateIBAN(iban).valid) throw new Error(`Invalid Bank Frick ${field}`);
    return iban;
  }

  private async getPaymentOrderOrUndefined(customId: string): Promise<FrickPaymentOrder | undefined> {
    const active = await this.getFilteredPaymentOrder(
      new URLSearchParams({ customId, fromDate: BankFrickService.EARLIEST_FROM_DATE }),
      customId,
    );
    if (active) return active;

    // BOOKED orders are deliberately excluded from Bank Frick's default transaction search. Query them
    // explicitly as well so a process crash after a successful PUT can never make the retry create a second
    // payout.
    return this.getFilteredPaymentOrder(
      new URLSearchParams({
        customId,
        status: FrickPaymentState.BOOKED,
        fromDate: BankFrickService.EARLIEST_FROM_DATE,
      }),
      customId,
    );
  }

  private async getFilteredPaymentOrder(
    params: URLSearchParams,
    customId: string,
  ): Promise<FrickPaymentOrder | undefined> {
    const response = await this.callApi<FrickTransactionsResponse>(
      `transactions?${params.toString()}`,
      'GET',
      undefined,
      'application/json',
      'json',
      true,
    );
    // This lookup is already scoped to customId by the request itself (the ?customId= query param).
    // Bank Frick's real BOOKED transaction objects carry neither customId nor type - requiring them
    // here would make every settled payout throw and never reach a terminal state. Trust the filter:
    // customId/type are validated when present, but their absence is not itself an error.
    // Empty lookup results are accepted only via an explicit whitelist of empty encodings (fully
    // empty body, or an object whose sole keys are the three known result fields in empty states).
    // Unknown keys, wrapper shapes, and bare arrays are not treated as empty and therefore fall
    // through to the strict validation below, so a schema shift can never be misread as "no
    // existing order" on the payout path.
    if (this.isEmptyTransactionsResponse(response)) return undefined;
    this.validateTransactionsResponse(response, false);

    if (response.moreResults) throw new Error(`Ambiguous Bank Frick payment lookup for ${customId}`);
    if (response.transactions.some((payment) => payment.customId !== undefined && payment.customId !== customId))
      throw new Error(`Invalid Bank Frick payment lookup response for ${customId}`);
    if (response.transactions.length > 1) throw new Error(`Duplicate Bank Frick payment orders for ${customId}`);
    return response.transactions[0];
  }

  private getSinglePayment(response: FrickTransactionsResponse, customId: string): FrickPaymentOrder {
    // Unlike the filtered lookup above, this reads the response to a PUT/signTransactionWithoutTan
    // request DFX itself just issued for this exact customId - Bank Frick returns type/customId here,
    // so the stricter shape stays required as a defense against a malformed or mismatched response.
    this.validateTransactionsResponse(response, true);
    if (response.moreResults) throw new Error(`Ambiguous Bank Frick payment response for ${customId}`);

    const matches = response.transactions.filter((payment) => payment.customId === customId);
    if (matches.length !== 1) throw new Error(`Invalid Bank Frick payment response for ${customId}`);
    return matches[0];
  }

  private isEmptyTransactionsResponse(response: unknown): boolean {
    // Only the exact empty encodings we accept on purpose: an entirely empty body, or an object
    // consisting solely of the three known result fields in their empty states. Any unknown key,
    // array response, or wrapper shape must keep failing loud through the strict validation so a
    // schema shift can never be misread as "no existing order" on the payout path.
    if (response === undefined || response === null || response === '') return true;
    if (typeof response !== 'object' || Array.isArray(response)) return false;

    const body = response as Record<string, unknown>;
    const knownKeys = ['transactions', 'resultSetSize', 'moreResults'];
    if (!Object.keys(body).every((key) => knownKeys.includes(key))) return false;

    const emptyTransactions =
      body.transactions === undefined ||
      body.transactions === null ||
      (Array.isArray(body.transactions) && body.transactions.length === 0);
    const emptyResultSetSize =
      body.resultSetSize === undefined || body.resultSetSize === null || body.resultSetSize === 0;
    const emptyMoreResults = body.moreResults === undefined || body.moreResults === null || body.moreResults === false;

    return emptyTransactions && emptyResultSetSize && emptyMoreResults;
  }

  private describeTransactionsResponseShape(response: unknown): string {
    if (response === null || typeof response !== 'object') return `typeof=${typeof response}`;

    const body = response as Record<string, unknown>;
    // key names are schema metadata needed for diagnosis; values are never printed except the two
    // numeric/boolean counters
    const allKeys = Object.keys(body);
    const shownKeys = allKeys.slice(0, 10).map((key) => (key.length > 24 ? key.slice(0, 24) : key));
    const overflow = allKeys.length - shownKeys.length;
    const keys = overflow > 0 ? `${shownKeys.join(', ')}, +${overflow} more` : shownKeys.join(', ');

    const moreResultsDesc =
      typeof body.moreResults === 'boolean' ? String(body.moreResults) : `typeof ${typeof body.moreResults}`;
    const resultSetSizeDesc =
      typeof body.resultSetSize === 'number' ? String(body.resultSetSize) : `typeof ${typeof body.resultSetSize}`;

    const transactions = body.transactions;
    let transactionsDesc: string;
    if (transactions === undefined || transactions === null) {
      transactionsDesc = 'missing';
    } else if (Array.isArray(transactions)) {
      transactionsDesc = `array(${transactions.length})`;
    } else {
      transactionsDesc = `typeof ${typeof transactions}`;
    }

    return (
      `keys: [${keys}], moreResults=${moreResultsDesc}, resultSetSize=${resultSetSizeDesc}, ` +
      `transactions=${transactionsDesc}`
    );
  }

  private validateTransactionsResponse(response: FrickTransactionsResponse, requireTypeAndCustomId: boolean): void {
    if (
      !response ||
      typeof response !== 'object' ||
      typeof response.moreResults !== 'boolean' ||
      !Number.isInteger(response.resultSetSize) ||
      !Array.isArray(response.transactions) ||
      response.resultSetSize !== response.transactions.length
    )
      throw new Error(`Invalid Bank Frick transactions response (${this.describeTransactionsResponseShape(response)})`);

    for (const payment of response.transactions) {
      const hasValidCustomId =
        typeof payment?.customId === 'string' || (!requireTypeAndCustomId && payment?.customId === undefined);
      const hasValidType =
        Object.values(FrickPaymentType).includes(payment?.type) ||
        (!requireTypeAndCustomId && payment?.type === undefined);

      if (
        !payment ||
        typeof payment !== 'object' ||
        !hasValidCustomId ||
        !hasValidType ||
        !Object.values(FrickPaymentState).includes(payment.state) ||
        typeof payment.currency !== 'string' ||
        !payment.debitor ||
        !payment.creditor
      )
        throw new Error('Invalid Bank Frick payment order response');

      if (
        payment.orderId !== undefined &&
        (typeof payment.orderId !== 'number' || !Number.isInteger(payment.orderId) || payment.orderId <= 0)
      )
        throw new Error('Invalid Bank Frick orderId response');
      this.parseResponseAmount(payment.amount);
    }
  }

  private validateAccountsResponse(response: FrickAccountsResponse): void {
    if (
      !response ||
      typeof response !== 'object' ||
      typeof response.date !== 'string' ||
      typeof response.moreResults !== 'boolean' ||
      !Number.isInteger(response.resultSetSize) ||
      !Array.isArray(response.accounts) ||
      response.resultSetSize !== response.accounts.length
    )
      throw new Error('Invalid Bank Frick accounts response');

    for (const account of response.accounts) {
      if (
        !account ||
        typeof account.account !== 'string' ||
        typeof account.type !== 'string' ||
        typeof account.customer !== 'string' ||
        typeof account.currency !== 'string' ||
        !Number.isFinite(account.balance) ||
        (account.available !== undefined && !Number.isFinite(account.available)) ||
        (account.iban !== undefined && typeof account.iban !== 'string')
      )
        throw new Error('Invalid Bank Frick account response');
    }
  }

  private assertSamePayment(existing: FrickPaymentOrder, requested: FrickCreateTransaction): void {
    const existingAmount = this.parseResponseAmount(existing.amount);
    const same =
      // A BOOKED order returned by the customId-scoped lookup carries neither field (see
      // getFilteredPaymentOrder's "trust the filter" comment) - their absence was already verified
      // against the request there and is not itself a mismatch here.
      (existing.customId === undefined || existing.customId === requested.customId) &&
      (existing.type === undefined || existing.type === requested.type) &&
      existing.currency === requested.currency &&
      Math.abs(existingAmount - requested.amount) < 0.005 &&
      existing.debitor?.iban?.replace(/\s/g, '').toUpperCase() === requested.debitor.iban &&
      existing.creditor?.iban?.replace(/\s/g, '').toUpperCase() === requested.creditor.iban &&
      existing.creditor?.name?.trim() === requested.creditor.name &&
      (existing.reference?.trim() ?? '') === (requested.reference ?? '') &&
      this.matchesSentValue(existing.express, requested.express) &&
      this.matchesSentValue(existing.charge, requested.charge) &&
      this.matchesSentString(existing.creditor.address, requested.creditor.address) &&
      this.matchesSentString(existing.creditor.postalcode, requested.creditor.postalcode) &&
      this.matchesSentString(existing.creditor.city, requested.creditor.city) &&
      this.matchesSentString(existing.creditor.country, requested.creditor.country) &&
      this.matchesSentString(
        existing.creditor.creditInstitution ?? existing.creditor.creditInsitution,
        requested.creditor.creditInstitution,
      ) &&
      this.matchesSentString(existing.creditor.bic, requested.creditor.bic, (value) => {
        const bic = value.replace(/\s/g, '').toUpperCase();
        return bic.length === 8 ? bic.padEnd(11, 'X') : bic;
      });

    if (!same) throw new Error(`Bank Frick customId collision for ${requested.customId}`);
  }

  private matchesSentString(
    existing: string | undefined,
    requested: string | undefined,
    normalize: (value: string) => string = (value) => value.trim(),
  ): boolean {
    return requested === undefined || (typeof existing === 'string' && normalize(existing) === normalize(requested));
  }

  private matchesSentValue<T>(existing: T | undefined, requested: T | undefined): boolean {
    return requested === undefined || existing === requested;
  }

  private parseResponseAmount(value: number | string): number {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
    if (typeof value !== 'string') throw new Error('Invalid Bank Frick payment amount response');

    const normalized = /^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(value) ? value.replace(/\./g, '').replace(',', '.') : value;
    if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Invalid Bank Frick payment amount response');
    const amount = Math.abs(Number(normalized));
    if (!Number.isFinite(amount)) throw new Error('Invalid Bank Frick payment amount response');
    return amount;
  }

  private async requestSigned<T>(
    url: string,
    path: string,
    method: Method,
    body: unknown,
    accept: string,
    responseType: FrickResponseType,
    allowUnauthorizedRetry: boolean,
    classifyVibanCreateFailure: boolean,
  ): Promise<T> {
    this.assertAvailable();
    let token: string;
    let bodyString: string;
    let signature: string;
    try {
      token = await this.getAccessToken();
      bodyString = body === undefined ? '' : JSON.stringify(body);
      signature = this.sign(bodyString);
    } catch (error) {
      if (classifyVibanCreateFailure)
        throw new FrickVibanNotCreatedError(
          `Bank Frick API request failed (${method} ${this.sanitizeApiPathForError(path)}): pre-dispatch setup failed`,
        );
      throw error;
    }

    try {
      return await this.http.request<T>({
        url,
        method,
        data: bodyString,
        responseType,
        tryCount: 1,
        timeout: BankFrickService.HTTP_TIMEOUT_MS,
        headers: {
          Accept: accept,
          'Content-Type': body === undefined ? '*/*' : 'application/json',
          Authorization: `Bearer ${token}`,
          Signature: signature,
          algorithm: 'rsa-sha512',
        },
        responseVerifier: (rawBody, headers, status) => this.verifyResponse(rawBody, headers, status),
      });
    } catch (error) {
      if (error instanceof FrickSignatureVerificationError)
        throw new Error(
          `Bank Frick response signature verification failed (${method} ${this.sanitizeApiPathForError(path)}): ${error.message}`,
        );

      if (allowUnauthorizedRetry && error?.response?.status === 401) {
        try {
          await this.refreshAfterUnauthorized(token);
        } catch (refreshError) {
          if (classifyVibanCreateFailure)
            throw new FrickVibanNotCreatedError(
              `Bank Frick API request failed (${method} ${this.sanitizeApiPathForError(path)}): authorization refresh failed before retry`,
            );
          throw refreshError;
        }
        return this.requestSigned(url, path, method, body, accept, responseType, false, classifyVibanCreateFailure);
      }

      const message = `Bank Frick API request failed (${method} ${this.sanitizeApiPathForError(path)}): ${this.getHttpFailureReason(error)}`;
      if (classifyVibanCreateFailure && this.isDefinitelyNotProcessed(error))
        throw new FrickVibanNotCreatedError(message);
      throw new Error(message);
    }
  }

  private async callApi<T>(
    path: string,
    method: Method,
    body: unknown,
    accept: string,
    responseType: FrickResponseType,
    allowUnauthorizedRetry: boolean,
  ): Promise<T> {
    this.assertAvailable();
    return this.requestSigned<T>(
      this.createUrl(path),
      path,
      method,
      body,
      accept,
      responseType,
      allowUnauthorizedRetry,
      false,
    );
  }

  private async callVbanApi<T>(
    path: string,
    method: Method,
    body: unknown,
    accept: string,
    responseType: FrickResponseType,
    allowUnauthorizedRetry: boolean,
    classifyVibanCreateFailure: boolean,
  ): Promise<T> {
    this.assertVibanAvailable();
    return this.requestSigned<T>(
      this.createVbanUrl(path),
      path,
      method,
      body,
      accept,
      responseType,
      allowUnauthorizedRetry,
      classifyVibanCreateFailure,
    );
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() + BankFrickService.TOKEN_REFRESH_SKEW_MS < this.tokenExpiryMs)
      return this.accessToken;

    if (!this.authorizeInFlight) {
      this.authorizeInFlight = this.authorize().finally(() => {
        this.authorizeInFlight = undefined;
      });
    }
    return this.authorizeInFlight;
  }

  private async refreshAfterUnauthorized(rejectedToken: string): Promise<void> {
    if (this.accessToken === rejectedToken) {
      this.accessToken = undefined;
      this.tokenExpiryMs = 0;
    }
    await this.getAccessToken();
  }

  private async authorize(): Promise<string> {
    this.assertAvailable();
    const request: FrickAuthorizeRequest = { key: Config.bank.frick.apiKey };
    const bodyString = JSON.stringify(request);

    let response: FrickAuthorizeResponse;
    try {
      response = await this.http.request<FrickAuthorizeResponse>({
        url: this.createUrl('authorize'),
        method: 'POST',
        data: bodyString,
        responseType: 'json',
        tryCount: 1,
        timeout: BankFrickService.HTTP_TIMEOUT_MS,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Signature: this.sign(bodyString),
          algorithm: 'rsa-sha512',
        },
        responseVerifier: (rawBody, headers, status) => this.verifyResponse(rawBody, headers, status),
      });
    } catch (error) {
      if (error instanceof FrickSignatureVerificationError)
        throw new Error(`Bank Frick authorization response signature verification failed: ${error.message}`);

      throw new Error(`Bank Frick authorization failed: ${this.getHttpFailureReason(error)}`);
    }

    if (!response || typeof response.token !== 'string' || !response.token) {
      throw new Error('Invalid Bank Frick authorization response');
    }

    this.accessToken = response.token;
    this.tokenExpiryMs = this.getTokenExpiry(response.token);
    return response.token;
  }

  private getTokenExpiry(token: string): number {
    try {
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) throw new Error('invalid JWT structure');
      if (tokenParts.some((part) => !part)) throw new Error('empty JWT segment');
      const payloadPart = tokenParts[1];
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { exp?: unknown };
      if (payload.exp === undefined) return Number.POSITIVE_INFINITY;
      if (typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= 0)
        throw new Error('invalid expiry');
      const expiryMs = payload.exp * 1000;
      if (!Number.isSafeInteger(expiryMs)) throw new Error('invalid expiry');
      return expiryMs;
    } catch {
      throw new Error('Invalid Bank Frick JWT');
    }
  }

  private sign(bodyString: string): string {
    try {
      return Util.createSign(bodyString, Config.bank.frick.privateKey, 'sha512', 'base64');
    } catch {
      throw new Error('Invalid Bank Frick signing configuration');
    }
  }

  private verifyResponse(rawBody: Buffer, headers: AxiosResponse['headers'], status?: number): void {
    const signature = headers?.signature ?? headers?.Signature;
    const algorithm = String(headers?.algorithm ?? headers?.Algorithm ?? '').toLowerCase();
    const algorithms = { 'rsa-sha512': 'sha512', 'rsa-sha384': 'sha384', 'rsa-sha256': 'sha256' } as const;
    const hashAlgorithm = algorithms[algorithm as keyof typeof algorithms];
    const signaturePresent = typeof signature === 'string' && !!signature;
    if (!signaturePresent || !hashAlgorithm)
      throw new FrickSignatureVerificationError(
        `Invalid Bank Frick response signature headers${this.describeVerificationContext(status, [
          `signature ${signaturePresent ? 'present' : 'missing'}`,
          `algorithm ${!algorithm ? 'missing' : hashAlgorithm ? 'ok' : 'unsupported'}`,
        ])}`,
      );

    try {
      if (!Util.verifySign(rawBody, Config.bank.frick.serverPublicKey, signature, hashAlgorithm, 'base64'))
        throw new Error('signature mismatch');
    } catch {
      throw new FrickSignatureVerificationError(
        `Invalid Bank Frick response signature${this.describeVerificationContext(status)}`,
      );
    }
  }

  /**
   * Builds the parenthesised diagnostic tail of a signature-verification error.
   *
   * A rejected response is the one case where the caller never gets to see the underlying axios
   * error, so without this the log line cannot tell an unsigned success from an unsigned upstream
   * failure - the two demand opposite responses (our key/config vs. their outage). Everything here
   * is drawn from a closed vocabulary: a bounded status integer and fixed classification words.
   * Header *values* are deliberately never echoed - they are attacker-influenced bytes, and this
   * string reaches server logs, alert mail and persisted intent/event error fields.
   */
  private describeVerificationContext(status?: number, details: string[] = []): string {
    const parts = [
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? [`HTTP ${status}`] : []),
      ...details,
    ];

    return parts.length ? ` (${parts.join(', ')})` : '';
  }

  private createUrl(path: string): string {
    return `${Config.bank.frick.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  private createVbanUrl(path: string): string {
    return `${Config.bank.frick.vbanBaseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  private getHttpFailureReason(error: any): string {
    const status = error?.response?.status;
    if (Number.isInteger(status) && status >= 100 && status <= 599) return `HTTP ${status}`;

    // Never propagate an arbitrary upstream message: it can contain serialized request data, including
    // the API key used by /authorize. Axios transport codes are bounded and contain no request payload.
    const code = error?.code;
    return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'request failed';
  }

  /**
   * Strips account numbers / IBANs from API path strings before they enter thrown Error messages
   * (which can reach server logs, alert mail, and persisted intent/event error fields).
   * Keeps method-level diagnostic shape (endpoint + safe query keys) without the values.
   */
  private sanitizeApiPathForError(path: string): string {
    const qIdx = path.indexOf('?');
    const pathname = qIdx >= 0 ? path.slice(0, qIdx) : path;
    const query = qIdx >= 0 ? path.slice(qIdx + 1) : undefined;

    // Path segments that look like IBANs (country code + check digits + BBAN body, total 15–34).
    const safePath = pathname.replace(/\/([A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30})(?=\/|$)/g, '/[redacted]');

    if (!query) return safePath;

    const params = new URLSearchParams(query);
    const parts: string[] = [];
    for (const [key, value] of params.entries()) {
      const lower = key.toLowerCase();
      if (lower === 'account' || lower === 'iban') {
        parts.push(`${key}=[redacted]`);
      } else if (/^[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30}$/.test(value.replace(/\s/g, ''))) {
        parts.push(`${key}=[redacted]`);
      } else {
        parts.push(`${key}=${value}`);
      }
    }
    return `${safePath}?${parts.join('&')}`;
  }

  private isDefinitelyNotProcessed(error: unknown): boolean {
    const axiosError = error as Partial<AxiosError>;
    const status = axiosError.response?.status;
    // A concrete client-error response rejects the create operation. HTTP 408 remains ambiguous:
    // the upstream may have completed the operation while the request timed out.
    if (Number.isInteger(status) && status >= 400 && status < 500 && status !== 408) return true;

    // These transport outcomes happen before an HTTP request can reach Bank Frick. Timeouts and
    // connection resets are intentionally excluded because their wire outcome is ambiguous.
    if (
      typeof axiosError.code === 'string' &&
      ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_INVALID_URL'].includes(axiosError.code)
    )
      return true;

    // Axios setup failures without a request object are also provably pre-send. Requiring the Axios
    // marker avoids misclassifying post-response parsing/verifier errors that have no request field.
    const hasNoRequest = axiosError.request === undefined || axiosError.request === null;
    const hasNoResponse = axiosError.response === undefined || axiosError.response === null;
    return axiosError.isAxiosError === true && hasNoRequest && hasNoResponse;
  }

  private validateCustomer(): string {
    const customer = Config.bank.frick.customer;
    // Bank Frick's OpenAPI bounds the {customer} path segment to at most 7 digits (([0-9]{0,7})?).
    // Enforcing that here makes a misconfigured customer fail closed at the config check instead of
    // silently sending a path segment the API would reject.
    if (typeof customer !== 'string' || !/^\d{1,7}$/.test(customer))
      throw new Error('Invalid Bank Frick customer configuration');
    return customer;
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) throw new Error('Bank Frick is not configured');
  }

  private assertVibanAvailable(): void {
    if (!this.isVibanAvailable()) throw new Error('Bank Frick virtual IBAN is not configured');
  }

  private buildCreateVibanRequest(referenceAccountIban: string, description?: string): FrickCreateVirtualIbanRequest {
    this.assertVibanAvailable();
    const iban = this.normalizeAndValidateIban(referenceAccountIban, 'reference account IBAN');
    if (description !== undefined) this.validateString(description, 'description', 140, true);
    return {
      referenceAccountIban: iban,
      ...(description !== undefined && { description }),
    };
  }

  private validateVirtualIbanResponse(r: FrickVirtualIban): void {
    if (
      !r ||
      typeof r !== 'object' ||
      typeof r.vban !== 'string' ||
      !r.vban.trim() ||
      !Object.values(FrickVirtualIbanState).includes(r.state) ||
      typeof r.referenceAccountIban !== 'string' ||
      typeof r.createdAt !== 'string' ||
      typeof r.createdBy !== 'string' ||
      !Array.isArray(r.activationApprovals) ||
      !Array.isArray(r.deactivationApprovals)
    )
      throw new Error('Invalid Bank Frick virtual IBAN response');

    r.vban = this.normalizeAndValidateIban(r.vban, 'virtual IBAN');
    r.referenceAccountIban = this.normalizeAndValidateIban(r.referenceAccountIban, 'reference account IBAN');
    // JSON null means "no description" (same as omitted). Only validate when a real value is present.
    if (r.description !== undefined && r.description !== null)
      this.validateString(r.description, 'description', 140, false);
  }

  /** @returns Number of entries dropped from `r.virtualIbans` in this call (never rejects the list for those). */
  private validateVirtualIbansResponse(r: FrickVirtualIbansResponse): number {
    if (
      !r ||
      typeof r !== 'object' ||
      !r.pagination ||
      typeof r.pagination.hasMore !== 'boolean' ||
      !Number.isInteger(r.pagination.pageIndex) ||
      r.pagination.pageIndex < 0 ||
      !Number.isInteger(r.pagination.pageSize) ||
      r.pagination.pageSize < 1 ||
      !Number.isInteger(r.pagination.totalCount) ||
      r.pagination.totalCount < 0 ||
      !Array.isArray(r.virtualIbans)
    )
      throw new Error('Invalid Bank Frick virtual IBANs response');

    // Drop malformed individual entries rather than rejecting the whole list. Foreign vIBANs on the
    // same reference account (not created by DFX) may fail strict validation; recovery only needs
    // well-formed entries that can match our own description/referenceAccountIban filters.
    // Count is logged (PII-free); listAllVibans surfaces fullyValidated=false so callers that treat
    // absence as proof do not act on an incomplete listing.
    const originalCount = r.virtualIbans.length;
    r.virtualIbans = r.virtualIbans.filter((virtualIban) => {
      try {
        this.validateVirtualIbanResponse(virtualIban);
        return true;
      } catch {
        // Intentional per-entry drop: list recovery must not fail closed on one foreign bad entry.
        return false;
      }
    });
    const droppedCount = originalCount - r.virtualIbans.length;
    if (droppedCount > 0) {
      this.logger.info(
        `Bank Frick virtual IBAN list page dropped ${droppedCount} entr(ies) failing per-entry validation`,
      );
    }
    return droppedCount;
  }

  private assertPayoutEnabled(): void {
    if (!Config.bank.frick.payoutEnabled) throw new Error('Bank Frick payout is not explicitly enabled');
  }
}
