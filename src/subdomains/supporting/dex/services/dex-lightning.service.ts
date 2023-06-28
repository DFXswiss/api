import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexLightningService {
  private lightningClient: LightningClient;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, lightningService: LightningService) {
    this.lightningClient = lightningService.getDefaultClient();
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.lightningClient.getBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: 'BTC', blockchain: Blockchain.LIGHTNING },
    });

    return Util.sumObj<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
