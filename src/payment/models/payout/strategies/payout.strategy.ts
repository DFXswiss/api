import { MailService } from 'src/shared/services/mail.service';
import { Util } from 'src/shared/util';
import { PayoutOrder } from '../entities/payout-order.entity';

export abstract class PayoutStrategy {
  constructor(protected readonly mailService: MailService) {}

  abstract doPayout(order: PayoutOrder[]): Promise<void>;

  protected createPayoutGroups(orders: PayoutOrder[], maxGroupSize: number): PayoutOrder[][] {
    const result: Map<number, PayoutOrder[]> = new Map();

    orders.forEach((o) => {
      // find nearest non-full group without repeating address
      const suitableExistingGroups = [...result.entries()].filter(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ([_, _orders]) =>
          _orders.length < maxGroupSize && !_orders.find((_o) => _o.destinationAddress === o.destinationAddress),
      );

      const [key, group] = suitableExistingGroups[0] ?? [result.size, []];
      result.set(key, [...group, o]);
    });

    return [...result.values()];
  }

  protected aggregatePayout(orders: PayoutOrder[]): { addressTo: string; amount: number }[] {
    // sum up duplicated addresses, fallback in case orders to same address and asset end up in one payment round
    const uniqueAddresses = new Map<string, number>();

    orders.forEach((o) => {
      const existingAmount = uniqueAddresses.get(o.destinationAddress);
      const increment = existingAmount ? Util.round(existingAmount + o.amount, 8) : o.amount;

      uniqueAddresses.set(o.destinationAddress, increment);
    });

    return [...uniqueAddresses.entries()].map(([addressTo, amount]) => ({ addressTo, amount }));
  }

  async sendNonRecoverableErrorMail(message: string, e?: Error): Promise<void> {
    const body = e ? [message, e.message] : [message];

    await this.mailService.sendErrorMail('Payout Error', body);
  }
}
