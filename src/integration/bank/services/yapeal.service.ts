import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import * as https from 'https';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import {
  VibanListResponse,
  VibanProposalResponse,
  VibanReserveRequest,
  VibanReserveResponse,
  YapealAccountsResponse,
  YapealAccountStatus,
  YapealPaymentStatusResponse,
  YapealSubscription,
  YapealSubscriptionFormat,
  YapealSubscriptionRequest,
} from '../dto/yapeal.dto';
import { CamtTransaction, Pain001Payment, Iso20022Service } from './iso20022.service';

export interface YapealBalanceInfo {
  iban: string;
  currency: string;
  availableBalance: number;
  totalBalance: number;
}

@Injectable()
export class YapealService {
  private readonly logger = new DfxLogger(YapealService);

  constructor(private readonly http: HttpService) {}

  isAvailable(): boolean {
    const { baseUrl, apiKey, partnershipUid } = Config.bank.yapeal;
    return !!(baseUrl && apiKey && partnershipUid);
  }

  // --- VIBAN METHODS --- //

  async createViban(baseAccountIban: string): Promise<VibanReserveResponse> {
    const proposal = await this.getVibanProposal();
    return this.reserveViban(proposal.bban, baseAccountIban);
  }

  async listVibans(accountUid: string, count = 100, offset = 0): Promise<VibanListResponse> {
    return this.callApi<VibanListResponse>(
      `b2b/v2/cash-accounts/${accountUid}/vibans?count=${count}&offset=${offset}`,
      'GET',
    );
  }

  private async getVibanProposal(): Promise<VibanProposalResponse> {
    const { partnershipUid } = Config.bank.yapeal;
    return this.callApi<VibanProposalResponse>(`b2b/v2/partnerships/${partnershipUid}/viban/proposal`, 'GET');
  }

  private async reserveViban(bban: string, baseAccountIban: string): Promise<VibanReserveResponse> {
    const { partnershipUid } = Config.bank.yapeal;

    const request: VibanReserveRequest = {
      baseAccountIBAN: baseAccountIban,
      bban,
    };

    return this.callApi<VibanReserveResponse>(
      `b2b/v2/partnerships/${partnershipUid}/cash-accounts/viban/reserve`,
      'POST',
      request,
    );
  }

  // --- TRANSACTION POLLING --- //

  async getYapealTransactions(lastModificationTime: string, accountIban: string): Promise<Partial<BankTx>[]> {
    if (!this.isAvailable()) return [];

    try {
      const fromDate = new Date(lastModificationTime);
      const toDate = new Date();

      const response = await this.getAccountStatement(accountIban, fromDate, toDate);
      if (!response) return [];

      // Yapeal CAMT-053 API returns JSON (not XML!) with BkToCstmrStmt structure
      const transactions = this.parseCamtJson(response, accountIban);
      return transactions.map((t) => this.parseTransaction(t, accountIban));
    } catch (e) {
      this.logger.error(`Failed to get Yapeal transactions for ${accountIban}:`, e);
      return [];
    }
  }

  private parseCamtJson(response: any, accountIban: string): CamtTransaction[] {
    const transactions: CamtTransaction[] = [];

    try {
      // Navigate JSON structure: BkToCstmrStmt.Stmt[].Ntry[]
      const stmt = response?.BkToCstmrStmt?.Stmt;
      if (!stmt) return [];

      const statements = Array.isArray(stmt) ? stmt : [stmt];

      for (const statement of statements) {
        const entries = statement?.Ntry;
        if (!entries) continue;

        const entryList = Array.isArray(entries) ? entries : [entries];

        for (const entry of entryList) {
          const tx = this.parseCamtEntry(entry, accountIban);
          if (tx) transactions.push(tx);
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to parse CAMT JSON for ${accountIban}:`, e);
    }

    return transactions;
  }

  private parseCamtEntry(entry: any, accountIban: string): CamtTransaction | null {
    try {
      const creditDebitIndicator = entry?.CdtDbtInd as 'CRDT' | 'DBIT';
      if (!creditDebitIndicator) return null;

      // Amount
      const amt = entry?.Amt;
      const amount = amt ? parseFloat(amt['#text'] ?? amt.value ?? amt) : 0;
      const currency = amt?.Ccy ?? 'CHF';

      // Dates
      const bookingDate = entry?.BookgDt?.Dt ? new Date(entry.BookgDt.Dt) : new Date();
      const valueDate = entry?.ValDt?.Dt ? new Date(entry.ValDt.Dt) : bookingDate;

      // Reference - use AcctSvcrRef or generate unique ID
      const accountServiceRef = entry?.AcctSvcrRef || Util.createUniqueId(accountIban);

      // Transaction details (inside NtryDtls.TxDtls)
      const txDtls = entry?.NtryDtls?.TxDtls;
      const txDetail = Array.isArray(txDtls) ? txDtls[0] : txDtls;

      // Party information
      const relatedParties = txDetail?.RltdPties;
      const name = relatedParties?.Dbtr?.Nm ?? relatedParties?.Cdtr?.Nm ?? txDetail?.Nm;
      const iban = relatedParties?.DbtrAcct?.Id?.IBAN ?? relatedParties?.CdtrAcct?.Id?.IBAN;
      const bic = txDetail?.RltdAgts?.DbtrAgt?.FinInstnId?.BIC ?? txDetail?.RltdAgts?.DbtrAgt?.FinInstnId?.BICFI;

      // Remittance info
      const rmtInf = txDetail?.RmtInf;
      const remittanceInfo = rmtInf?.Ustrd ?? rmtInf?.Strd;

      // End-to-end ID
      const endToEndId = txDetail?.Refs?.EndToEndId;

      return {
        accountServiceRef,
        bookingDate,
        valueDate,
        amount,
        currency,
        creditDebitIndicator,
        name,
        iban,
        bic,
        remittanceInfo,
        endToEndId,
      };
    } catch (e) {
      this.logger.warn(`Failed to parse CAMT entry:`, e);
      return null;
    }
  }

  private parseTransaction(tx: CamtTransaction, accountIban: string): Partial<BankTx> {
    // Use YAPEAL- prefix to match webhook format (YAPEAL-{transactionUid})
    // NOTE: This assumes CAMT-053 AcctSvcrRef equals Webhook transactionUid
    // If they differ, duplicates may occur when webhooks start working
    // TODO: Verify after first live test and adjust if needed
    const accountServiceRef = tx.accountServiceRef.startsWith('YAPEAL-')
      ? tx.accountServiceRef
      : `YAPEAL-${tx.accountServiceRef}`;

    // Use Math.abs to match webhook behavior (CAMT may have negative amounts for DBIT)
    const amount = Math.abs(tx.amount);

    return {
      accountServiceRef,
      bookingDate: tx.bookingDate,
      valueDate: tx.valueDate,
      txCount: 1,
      amount,
      instructedAmount: amount,
      txAmount: amount,
      chargeAmount: 0,
      currency: tx.currency,
      instructedCurrency: tx.currency,
      txCurrency: tx.currency,
      chargeCurrency: tx.currency,
      creditDebitIndicator: tx.creditDebitIndicator === 'CRDT' ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
      iban: tx.iban,
      name: tx.name,
      bic: tx.bic,
      remittanceInfo: tx.remittanceInfo,
      endToEndId: tx.endToEndId,
      accountIban: accountIban,
      txRaw: JSON.stringify(tx),
      bankReleaseDate: new Date(),
    };
  }

  // --- ACCOUNT/BALANCE METHODS --- //

  async getBalances(): Promise<YapealBalanceInfo[]> {
    const response = await this.getAccounts();

    return response.accounts
      .filter((account) => account.status === YapealAccountStatus.ACTIVE)
      .map((account) => ({
        iban: account.iban,
        currency: account.currency,
        availableBalance: this.convertYapealAmount(account.balances.available.amount),
        totalBalance: this.convertYapealAmount(account.balances.total.amount),
      }));
  }

  async getAccountStatement(iban: string, fromDate: Date, toDate: Date): Promise<any> {
    const params = new URLSearchParams({
      fromDate: Util.isoDate(fromDate),
      toDate: Util.isoDate(toDate),
    });

    return this.callApi<any>(`b2b/accounts/${iban}/camt-053-statement?${params.toString()}`, 'GET', undefined, true);
  }

  async getEntitledAccounts(): Promise<YapealAccountsResponse> {
    const { partnershipUid, adminUid } = Config.bank.yapeal;
    return this.callApi<YapealAccountsResponse>(
      `b2b/v2/agent/${partnershipUid}/accounts/entitled?executingAgentUID=${adminUid}`,
      'GET',
    );
  }

  private async getAccounts(): Promise<YapealAccountsResponse> {
    const { partnershipUid } = Config.bank.yapeal;
    return this.callApi<YapealAccountsResponse>(`b2b/v2/agent/${partnershipUid}/accounts`, 'GET');
  }

  // --- PAYMENT METHODS --- //

  async sendPayment(payment: Pain001Payment): Promise<void> {
    const request = Iso20022Service.createPain001Json(payment);

    await this.callApi<unknown>('b2b/instant-payment-orders/by-pain', 'POST', request, true);
  }

  async getPaymentStatus(msgId: string): Promise<YapealPaymentStatusResponse> {
    return this.callApi<YapealPaymentStatusResponse>(`b2b/instant-payment-order/${msgId}/state`, 'GET');
  }

  // --- SUBSCRIPTION METHODS --- //

  async createTransactionSubscription(
    iban: string,
    callbackPath?: string,
    format: YapealSubscriptionFormat = YapealSubscriptionFormat.JSON,
  ): Promise<YapealSubscription> {
    const request: YapealSubscriptionRequest = {
      iban,
      format,
    };
    if (callbackPath) request.callbackPath = callbackPath;

    return this.callApi<YapealSubscription>('b2b/v2/account/subscribe', 'POST', request, true);
  }

  async getTransactionSubscriptions(): Promise<YapealSubscription[]> {
    return this.callApi<YapealSubscription[]>('b2b/v2/accounts/subscription', 'GET', undefined, true);
  }

  async deleteTransactionSubscription(iban: string): Promise<void> {
    await this.callApi<void>(`b2b/v2/account/subscription?iban=${iban}`, 'DELETE', undefined, true);
  }

  // --- HELPER METHODS --- //

  private convertYapealAmount(amount: { factor: number; value: number }): number {
    // YAPEAL returns amount as value * 10^(-factor)
    // e.g., { value: 12345, factor: 2 } = 123.45
    return amount.value / Math.pow(10, amount.factor);
  }

  private async callApi<T>(
    url: string,
    method: Method = 'GET',
    data?: unknown,
    includePartnerHeaders = false,
  ): Promise<T> {
    if (!this.isAvailable()) throw new Error('YAPEAL is not configured');

    const { baseUrl, apiKey, adminUid, partnershipUid, cert, key } = Config.bank.yapeal;

    return this.http.request<T>({
      url: `${baseUrl}/${url}`,
      method,
      data,
      httpsAgent: new https.Agent({ cert, key }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...(includePartnerHeaders && {
          'x-partnership-uid': partnershipUid,
          'x-partner-uid': adminUid,
        }),
      },
    });
  }
}
