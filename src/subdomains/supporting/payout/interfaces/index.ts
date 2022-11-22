import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutOrderContext } from '../entities/payout-order.entity';

export interface PayoutRequest {
  context: PayoutOrderContext;
  correlationId: string;
  asset: Asset;
  amount: number;
  destinationAddress: string;
}

export interface FeeRequest {
  asset: Asset;
  quantityOfTransactions: number;
}

export interface FeeResult {
  asset: Asset;
  amount: number;
}
