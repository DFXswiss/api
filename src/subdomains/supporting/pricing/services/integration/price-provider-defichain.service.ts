import { Injectable } from '@nestjs/common';
import { WhaleClient } from 'src/integration/blockchain/ain/whale/whale-client';
import { WhaleService } from 'src/integration/blockchain/ain/whale/whale.service';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Price } from '../../domain/entities/price';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Config } from 'src/config/config';

type Pool = Asset & { category: AssetCategory.POOL_PAIR };

@Injectable()
export class PriceProviderDeFiChainService {
  private client: WhaleClient;
  private priceCache: AsyncCache<number>;

  constructor(readonly whaleService: WhaleService, private readonly assetService: AssetService) {
    this.client = whaleService.getClient();
    this.priceCache = new AsyncCache(Config.transaction.pricing.refreshRate * 60);
  }

  async getPrice(from: Asset, to: Asset): Promise<Price> {
    const price = await this.getPriceValue(from, to);
    return Price.create(from.dexName, to.dexName, 1 / price);
  }

  // --- HELPER METHODS --- //
  private isPool(asset: Asset): asset is Pool {
    return asset.category === AssetCategory.POOL_PAIR;
  }

  private async getPriceValue(from: Asset, to: Asset): Promise<number> {
    if (from.id === to.id) return 1;

    if (this.isPool(from) && this.isPool(to)) return this.poolPrice(from, to);
    if (this.isPool(from)) return this.fromPoolPrice(from, to);
    if (this.isPool(to)) return this.toPoolPrice(from, to);
    return this.swapPrice(from, to);
  }

  private async swapPrice(from: Asset, to: Asset): Promise<number> {
    if (from.id === to.id) return 1;

    return this.priceCache.get(`${from.chainId}/${to.chainId}`, () =>
      this.client.getSwapPrice(from.chainId, to.chainId),
    );
  }

  private async poolPrice(from: Pool, to: Pool): Promise<number> {
    const { assetB: fromAsset } = await this.getPoolSplit(from);
    const { assetB: toAsset } = await this.getPoolSplit(to);

    const priceA = await this.fromPoolPrice(from, fromAsset);
    const priceSwap = await this.swapPrice(fromAsset, toAsset);
    const priceB = await this.toPoolPrice(toAsset, to);

    return priceA * priceSwap * priceB;
  }

  private async toPoolPrice(from: Asset, to: Pool): Promise<number> {
    const { assetA, amountA, assetB, amountB } = await this.getPoolSplit(to);

    const priceA = await this.swapPrice(from, assetA);
    const priceB = await this.swapPrice(from, assetB);

    return 1 / (amountA / priceA + amountB / priceB);
  }

  private async fromPoolPrice(from: Pool, to: Asset): Promise<number> {
    const { assetA, amountA, assetB, amountB } = await this.getPoolSplit(from);

    const priceA = await this.swapPrice(assetA, to);
    const priceB = await this.swapPrice(assetB, to);

    return amountA * priceA + amountB * priceB;
  }

  private async getPoolSplit(asset: Pool): Promise<{ assetA: Asset; amountA: number; assetB: Asset; amountB: number }> {
    const pool = await this.client.getPool(asset.chainId);
    return {
      assetA: await this.assetService.getAssetByChainId(Blockchain.DEFICHAIN, pool.tokenA.id),
      amountA: +pool.tokenA.reserve / +pool.totalLiquidity.token,
      assetB: await this.assetService.getAssetByChainId(Blockchain.DEFICHAIN, pool.tokenB.id),
      amountB: +pool.tokenB.reserve / +pool.totalLiquidity.token,
    };
  }
}
