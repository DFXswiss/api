import { Injectable } from '@nestjs/common';
import * as IbanTools from 'ibantools';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
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

@Injectable()
export class SiftService {
  private readonly logger: DfxLogger;
  private readonly url = 'https://api.sift.com/v205/events';
  private readonly decisionUrl = 'https://api.sift.com/v3/accounts/';

  constructor(readonly loggerFactory: LoggerFactory, private readonly http: HttpService) {
    this.logger = loggerFactory.create(SiftService);
  }

  // --- ACCOUNT --- //
  async createAccount(user: User): Promise<SiftResponse> {
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

    return this.send(EventType.CREATE_ACCOUNT, data);
  }

  async updateAccount(data: CreateAccount): Promise<SiftResponse> {
    return this.send(EventType.UPDATE_ACCOUNT, data);
  }

  async createChargeback(data: Chargeback): Promise<SiftResponse> {
    return this.send(EventType.CHARGEBACK, data);
  }

  async login(user: User, ip: string): Promise<SiftResponse> {
    const data: SiftBase = {
      $user_id: user.id.toString(),
      $ip: ip,
      $time: Date.now(),
    };

    return this.send(EventType.LOGIN, data);
  }

  // --- ORDER --- //
  async createOrder(
    order: TransactionRequest,
    userId: number,
    sourceCurrency: string,
    targetCurrency: string,
    blockchain: Blockchain,
  ): Promise<SiftResponse> {
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

    return this.send(EventType.CREATE_ORDER, data);
  }

  // --- TRANSACTION --- //
  async buyCryptoTransaction(buyCrypto: BuyCrypto, status: TransactionStatus): Promise<SiftResponse> {
    const data = this.getTxData(
      buyCrypto.user,
      buyCrypto,
      buyCrypto.outputAsset,
      status,
      SiftAmlDeclineMap[buyCrypto.amlReason],
    );

    return this.send(EventType.TRANSACTION, data);
  }

  async checkoutTransaction(checkoutTx: CheckoutTx, status: TransactionStatus, buy: Buy): Promise<SiftResponse> {
    const data = this.getTxData(
      buy.user,
      checkoutTx,
      buy.asset,
      status,
      SiftCheckoutDeclineMap[checkoutTx.authStatusReason],
    );

    return this.send(EventType.TRANSACTION, data);
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

  private async send(type: EventType, data: SiftBase): Promise<SiftResponse> {
    if (!Config.sift.apiKey) return;

    data.$type = type;
    data.$api_key = Config.sift.apiKey;

    const scoreUrl = '?return_score=true';

    try {
      return await this.http.post(`${this.url}${type == EventType.TRANSACTION ? scoreUrl : ''}`, data);
    } catch (error) {
      this.logger.error(`Error sending Sift event ${type} for user ${data.$user_id}:`, error);
    }
  }

  async sendUserBlocked(user: User, description?: string): Promise<SiftResponse> {
    if (!Config.sift.apiKey) return;

    const data = {
      decision_id: 'looks_suspicious_payment_abuse',
      analyst: Config.sift.analyst,
      source: SiftDecisionSource.MANUAL_REVIEW,
      description,
    };

    const scoreUrl = `${Config.sift.accountId}/users/${user.id}/decisions`;

    try {
      return await this.http.post(`${this.decisionUrl}${scoreUrl}`, data, {
        headers: { Authorization: Config.sift.apiKey },
      });
    } catch (error) {
      this.logger.error(`Error sending Sift decision for user ${user.id}:`, error);
    }
  }
}
