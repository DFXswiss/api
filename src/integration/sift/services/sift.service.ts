import { Injectable } from '@nestjs/common';
import * as IbanTools from 'ibantools';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import {
  CreateAccount,
  CreateOrder,
  DeclineCategory,
  EventType,
  PaymentType,
  SiftAmlDeclineMap,
  SiftAssetType,
  SiftBase,
  SiftCheckoutDeclineMap,
  SiftPaymentMethodMap,
  SiftResponse,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../dto/sift.dto';

@Injectable()
export class SiftService {
  private readonly url = 'https://api.sift.com/v205/';
  private readonly logger = new DfxLogger(SiftService);

  constructor(private readonly http: HttpService) {}

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

  async login(user: User, ip: string): Promise<SiftResponse> {
    const data: SiftBase = {
      $user_id: user.id.toString(),
      $ip: ip,
      $time: Date.now(),
    };

    return this.send(EventType.LOGIN, data);
  }

  async createOrder(data: CreateOrder): Promise<SiftResponse> {
    return this.send(EventType.CREATE_ORDER, data);
  }

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

    const data: Transaction = {
      $user_id: user.id.toString(),
      $transaction_id: tx.transaction.id.toString(),
      $transaction_type: TransactionType.BUY,
      $time: tx.updated.getTime(),
      $site_country: 'CH',
      $transaction_status: status,
      $decline_category: status == TransactionStatus.FAILURE ? declineCategory : undefined,
      $currency_code: currency,
      $amount: amount * 10000, // amount in micros in the base unit
      $payment_methods: [paymentMethod],
      $digital_orders: [
        {
          $digital_asset: asset.name,
          $pair: `${currency}_${asset.name}`,
          $asset_type: SiftAssetType.CRYPTO,
          $volume: isBuyCrypto ? tx.outputAmount?.toString() : undefined,
        },
      ],
      blockchain: asset.blockchain,
    };

    return data;
  }

  private createPaymentMethod(paymentType: PaymentType, tx: BankTx | CheckoutTx): any {
    return tx instanceof CheckoutTx
      ? {
          $payment_type: paymentType,
          $account_holder_name: tx.cardName,
          $card_bin: tx.cardBin,
          $card_last4: tx.cardLast4,
          $bank_name: tx.cardIssuer,
          $bank_country: tx.cardIssuerCountry,
        }
      : {
          $payment_type: paymentType,
          $account_holder_name: tx.name,
          $shortened_iban_first6: IbanTools.validateIBAN(tx.iban).valid ? tx.iban.slice(0, 6) : undefined,
          $shortened_iban_last4: IbanTools.validateIBAN(tx.iban).valid ? tx.iban.slice(-4) : undefined,
          $bank_name: tx.bankName,
          $bank_country: tx.country,
          $routing_number: tx.aba,
        };
  }

  private async send(type: EventType, data: SiftBase): Promise<SiftResponse> {
    if (!Config.sift.apiKey) return;

    data.$type = type;
    data.$api_key = Config.sift.apiKey;

    const scoreUrl = 'events?return_workflow_status=true&return_route_info';

    try {
      return await this.http.post(`${this.url}${type == EventType.TRANSACTION ? scoreUrl : ''}`, data);
    } catch (error) {
      this.logger.error(`Error sending Sift event ${type} for user ${data.$user_id}:`, error);
    }
  }
}
