import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutEthereumService } from '../../../services/payout-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumCoinStrategy extends EvmStrategy {
  constructor(protected readonly ethereumService: PayoutEthereumService, payoutOrderRepo: PayoutOrderRepository) {
    super(ethereumService, payoutOrderRepo);
  }

  estimateFee(quantityOfTransactions: number): Promise<FeeResult> {}

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.ethereumService.sendNativeCoin(order.destinationAddress, order.amount);
  }
}
