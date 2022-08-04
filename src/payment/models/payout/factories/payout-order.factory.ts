import { Injectable } from '@nestjs/common';
import { PayoutOrder, PayoutOrderStatus } from '../entities/payout-order.entity';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { PayoutRequest } from '../services/payout.service';

@Injectable()
export class PayoutOrderFactory {
  constructor(private readonly payoutOrderRepo: PayoutOrderRepository) {}

  createOrder(request: PayoutRequest, chain: string): PayoutOrder {
    const { context, correlationId, asset, amount, destinationAddress } = request;

    return this.payoutOrderRepo.create({
      context,
      correlationId,
      chain,
      asset,
      amount,
      destinationAddress,
      status: PayoutOrderStatus.CREATED,
    });
  }
}
