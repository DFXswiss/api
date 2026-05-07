import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ArkadeClient } from 'src/integration/blockchain/arkade/arkade-client';
import { ArkadeService } from 'src/integration/blockchain/arkade/arkade.service';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexArkadeService {
  private readonly arkadeClient: ArkadeClient;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    arkadeService: ArkadeService,
  ) {
    this.arkadeClient = arkadeService.getDefaultClient();
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.arkadeClient.getNativeCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: 'BTC', blockchain: Blockchain.ARKADE },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
