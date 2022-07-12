import { BuyCrypto } from 'src/payment/models/buy-crypto/entities/buy-crypto.entity';
import { Util } from 'src/shared/util';

export class PayoutUtil {
  static aggregatePayout(transactions: BuyCrypto[]): { addressTo: string; amount: number }[] {
    // sum up duplicated addresses, fallback in case transactions to same address and asset end up in one batch
    const uniqueAddresses = new Map<string, number>();

    transactions.forEach((t) => {
      const existingAmount = uniqueAddresses.get(t.targetAddress);
      const increment = existingAmount ? Util.round(existingAmount + t.outputAmount, 8) : t.outputAmount;

      uniqueAddresses.set(t.targetAddress, increment);
    });

    return [...uniqueAddresses.entries()].map(([addressTo, amount]) => ({ addressTo, amount }));
  }
}
