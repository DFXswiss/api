import { Util } from 'src/shared/util';
import { PocPayoutOrder } from '../models/payout-order.entity';

export class PayoutUtil {
  static aggregatePayout(orders: PocPayoutOrder[]): { addressTo: string; amount: number }[] {
    // sum up duplicated addresses, fallback in case transactions to same address and asset end up in one batch
    const uniqueAddresses = new Map<string, number>();

    orders.forEach((o) => {
      const existingAmount = uniqueAddresses.get(o.destination);
      const increment = existingAmount ? Util.round(existingAmount + o.amount, 8) : o.amount;

      uniqueAddresses.set(o.destination, increment);
    });

    return [...uniqueAddresses.entries()].map(([addressTo, amount]) => ({ addressTo, amount }));
  }
}
