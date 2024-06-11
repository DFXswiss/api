import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import {
  CreateAccount,
  CreateOrder,
  DeclineCategory,
  EventType,
  PaymentType,
  SiftAssetType,
  SiftAuthenticationStatusMap,
  SiftBase,
  SiftPaymentMethodMap,
  SiftResponse,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../dto/sift.dto';

@Injectable()
export class SiftService {
  private readonly url = 'https://api.sift.com/v205/events?return_workflow_status=true&return_route_info';
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

  async transaction(
    buyCryptoOrCheckoutTx: BuyCrypto | CheckoutTx,
    userOrBuy: User | Buy,
    status: TransactionStatus,
    declineCategory: DeclineCategory,
    isCheckoutTx: boolean,
  ): Promise<SiftResponse> {
    const paymentMethod = this.createPaymentMethod(buyCryptoOrCheckoutTx, isCheckoutTx);

    const data: Transaction = {
      $transaction_id: isCheckoutTx
        ? (buyCryptoOrCheckoutTx as CheckoutTx).transaction.id.toString()
        : (buyCryptoOrCheckoutTx as BuyCrypto).transaction.id.toString(),
      $user_id: isCheckoutTx ? (userOrBuy as Buy).user.id.toString() : (userOrBuy as User).id.toString(),
      $transaction_type: TransactionType.BUY,
      $decline_category: isCheckoutTx
        ? SiftAuthenticationStatusMap[(buyCryptoOrCheckoutTx as CheckoutTx).authStatusReason]
        : declineCategory,
      $transaction_status: status,
      $time: isCheckoutTx
        ? (buyCryptoOrCheckoutTx as CheckoutTx).updated.getTime()
        : (buyCryptoOrCheckoutTx as BuyCrypto).updated.getTime(),
      $amount: isCheckoutTx
        ? (buyCryptoOrCheckoutTx as CheckoutTx).amount * 10000
        : (buyCryptoOrCheckoutTx as BuyCrypto).inputAmount * 10000, // amount in micros in the base unit
      $currency_code: isCheckoutTx
        ? (buyCryptoOrCheckoutTx as CheckoutTx).currency
        : (buyCryptoOrCheckoutTx as BuyCrypto).inputAsset,
      $site_country: 'CH',
      $payment_methods: [
        {
          $payment_type: isCheckoutTx
            ? PaymentType.CREDIT_CARD
            : SiftPaymentMethodMap[(buyCryptoOrCheckoutTx as BuyCrypto).paymentMethodIn],
          ...paymentMethod,
        },
      ],
      $digital_orders: [
        {
          $digital_asset: isCheckoutTx
            ? (userOrBuy as Buy).asset.name
            : (buyCryptoOrCheckoutTx as BuyCrypto).outputAsset.name,
          $pair: isCheckoutTx
            ? `${(buyCryptoOrCheckoutTx as CheckoutTx).currency}_${(userOrBuy as Buy).asset.name}`
            : `${(buyCryptoOrCheckoutTx as BuyCrypto).inputAsset}_${
                (buyCryptoOrCheckoutTx as BuyCrypto).outputAsset.name
              }`,
          $asset_type: SiftAssetType.CRYPTO,
          $volume: isCheckoutTx ? undefined : (buyCryptoOrCheckoutTx as BuyCrypto).outputAmount?.toString(),
        },
      ],
      blockchain: isCheckoutTx
        ? (userOrBuy as Buy).asset.blockchain
        : (buyCryptoOrCheckoutTx as BuyCrypto).outputAsset.blockchain,
    };

    return this.send(EventType.TRANSACTION, data);
  }

  private async send(type: EventType, data: SiftBase): Promise<SiftResponse> {
    if (!Config.sift.apiKey) return;

    data.$type = type;
    data.$api_key = Config.sift.apiKey;

    try {
      return await this.http.post(this.url, data);
    } catch (error) {
      this.logger.error(`Error sending Sift event ${type} for user ${data.$user_id}:`, error);
    }
  }

  private createPaymentMethod(buyCrypto: BuyCrypto | CheckoutTx, isCheckoutTx: boolean): any {
    const paymentMethod: any = {};

    if (isCheckoutTx) {
      const tx = buyCrypto as CheckoutTx;
      paymentMethod.$account_holder_name = tx.cardName;
      paymentMethod.$card_bin = tx.cardBin;
      paymentMethod.$card_last4 = tx.cardLast4;
      paymentMethod.$bank_name = tx.cardIssuer;
      paymentMethod.$bank_country = tx.cardIssuerCountry;
    } else {
      const tx = buyCrypto as BuyCrypto;
      if (tx.checkoutTx) {
        paymentMethod.$account_holder_name = tx.checkoutTx.cardName;
        paymentMethod.$card_bin = tx.checkoutTx.cardBin;
        paymentMethod.$card_last4 = tx.checkoutTx.cardLast4;
        paymentMethod.$bank_name = tx.checkoutTx.cardIssuer;
        paymentMethod.$bank_country = tx.checkoutTx.cardIssuerCountry;
      }
      if (tx.bankTx) {
        paymentMethod.$account_holder_name = tx.bankTx.name;
        paymentMethod.$card_bin = tx.bankTx.iban.slice(0, 6);
        paymentMethod.$card_last4 = tx.bankTx.iban.slice(-4);
        paymentMethod.$bank_name = tx.bankTx.bankName;
        paymentMethod.$bank_country = tx.bankTx.country;
        paymentMethod.$routing_number = tx.bankTx.aba;
      }
    }

    return paymentMethod;
  }
}
