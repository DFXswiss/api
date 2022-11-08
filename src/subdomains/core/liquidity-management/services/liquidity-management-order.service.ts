import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementProcessor } from '../entities/liquidity-management-processor.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementOrderType } from '../enums';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { LiquidityProcessorFactory } from '../factories/liquidity-processor.factory';
import { LiquidityProcessor } from '../interfaces';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';

@Injectable()
export class LiquidityManagementOrderService {
  constructor(
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly liquidityProcessorFactory: LiquidityProcessorFactory,
  ) {}

  @Interval(60000)
  async processOrders() {
    const orders = await this.orderRepo.find({ status: LiquidityManagementOrderStatus.CREATED });

    for (const order of orders) {
      try {
        await this.executeOrder(order);
      } catch (e) {
        if (e instanceof OrderNotProcessableException) {
          order.fail();
          await this.orderRepo.save(order);
        }
      }
    }
  }

  //*** HELPER METHODS ***//

  private async executeOrder(order: LiquidityManagementOrder): Promise<void> {
    const processorIntegration = await this.findLiquidityProcessorIntegration(order.processor);

    order.type === LiquidityManagementOrderType.BUY
      ? await processorIntegration.buy(order.amount)
      : await processorIntegration.sell(order.amount);
  }

  private async findLiquidityProcessorIntegration(
    processor: LiquidityManagementProcessor,
  ): Promise<LiquidityProcessor> {
    return this.liquidityProcessorFactory.getIntegration(processor);
  }
}
