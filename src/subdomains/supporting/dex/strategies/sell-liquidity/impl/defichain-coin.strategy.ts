import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { SellLiquidityRequest } from '../../../interfaces';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { SellLiquidityStrategyAlias } from '../sell-liquidity.facade';
import { DeFiChainStrategy } from './base/defichain.strategy';

@Injectable()
export class DeFiChainCoinStrategy extends DeFiChainStrategy {
  constructor(
    protected readonly assetService: AssetService,
    protected readonly dexDeFiChainService: DexDeFiChainService,
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    protected readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(dexDeFiChainService, liquidityOrderRepo, SellLiquidityStrategyAlias.DEFICHAIN_COIN);
  }

  async sellLiquidity(request: SellLiquidityRequest): Promise<void> {
    const dfiToken = await this.getDfiToken();
    const order = this.liquidityOrderFactory.createSellOrder(request, Blockchain.DEFICHAIN, this.name, dfiToken);

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

  private async getDfiToken(): Promise<Asset> {
    return this.assetService.getDfiToken();
  }

  private async bookLiquiditySell(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount } = order;

    if (referenceAsset.dexName !== 'DFI') {
      throw new Error('Sell liquidity DeFiChainCoinStrategy supports only DFI Coin');
    }

    const txId = await this.dexDeFiChainService.sellDfiCoin(referenceAmount);

    console.info(
      `Booked sell of ${referenceAmount} ${referenceAsset.dexName} coin liquidity. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    order.addBlockchainTransactionMetadata(txId);
  }
}
