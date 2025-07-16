import { BadRequestException, Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { Util } from 'src/shared/utils/util';
import { FindOptionsRelations, FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { UpdateResult } from '../entity';
import { Asset, AssetCategory, AssetType } from './asset.entity';
import { UpdateAssetDto } from './dto/update-asset.dto';

export interface AssetQuery {
  name: string;
  blockchain: Blockchain;
  type: AssetType;
}

@Injectable()
export class AssetService {
  constructor(private assetRepo: AssetRepository) {}

  async updateAsset(id: number, dto: UpdateAssetDto): Promise<Asset> {
    const entity = await this.assetRepo.findOneBy({ id });
    if (!entity) throw new BadRequestException('Asset not found');

    Object.assign(entity, dto);

    return this.assetRepo.save(entity);
  }

  async getAllAssets(relations?: FindOptionsRelations<Asset>) {
    return this.assetRepo.findCached('all', { relations });
  }

  async getAssetsWith(relations?: FindOptionsRelations<Asset>) {
    return this.assetRepo.find({ relations });
  }

  async getAllBlockchainAssets(
    blockchains: Blockchain[],
    includePrivate = true,
    relations?: FindOptionsRelations<Asset>,
  ): Promise<Asset[]> {
    const search: FindOptionsWhere<Asset> = {};
    search.blockchain = blockchains.length > 0 ? In(blockchains) : Not(Blockchain.DEFICHAIN);
    !includePrivate && (search.category = Not(AssetCategory.PRIVATE));

    return this.assetRepo.findCached(JSON.stringify({ where: search, relations }), { where: search, relations });
  }

  async getPricedAssets(): Promise<Asset[]> {
    return this.assetRepo.findCached('priced', {
      where: { priceRule: Not(IsNull()) },
      order: { priceRule: { id: 'ASC' } },
    });
  }

  async getPaymentAssets(): Promise<Asset[]> {
    return this.assetRepo.findCachedBy('payment', { paymentEnabled: true });
  }

  async getAssetById(id: number): Promise<Asset> {
    return this.assetRepo.findOneCachedBy(`${id}`, { id });
  }

  async getAssetByChainId(blockchain: Blockchain, chainId: string): Promise<Asset> {
    return this.assetRepo.findOneCachedBy(`${blockchain}-${chainId}`, { blockchain, chainId });
  }

  async getAssetByUniqueName(uniqueName: string): Promise<Asset> {
    return this.assetRepo.findOneCachedBy(uniqueName, { uniqueName });
  }

  async getAssetByQuery(query: AssetQuery): Promise<Asset> {
    return this.assetRepo.findOneCachedBy(`${query.name}-${query.blockchain}-${query.type}`, query);
  }

  async getAssetsByName(name: string): Promise<Asset[]> {
    return this.assetRepo.findCachedBy(`${name}`, { name });
  }

  async getNativeAsset(blockchain: Blockchain): Promise<Asset> {
    return this.assetRepo.findOneCachedBy(`native-${blockchain}`, { blockchain, type: AssetType.COIN });
  }

  async getSellableBlockchains(): Promise<Blockchain[]> {
    return this.assetRepo
      .findCachedBy('sellable', { sellable: true })
      .then((assets) => Array.from(new Set(assets.map((a) => a.blockchain))));
  }

  async updatePrices(updates: UpdateResult<Asset>[]): Promise<void> {
    for (const update of updates) {
      await this.assetRepo.update(...update);
    }

    this.assetRepo.invalidateCache();
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

  getByQuerySync(assets: Asset[], { name, blockchain, type }: AssetQuery): Asset | undefined {
    return assets.find((a) => a.name === name && a.blockchain === blockchain && a.type === type);
  }

  getByChainIdSync(assets: Asset[], blockchain: Blockchain, chainId: string): Asset | undefined {
    return assets.find(
      (a) => a.blockchain === blockchain && a.type === AssetType.TOKEN && Util.equalsIgnoreCase(a.chainId, chainId),
    );
  }

  async getEthCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'ETH',
      blockchain: Blockchain.ETHEREUM,
      type: AssetType.COIN,
    });
  }

  async getBnbCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'BNB',
      blockchain: Blockchain.BINANCE_SMART_CHAIN,
      type: AssetType.COIN,
    });
  }

  async getArbitrumCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'ETH',
      blockchain: Blockchain.ARBITRUM,
      type: AssetType.COIN,
    });
  }

  async getOptimismCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'ETH',
      blockchain: Blockchain.OPTIMISM,
      type: AssetType.COIN,
    });
  }

  async getPolygonCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'POL',
      blockchain: Blockchain.POLYGON,
      type: AssetType.COIN,
    });
  }

  async getBaseCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'ETH',
      blockchain: Blockchain.BASE,
      type: AssetType.COIN,
    });
  }

  async getGnosisCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'xDAI',
      blockchain: Blockchain.GNOSIS,
      type: AssetType.COIN,
    });
  }

  async getBtcCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'BTC',
      blockchain: Blockchain.BITCOIN,
      type: AssetType.COIN,
    });
  }

  async getLightningCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'BTC',
      blockchain: Blockchain.LIGHTNING,
      type: AssetType.COIN,
    });
  }

  async getMoneroCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'XMR',
      blockchain: Blockchain.MONERO,
      type: AssetType.COIN,
    });
  }

  async getSolanaCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      name: 'SOL',
      blockchain: Blockchain.SOLANA,
      type: AssetType.COIN,
    });
  }
}
