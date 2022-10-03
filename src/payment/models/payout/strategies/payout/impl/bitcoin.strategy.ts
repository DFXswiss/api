import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBitcoinService } from '../../../services/payout-bitcoin.service';
import { PayoutStrategy } from './base/payout.strategy';

@Injectable()
export class BitcoinStrategy implements PayoutStrategy {
  constructor(
    protected readonly bitcoinService: PayoutBitcoinService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {}

  doPayout(orders: PayoutOrder[]): Promise<void> {
    throw new Error('Method not implemented.');
  }

  checkPayoutCompletion(order: PayoutOrder): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
