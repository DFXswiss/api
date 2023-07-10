import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { LiquidityOrderRepository } from 'src/subdomains/supporting/dex/repositories/liquidity-order.repository';
import { DexDeFiChainService } from 'src/subdomains/supporting/dex/services/dex-defichain.service';
import { SellLiquidityStrategy } from './sell-liquidity.strategy';

export abstract class DeFiChainStrategy extends SellLiquidityStrategy {
  constructor(
    protected readonly dexDeFiChainService: DexDeFiChainService,
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
  ) {
    super();
  }

  async addSellData(order: LiquidityOrder): Promise<void> {
    const { targetAmount, feeAmount } = await this.dexDeFiChainService.getSwapResult(order.txId, order.targetAsset);

    order.sold(targetAmount);
    order.recordFee(await this.feeAsset(), feeAmount);
    await this.liquidityOrderRepo.save(order);
  }
}
