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
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../dto/sift.dto';

@Injectable()
export class SiftService {
  private readonly url = 'https://api.sift.com/v205/events';
  private readonly logger = new DfxLogger(SiftService);

  constructor(private readonly http: HttpService) {}

  async createAccount(user: User): Promise<void> {
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

  async updateAccount(data: CreateAccount): Promise<void> {
    return this.send(EventType.UPDATE_ACCOUNT, data);
  }

  async login(user: User, ip: string): Promise<void> {
    const data: SiftBase = {
      $user_id: user.id.toString(),
      $ip: ip,
      $time: Date.now(),
    };

    return this.send(EventType.LOGIN, data);
  }

  async createOrder(data: CreateOrder): Promise<void> {
    return this.send(EventType.CREATE_ORDER, data);
  }

  async transaction(
    entity: BuyCrypto,
    status: TransactionStatus,
    declineCategory: DeclineCategory = undefined,
  ): Promise<void> {
    const paymentMethod: {
      $account_holder_name;
      $card_bin;
      $card_last4;
      $bank_name;
      $bank_country;
      $shortened_iban_first6;
      $shortened_iban_last4;
      $routing_number;
    } = undefined;

    if (entity.checkoutTx) {
      paymentMethod.$account_holder_name = entity.checkoutTx.cardName;
      paymentMethod.$card_bin = entity.checkoutTx.cardBin;
      paymentMethod.$card_last4 = entity.checkoutTx.cardLast4;
      paymentMethod.$bank_name = entity.checkoutTx.cardIssuer;
      paymentMethod.$bank_country = entity.checkoutTx.cardIssuerCountry;
    }

    if (entity.bankTx) {
      paymentMethod.$account_holder_name = entity.bankTx.name;
      paymentMethod.$card_bin = entity.bankTx.iban.slice(0, 6);
      paymentMethod.$card_last4 = entity.bankTx.iban.slice(-4);
      paymentMethod.$bank_name = entity.bankTx.bankName;
      paymentMethod.$bank_country = entity.bankTx.country;
      paymentMethod.$routing_number = entity.bankTx.aba;
    }

    const data: Transaction = {
      $transaction_id: entity.transaction.id.toString(),
      $user_id: entity.user.id.toString(),
      $order_id: entity.transactionRequest?.id?.toString(),
      $transaction_type: TransactionType.BUY,
      $decline_category: declineCategory,
      $transaction_status: status,
      $time: entity.updated.getTime(),
      $amount: entity.inputAmount * 10000, //amount in micros in the base unit
      $currency_code: entity.inputAsset,
      $site_country: 'CH',
      $payment_methods: [
        {
          $payment_type: SiftPaymentMethodMap[entity.paymentMethodIn],
          ...paymentMethod,
        },
      ],
      $digital_orders: [
        {
          $digital_asset: entity.outputAsset.name,
          $pair: `${entity.inputAsset}_${entity.outputAsset.name}`,
          $asset_type: SiftAssetType.CRYPTO,
          $volume: entity.outputAmount?.toString(),
        },
      ],
      blockchain: entity.outputAsset.blockchain,
    };
    return this.send(EventType.TRANSACTION, data);
  }

  async transactionCheckoutDeclined(checkoutTx: CheckoutTx, buy: Buy): Promise<void> {
    const data: Transaction = {
      $transaction_id: checkoutTx.transaction.id.toString(),
      $user_id: buy.user.id.toString(),
      $transaction_type: TransactionType.BUY,
      $decline_category: SiftAuthenticationStatusMap[checkoutTx.authStatusReason],
      $transaction_status: TransactionStatus.FAILURE,
      $time: checkoutTx.updated.getTime(),
      $amount: checkoutTx.amount * 10000, //amount in micros in the base unit
      $currency_code: checkoutTx.currency,
      $site_country: 'CH',
      $payment_methods: [
        {
          $payment_type: PaymentType.CREDIT_CARD,
          $account_holder_name: checkoutTx.cardName,
          $card_bin: checkoutTx.cardBin,
          $card_last4: checkoutTx.cardLast4,
          $bank_name: checkoutTx.cardIssuer,
          $bank_country: checkoutTx.cardIssuerCountry,
        },
      ],
      $digital_orders: [
        {
          $digital_asset: buy.asset.name,
          $pair: `${checkoutTx.currency}_${buy.asset.name}`,
          $asset_type: SiftAssetType.CRYPTO,
        },
      ],
      blockchain: buy.asset.blockchain,
    };
    return this.send(EventType.TRANSACTION, data);
  }

  private async send(type: EventType, data: SiftBase): Promise<void> {
    if (!Config.sift.apiKey) return;

    data.$type = type;
    data.$api_key = Config.sift.apiKey;

    try {
      await this.http.post(this.url, data);
    } catch (error) {
      this.logger.error(`Error sending Sift event ${type} for user ${data.$user_id}:`, error);
    }
  }
}
