import { Injectable } from '@nestjs/common';
import { PayoutOrder, PayoutOrderStatus } from '../entities/payout-order.entity';
import { PayoutRequest } from '../interfaces';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';

@Injectable()
export class PayoutOrderFactory {
  constructor(private readonly payoutOrderRepo: PayoutOrderRepository) {}

  createOrder(request: PayoutRequest): PayoutOrder {
    const { context, correlationId, asset, amount, destinationAddress } = request;

    return this.payoutOrderRepo.create({
      context,
      correlationId,
      chain: asset.blockchain,
      asset,
      amount,
      destinationAddress,
      status: PayoutOrderStatus.CREATED,
    });
  }
}
