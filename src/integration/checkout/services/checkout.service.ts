import { Injectable } from '@nestjs/common';
import { Checkout } from 'checkout-sdk-node';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { HostedPayment, PagedResponse, Payment } from '../dto/checkout.dto';

@Injectable()
export class CheckoutService {
  private checkout: Checkout;

  constructor() {
    this.checkout = new Checkout();
  }

  async createPaymentLink(
    reference: string,
    fiatAmount: number,
    currency: Fiat,
    cryptoAmount: number,
    asset: Asset,
  ): Promise<string> {
    const amount = Math.round(fiatAmount * 100);

    return this.checkout.hostedPayments
      .create({
        reference: reference,
        amount: amount,
        currency: currency.name,
        billing: {
          address: {
            country: 'CH',
          },
        },
        products: [
          {
            name: `${cryptoAmount} ${asset.uniqueName}`,
            quantity: 1,
            price: amount,
          },
        ],
        success_url: `${Config.frontend.services}/buy/success`,
        cancel_url: `${Config.frontend.services}/buy`,
        failure_url: `${Config.frontend.services}/buy`,
      })
      .then((r: HostedPayment) => r._links.redirect.href);
  }

  async getPayments(reference: string, since?: Date): Promise<Payment[]> {
    let batch: PagedResponse<Payment> = await this.checkout.payments.getPaymentList({ reference, limit: 100 });
    const payments = batch.data;

    while (payments.length < batch.total_count && !(new Date(payments[payments.length - 1].requested_on) < since)) {
      batch = await this.checkout.payments.getPaymentList({
        reference,
        limit: batch.limit,
        skip: batch.skip + batch.limit,
      });
      payments.push(...batch.data);
    }

    return payments.filter((p) => !(new Date(p.requested_on) < since));
  }
}
