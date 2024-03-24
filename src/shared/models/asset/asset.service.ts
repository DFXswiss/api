import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { Asset, AssetType } from './asset.entity';

export interface AssetQuery {
  dexName: string;
  blockchain: Blockchain;
  type: AssetType;
}

@Injectable()
export class AssetService {
  private readonly cache = new AsyncCache<Asset>(CacheItemResetPeriod.EVERY_5_MINUTE);

  constructor(private assetRepo: AssetRepository) {}

  async getAllAsset(blockchains: Blockchain[]): Promise<Asset[]> {
    return blockchains.length > 0 ? this.assetRepo.findBy({ blockchain: In(blockchains) }) : this.assetRepo.find();
  }

  async getActiveAsset(): Promise<Asset[]> {
    return this.assetRepo.findBy([
      { buyable: true },
      { sellable: true },
      { instantBuyable: true },
      { instantSellable: true },
      { cardBuyable: true },
      { cardSellable: true },
    ]);
  }

  async getAssetById(id: number): Promise<Asset> {
    return this.cache.get(`${id}`, () => this.assetRepo.findOneBy({ id }));
  }

  async getAssetByChainId(blockchain: Blockchain, chainId: string): Promise<Asset> {
    return this.cache.get(`${blockchain}-${chainId}`, () => this.assetRepo.findOneBy({ blockchain, chainId }));
  }

  async getAssetByUniqueName(uniqueName: string): Promise<Asset> {
    return this.cache.get(uniqueName, () => this.assetRepo.findOneBy({ uniqueName }));
  }

  async getAssetByQuery(query: AssetQuery): Promise<Asset> {
    return this.cache.get(`${query.dexName}-${query.blockchain}-${query.type}`, () => this.assetRepo.findOneBy(query));
  }

  async getNativeAsset(blockchain: Blockchain): Promise<Asset> {
    return this.cache.get(`native-${blockchain}`, () => this.assetRepo.findOneBy({ blockchain, type: AssetType.COIN }));
  }

  async getSellableBlockchains(): Promise<Blockchain[]> {
    return this.assetRepo
      .createQueryBuilder('asset')
      .select('asset.blockchain', 'blockchain')
      .where('asset.sellable = 1')
      .distinct()
      .getRawMany<{ blockchain: Blockchain }>()
      .then((r) => r.map((a) => a.blockchain));
  }

  async updatePrice(assetId: number, usdPrice: number, chfPrice: number) {
    await this.assetRepo.update(assetId, { approxPriceUsd: usdPrice, approxPriceChf: chfPrice });
  }

  async getAssetsUsedOn(exchange: string): Promise<string[]> {
    return this.assetRepo
      .createQueryBuilder('asset')
      .select('DISTINCT asset.name', 'name')
      .innerJoin('asset.liquidityManagementRule', 'lmRule')
      .innerJoin('lmRule.deficitStartAction', 'deficitAction')
      .where('asset.buyable = 1')
      .andWhere('deficitAction.system = :exchange', { exchange })
      .getRawMany<{ name: string }>()
      .then((l) => l.map((a) => a.name));
  }

  //*** UTILITY METHODS ***//

  getByQuerySync(assets: Asset[], { dexName, blockchain, type }: AssetQuery): Asset | undefined {
    return assets.find((a) => a.dexName === dexName && a.blockchain === blockchain && a.type === type);
  }

  getByChainIdSync(assets: Asset[], blockchain: Blockchain, chainId: string): Asset | undefined {
    return assets.find(
      (a) => a.blockchain === blockchain && a.type === AssetType.TOKEN && Util.equalsIgnoreCase(a.chainId, chainId),
    );
  }

  async getDfiCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'DFI',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.COIN,
    });
  }

  async getDfiToken(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'DFI',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });
  }

  async getEthCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'ETH',
      blockchain: Blockchain.ETHEREUM,
      type: AssetType.COIN,
    });
  }

  async getBnbCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'BNB',
      blockchain: Blockchain.BINANCE_SMART_CHAIN,
      type: AssetType.COIN,
    });
  }

  async getArbitrumCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'ETH',
      blockchain: Blockchain.ARBITRUM,
      type: AssetType.COIN,
    });
  }

  async getOptimismCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'ETH',
      blockchain: Blockchain.OPTIMISM,
      type: AssetType.COIN,
    });
  }

  async getPolygonCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'MATIC',
      blockchain: Blockchain.POLYGON,
      type: AssetType.COIN,
    });
  }

  async getBaseCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'ETH',
      blockchain: Blockchain.BASE,
      type: AssetType.COIN,
    });
  }

  async getBtcCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'BTC',
      blockchain: Blockchain.BITCOIN,
      type: AssetType.COIN,
    });
  }

  async getLightningCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'BTC',
      blockchain: Blockchain.LIGHTNING,
      type: AssetType.COIN,
    });
  }

  async getMoneroCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'XMR',
      blockchain: Blockchain.MONERO,
      type: AssetType.COIN,
    });
  }
}
