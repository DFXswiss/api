import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexLightningService {
  private static MIN_CHANNEL_AMOUNT = 0.005;

  private lightningClient: LightningClient;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, lightningService: LightningService) {
    this.lightningClient = lightningService.getDefaultClient();
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.lightningClient.getLndLocalChannelBalance();

    // TODO:
    // Hier stellt sich die Frage, welchen Puffer wir im Lightning Kanal stehen lassen?

    return [inputAmount, availableAmount - DexLightningService.MIN_CHANNEL_AMOUNT - pendingAmount];
  }

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.findBy({ isComplete: false })).filter(
      (o) => o.targetAsset.dexName === 'BTC' && o.targetAsset.blockchain === Blockchain.LIGHTNING,
    );

    return Util.sumObj<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
