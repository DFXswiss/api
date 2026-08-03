import { Injectable } from '@nestjs/common';
import { Checkout } from 'checkout-sdk-node';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import { CheckoutHostedPayment, CheckoutLanguages, CheckoutPagedResponse, CheckoutPayment } from '../dto/checkout.dto';

interface CheckoutBalanceData {
  balances: CheckoutBalances;
  descriptor: string;
  holding_currency: string;
}

export interface CheckoutBalances {
  available: number;
  collateral: number;
  payable: number;
  pending: number;
}

export interface CheckoutReverse {
  action_id: string;
  _links: { payment: { href: string } };
}

export interface CheckoutPaymentAction {
  id: string;
  type: string;
  amount?: number;
  reference?: string;
  approved?: boolean;
  processed_on?: string;
}

@Injectable()
export class CheckoutService {
  private readonly reference = 'DFX';

  private readonly checkout: Checkout;

  constructor() {
    this.checkout = new Checkout();
  }

  isAvailable(): boolean {
    return process.env.CKO_SECRET_KEY != null && Config.checkout.entityId != null;
  }

  async createPaymentLink(
    remittanceInfo: string,
    fiatAmount: number,
    currency: Fiat,
    asset: Asset,
    language: Language,
  ): Promise<string> {
    const amount = Math.round(fiatAmount * 100);

    return this.checkout.hostedPayments
      .create({
        reference: this.reference,
        amount: amount,
        currency: currency.name,
        locale: CheckoutLanguages[language.symbol] ?? CheckoutLanguages.EN,
        billing: {
          address: {
            country: 'CH',
          },
        },
        products: [
          {
            name: asset.uniqueName,
            quantity: 1,
            price: amount,
          },
        ],
        description: remittanceInfo,
        success_url: `${Config.frontend.services}/buy/success`,
        cancel_url: `${Config.frontend.services}/buy`,
        failure_url: `${Config.frontend.services}/buy/failure`,
      })
      .then((r: CheckoutHostedPayment) => r._links.redirect.href);
  }

  async getPayments(since?: Date): Promise<CheckoutPayment[]> {
    let batch: CheckoutPagedResponse<CheckoutPayment> = await this.checkout.payments.getPaymentList({
      reference: this.reference,
      limit: 100,
    });
    const payments = batch.data;

    while (payments.length < batch.total_count && !(new Date(payments[payments.length - 1].requested_on) < since)) {
      batch = await this.checkout.payments.getPaymentList({
        reference: this.reference,
        limit: batch.limit,
        skip: batch.skip + batch.limit,
      });
      payments.push(...batch.data);
    }

    payments.reverse();

    return payments.filter((p) => !(new Date(p.requested_on) < since));
  }

  async getPaymentList(chargebackList: CheckoutTx[]): Promise<CheckoutPayment[]> {
    const payments: CheckoutPayment[] = [];

    for (const chargeback of chargebackList) {
      const payment: CheckoutPayment = await this.checkout.payments.get(chargeback.paymentId);
      payments.push(payment);
    }

    return payments;
  }

  async getBalances(): Promise<CheckoutBalanceData[]> {
    const balance = await this.checkout.balances.retrieve(Config.checkout.entityId);
    return balance.data;
  }

  async getPaymentActions(paymentId: string): Promise<CheckoutPaymentAction[]> {
    return (await this.checkout.payments.getActions(paymentId)) as CheckoutPaymentAction[];
  }

  async refundBuyCryptoPayment(
    paymentId: string,
    buyCryptoId: number,
    previousFailedActionId?: string,
  ): Promise<CheckoutReverse> {
    const attempt = previousFailedActionId ?? 'initial';
    const reference = CheckoutService.buyCryptoRefundReference(buyCryptoId);
    const idempotencyKey = previousFailedActionId
      ? `buy-crypto-refund-${buyCryptoId}-${attempt}`
      : `buy-crypto-${buyCryptoId}-checkout-refund`;
    return (await this.checkout.payments.refund(paymentId, { reference }, idempotencyKey)) as CheckoutReverse;
  }

  static buyCryptoRefundReference(buyCryptoId: number): string {
    return `bc-${buyCryptoId}-refund`;
  }
}
