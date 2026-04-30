import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexLightningService {
  private static readonly ROUTING_RESERVE_FACTOR = 0.99; // 1% reserve for routing fees

  private readonly lightningClient: LightningClient;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    lightningService: LightningService,
  ) {
    this.lightningClient = lightningService.getDefaultClient();
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.lightningClient.getAvailableBalance();

    return [inputAmount, availableAmount * DexLightningService.ROUTING_RESERVE_FACTOR - pendingAmount];
  }

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: 'BTC', blockchain: Blockchain.LIGHTNING },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
