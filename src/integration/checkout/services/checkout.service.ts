import { Injectable } from '@nestjs/common';
import { Checkout } from 'checkout-sdk-node';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { CheckoutHostedPayment, CheckoutLanguages, CheckoutPagedResponse, CheckoutPayment } from '../dto/checkout.dto';

@Injectable()
export class CheckoutService {
  private readonly reference = 'DFX';

  private readonly checkout: Checkout;

  constructor() {
    this.checkout = new Checkout();
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
        failure_url: `${Config.frontend.services}/buy`,
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
}
