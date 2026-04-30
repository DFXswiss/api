import { PayoutOrderContext } from '../../entities/payout-order.entity';

export type PayoutGroup = { addressTo: string; amount: number }[];

export abstract class PayoutBitcoinBasedService {
  abstract isHealthy(context: PayoutOrderContext): Promise<boolean>;
  abstract getPayoutCompletionData(context: PayoutOrderContext, payoutTxId: string): Promise<[boolean, number]>;
}
