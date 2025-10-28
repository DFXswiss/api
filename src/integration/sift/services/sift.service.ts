import { Injectable } from '@nestjs/common';
import * as IbanTools from 'ibantools';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import {
  TransactionRequest,
  TransactionRequestType,
} from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import {
  Chargeback,
  CreateAccount,
  CreateOrder,
  DeclineCategory,
  DigitalOrder,
  EventType,
  PaymentType,
  SiftAmlDeclineMap,
  SiftAssetType,
  SiftBase,
  SiftCheckoutDeclineMap,
  SiftDecisionSource,
  SiftPaymentMethodMap,
  SiftResponse,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../dto/sift.dto';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { SiftErrorLogRepository } from '../repositories/sift-error-log.repository';

@Injectable()
export class SiftService {
  private readonly url = 'https://api.sift.com/v205/events';
  private readonly decisionUrl = 'https://api.sift.com/v3/accounts/';
  private readonly timeout = 5000; // 5 seconds timeout for all Sift API calls

  private readonly logger = new DfxLogger(SiftService);

  constructor(
    private readonly http: HttpService,
    private readonly siftErrorLogRepo: SiftErrorLogRepository,
  ) {}

  // --- ACCOUNT --- //
  createAccount(user: User): void {
    const data: CreateAccount = {
      $user_id: user.id.toString(),
      $referrer_user_id: user.ref,
      $ip: user.ip,
      $time: user.created.getTime(),
      $brand_name: user.wallet.name,
      $site_country: 'CH',
      blockchain_address: user.address,
      kyc_level: KycLevel.LEVEL_0,
    };

    return this.sendSync(EventType.CREATE_ACCOUNT, data);
  }

  updateAccount(data: CreateAccount): void {
    return this.sendSync(EventType.UPDATE_ACCOUNT, data);
  }

  createChargeback(data: Chargeback): void {
    return this.sendSync(EventType.CHARGEBACK, data);
  }

  login(user: User, ip: string): void {
    const data: SiftBase = {
      $user_id: user.id.toString(),
      $ip: ip,
      $time: Date.now(),
    };

    return this.sendSync(EventType.LOGIN, data);
  }

  // --- ORDER --- //
  createOrder(
    order: TransactionRequest,
    userId: number,
    sourceCurrency: string,
    targetCurrency: string,
    blockchain: Blockchain,
  ): void {
    const data: CreateOrder = {
      $order_id: order.id.toString(),
      $user_id: userId.toString(),
      $time: order.created.getTime(),
      $amount: this.transformAmount(order.amount),
      $currency_code: sourceCurrency,
      $site_country: 'CH',
      $payment_methods: [{ $payment_type: SiftPaymentMethodMap[order.sourcePaymentMethod] }],
      $digital_orders: [
        this.createDigitalOrder(
          order.type === TransactionRequestType.SELL ? SiftAssetType.FIAT : SiftAssetType.CRYPTO,
          sourceCurrency,
          targetCurrency,
          order.estimatedAmount,
        ),
      ],
      blockchain,
    };

    return this.sendSync(EventType.CREATE_ORDER, data);
  }

  // --- TRANSACTION --- //
  buyCryptoTransaction(buyCrypto: BuyCrypto, status: TransactionStatus): void {
    const data = this.getTxData(
      buyCrypto.user,
      buyCrypto,
      buyCrypto.outputAsset,
      status,
      SiftAmlDeclineMap[buyCrypto.amlReason],
    );

    void this.send(EventType.TRANSACTION, data);
  }

  checkoutTransaction(checkoutTx: CheckoutTx, status: TransactionStatus, buy: Buy): void {
    const data = this.getTxData(
      buy.user,
      checkoutTx,
      buy.asset,
      status,
      SiftCheckoutDeclineMap[checkoutTx.authStatusReason],
    );

    void this.send(EventType.TRANSACTION, data);
  }

  // --- HELPER METHODS --- //
  private getTxData(
    user: User,
    tx: BuyCrypto | CheckoutTx,
    asset: Asset,
    status: TransactionStatus,
    declineCategory: DeclineCategory,
  ): Transaction {
    const isBuyCrypto = tx instanceof BuyCrypto;

    const amount = isBuyCrypto ? tx.inputAmount : tx.amount;
    const currency = isBuyCrypto ? tx.inputAsset : tx.currency;
    const paymentMethod = isBuyCrypto
      ? this.createPaymentMethod(SiftPaymentMethodMap[tx.paymentMethodIn], tx.bankTx ?? tx.checkoutTx)
      : this.createPaymentMethod(PaymentType.CREDIT_CARD, tx);
    const ip = isBuyCrypto ? undefined : tx.ip;

    const data: Transaction = {
      $user_id: user.id.toString(),
      $ip: ip,
      $transaction_id: tx.transaction.id.toString(),
      $transaction_type: TransactionType.BUY,
      $time: tx.updated.getTime(),
      $site_country: 'CH',
      $transaction_status: status,
      $decline_category: status === TransactionStatus.FAILURE ? declineCategory : undefined,
      $currency_code: currency,
      $amount: this.transformAmount(amount),
      $payment_method: paymentMethod,
      $digital_orders: [
        this.createDigitalOrder(SiftAssetType.CRYPTO, currency, asset.name, isBuyCrypto ? tx.outputAmount : undefined),
      ],
      blockchain: asset.blockchain,
    };

    return data;
  }

  private transformAmount(amount: number): number {
    return Util.round(amount * 1000000, 0); // amount in micros in the base unit
  }

  private createPaymentMethod(paymentType: PaymentType, tx: BankTx | CheckoutTx): any {
    return tx instanceof CheckoutTx
      ? {
          $payment_type: paymentType,
          $account_holder_name: tx.cardName,
          $card_bin: tx.cardBin,
          $card_last4: tx.cardLast4,
          $bank_name: tx.cardIssuer ?? undefined,
          $bank_country: tx.cardIssuerCountry ?? undefined,
        }
      : tx instanceof BankTx
      ? {
          $payment_type: paymentType,
          $account_holder_name: tx.name,
          $shortened_iban_first6: IbanTools.validateIBAN(tx.iban).valid ? tx.iban.slice(0, 6) : undefined,
          $shortened_iban_last4: IbanTools.validateIBAN(tx.iban).valid ? tx.iban.slice(-4) : undefined,
          $bank_name: tx.bankName ?? undefined,
          $bank_country: tx.country ?? undefined,
          $routing_number: tx.aba ?? undefined,
        }
      : {
          $payment_type: paymentType,
        };
  }

  private createDigitalOrder(type: SiftAssetType, from: string, to: string, amount?: number): DigitalOrder {
    return {
      $digital_asset: to,
      $pair: `${from}_${to}`,
      $asset_type: type,
      $volume: amount?.toString(),
    };
  }

  private sendSync(type: EventType, data: SiftBase): void {
    void this.send(type, data);
  }

  private async send(type: EventType, data: SiftBase): Promise<SiftResponse> {
    if (!Config.sift.apiKey) {
      this.logger.warn(`Sift API key not configured - skipping event ${type}`);
      return;
    }

    data.$type = type;
    data.$api_key = Config.sift.apiKey;

    const scoreUrl = '?return_score=true';
    const startTime = Date.now();

    try {
      const response = await this.http.post<SiftResponse>(
        `${this.url}${type == EventType.TRANSACTION ? scoreUrl : ''}`,
        data,
        { timeout: this.timeout },
      );

      const duration = Date.now() - startTime;
      this.logger.verbose(`Sift event ${type} sent successfully for user ${data.$user_id} (${duration}ms)`);

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      const httpError = error as any;
      const isTimeout = duration >= this.timeout;

      this.logger.error(
        `Sift API call failed: ${type} for user ${data.$user_id} - ${httpError?.message || String(error)} (${duration}ms, status: ${httpError?.response?.status}, timeout: ${isTimeout})`,
        httpError,
      );

      // Store error in database for monitoring and debugging
      void this.logError(type, data.$user_id, duration, httpError, isTimeout);

      // Error is intentionally swallowed - Sift failures should never break DFX operations
      return undefined;
    }
  }

  private async logError(
    eventType: EventType,
    userId: string | undefined,
    duration: number,
    error: any,
    isTimeout: boolean,
  ): Promise<void> {
    try {
      await this.siftErrorLogRepo.save({
        eventType,
        userId: userId ? parseInt(userId) : undefined,
        httpStatusCode: error?.response?.status,
        errorMessage: error?.message || String(error),
        duration,
        isTimeout,
      });
    } catch (e) {
      // If we can't log the error to DB, at least log it
      this.logger.error(`Failed to store Sift error log in database:`, e);
    }
  }

  // --- DECISION --- //
  sendUserBlocked(user: User, description?: string): void {
    void this.sendDecision(user, description);
  }

  private async sendDecision(user: User, description?: string): Promise<void> {
    if (!Config.sift.apiKey) {
      this.logger.warn(`Sift API key not configured - skipping user blocked decision for user ${user.id}`);
      return;
    }

    const data = {
      decision_id: 'looks_suspicious_payment_abuse',
      analyst: Config.sift.analyst,
      source: SiftDecisionSource.MANUAL_REVIEW,
      description,
    };

    const scoreUrl = `${Config.sift.accountId}/users/${user.id}/decisions`;
    const startTime = Date.now();

    try {
      await this.http.post<SiftResponse>(`${this.decisionUrl}${scoreUrl}`, data, {
        headers: { Authorization: Config.sift.apiKey },
        timeout: this.timeout,
      });

      const duration = Date.now() - startTime;
      this.logger.verbose(`Sift user blocked decision sent successfully for user ${user.id} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      const httpError = error as any;
      const isTimeout = duration >= this.timeout;

      this.logger.error(
        `Sift decision API call failed for user ${user.id} - ${httpError?.message || String(error)} (${duration}ms, status: ${httpError?.response?.status}, timeout: ${isTimeout})`,
        httpError,
      );

      // Store error in database for monitoring and debugging
      void this.logError('$user_blocked_decision' as EventType, user.id.toString(), duration, httpError, isTimeout);
    }
  }
}
