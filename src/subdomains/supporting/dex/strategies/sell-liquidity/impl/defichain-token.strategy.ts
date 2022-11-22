import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { SellLiquidityRequest } from '../../../interfaces';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { SellLiquidityStrategyAlias } from '../sell-liquidity.facade';
import { DeFiChainStrategy } from './base/defichain.strategy';

@Injectable()
export class DeFiChainTokenStrategy extends DeFiChainStrategy {
  constructor(
    protected readonly assetService: AssetService,
    protected readonly dexDeFiChainService: DexDeFiChainService,
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    protected readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(dexDeFiChainService, liquidityOrderRepo, SellLiquidityStrategyAlias.DEFICHAIN_TOKEN);
  }

  async sellLiquidity(request: SellLiquidityRequest): Promise<void> {
    const targetAsset = await this.defineTargetAsset(request);
    const order = this.liquidityOrderFactory.createSellOrder(request, Blockchain.DEFICHAIN, this.name, targetAsset);

    try {
      await this.bookLiquiditySell(order);
      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      this.handleSellLiquidityError(request, e);
    }
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }

  //*** HELPER METHODS ***//

  private async defineTargetAsset(request: SellLiquidityRequest): Promise<Asset> {
    const { sellAsset } = request;
    const targetAssetName = this.defineTargetAssetName(sellAsset);

    return this.assetService.getAssetByQuery({
      dexName: targetAssetName,
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });
  }

  private defineTargetAssetName(sellAsset: Asset): string {
    switch (sellAsset.dexName) {
      case 'BTC':
        throw new Error('Selling BTC on DEX is not supported by DeFiChainTokenStrategy');

      case 'DFI':
        return 'BTC';

      default:
        return this.getDefaultTargetAsset(sellAsset);
    }
  }

  private getDefaultTargetAsset(sellAsset: Asset): string {
    return sellAsset.category === AssetCategory.CRYPTO ? 'DFI' : 'DUSD';
  }

  private async bookLiquiditySell(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;

    const txId = await this.dexDeFiChainService.swapLiquidity(
      referenceAsset,
      referenceAmount,
      targetAsset,
      maxPriceSlippage,
    );

    console.info(
      `Booked sell of ${referenceAmount} ${referenceAsset.dexName} liquidity for ${targetAsset.dexName}. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    order.addBlockchainTransactionMetadata(txId);
  }
}
