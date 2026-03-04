import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SparkClient } from 'src/integration/blockchain/spark/spark-client';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexSparkService {
  private readonly sparkClient: SparkClient;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    sparkService: SparkService,
  ) {
    this.sparkClient = sparkService.getDefaultClient();
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.sparkClient.getNativeCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: 'BTC', blockchain: Blockchain.SPARK },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
