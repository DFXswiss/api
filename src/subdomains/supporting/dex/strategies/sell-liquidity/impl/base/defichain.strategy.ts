import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { LiquidityOrderRepository } from 'src/subdomains/supporting/dex/repositories/liquidity-order.repository';
import { DexDeFiChainService } from 'src/subdomains/supporting/dex/services/dex-defichain.service';
import { SellLiquidityStrategyAlias } from '../../sell-liquidity.facade';
import { SellLiquidityStrategy } from './sell-liquidity.strategy';

export abstract class DeFiChainStrategy extends SellLiquidityStrategy {
  constructor(
    protected readonly dexDeFiChainService: DexDeFiChainService,
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    name: SellLiquidityStrategyAlias,
  ) {
    super(name);
  }

  async addSellData(order: LiquidityOrder): Promise<void> {
    const amount = await this.dexDeFiChainService.getSwapAmount(order.txId, order.targetAsset.dexName);

    order.sold(amount);
    order.recordFee(await this.feeAsset(), 0);
    await this.liquidityOrderRepo.save(order);
  }
}
