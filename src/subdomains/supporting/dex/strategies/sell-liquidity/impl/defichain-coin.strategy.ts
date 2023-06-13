import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { SellLiquidityRequest } from '../../../interfaces';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DeFiChainStrategy } from './base/defichain.strategy';

@Injectable()
export class DeFiChainCoinStrategy extends DeFiChainStrategy {
  protected readonly logger = new DfxLogger(DeFiChainCoinStrategy);

  constructor(
    protected readonly assetService: AssetService,
    protected readonly dexDeFiChainService: DexDeFiChainService,
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    protected readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(dexDeFiChainService, liquidityOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.DEFICHAIN;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  async sellLiquidity(request: SellLiquidityRequest): Promise<void> {
    const dfiToken = await this.getDfiToken();
    const order = this.liquidityOrderFactory.createSellOrder(
      request,
      Blockchain.DEFICHAIN,
      this.constructor.name,
      dfiToken,
    );

    try {
      await this.bookLiquiditySell(order);
      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      await this.handleSellLiquidityError(request, e);
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

    this.logger.verbose(
      `Booked sell of ${referenceAmount} ${referenceAsset.dexName} coin liquidity. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    order.addBlockchainTransactionMetadata(txId);
  }
}
