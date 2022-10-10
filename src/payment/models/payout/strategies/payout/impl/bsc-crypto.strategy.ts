import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBscService } from '../../../services/payout-bsc.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscCryptoStrategy extends EvmStrategy {
  constructor(protected readonly bscService: PayoutBscService, payoutOrderRepo: PayoutOrderRepository) {
    super(bscService, payoutOrderRepo);
  }

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.bscService.sendNativeCrypto(order.destinationAddress, order.amount);
  }
}
