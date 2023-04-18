import { Injectable, NotImplementedException } from '@nestjs/common';
import { WhaleClient } from 'src/integration/blockchain/ain/whale/whale-client';
import { WhaleService } from 'src/integration/blockchain/ain/whale/whale.service';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Price } from '../../domain/entities/price';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

@Injectable()
export class PriceProviderDeFiChainService {
  private client: WhaleClient;

  constructor(readonly whaleService: WhaleService, private readonly assetService: AssetService) {
    this.client = whaleService.getCurrentClient();
  }

  async getPrice(from: Asset, to: Asset): Promise<Price> {
    if (to.category === AssetCategory.POOL_PAIR)
      throw new NotImplementedException(`Target asset of pool pair is not supported`);

    const price =
      from.category === AssetCategory.POOL_PAIR
        ? await this.getPoolPrice(from, to)
        : await this.getPriceValue(from, to);

    return Price.create(from.dexName, to.dexName, 1 / price);
  }

  // --- HELPER METHODS --- //
  private async getPriceValue(from: Asset, to: Asset): Promise<number> {
    if (from.id === to.id) return 1;

    return this.client.getSwapPrice(from.chainId, to.chainId);
  }

  private async getPoolPrice(from: Asset, to: Asset): Promise<number> {
    const pool = await this.client.getPool(from.chainId);

    const assetA = await this.assetService.getAssetByChainId(Blockchain.DEFICHAIN, pool.tokenA.id);
    const amountA = +pool.tokenA.reserve / +pool.totalLiquidity.token;
    const priceA = await this.getPriceValue(assetA, to);

    const assetB = await this.assetService.getAssetByChainId(Blockchain.DEFICHAIN, pool.tokenB.id);
    const amountB = +pool.tokenB.reserve / +pool.totalLiquidity.token;
    const priceB = await this.getPriceValue(assetB, to);

    return amountA * priceA + amountB * priceB;
  }
}
