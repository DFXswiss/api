import { Injectable, NotFoundException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { In } from 'typeorm';
import { Asset, AssetType } from './asset.entity';

export interface AssetQuery {
  dexName: string;
  blockchain: Blockchain;
  type: AssetType;
}

const MainLayerBlockchain: { [name in string]: Blockchain } = {
  BTC: Blockchain.BITCOIN,
  XMR: Blockchain.MONERO,
  ETH: Blockchain.ETHEREUM,
  BNB: Blockchain.BINANCE_SMART_CHAIN,
};

@Injectable()
export class AssetService {
  constructor(private assetRepo: AssetRepository) {}

  async getAllAsset(blockchains: Blockchain[]): Promise<Asset[]> {
    return blockchains.length > 0 ? this.assetRepo.findBy({ blockchain: In(blockchains) }) : this.assetRepo.find();
  }

  async getAssetById(id: number): Promise<Asset> {
    return this.assetRepo.findOneBy({ id });
  }

  async getAssetByChainId(blockchain: Blockchain, chainId: string): Promise<Asset> {
    return this.assetRepo.findOneBy({ blockchain, chainId });
  }

  async getAssetByQuery(query: AssetQuery): Promise<Asset> {
    return this.assetRepo.findOneBy(query);
  }

  async getNativeAsset(blockchain: Blockchain): Promise<Asset> {
    return this.assetRepo.findOneBy({ blockchain, type: AssetType.COIN });
  }

  async getNativeMainLayerAsset(dexName: string): Promise<Asset> {
    const blockchain = MainLayerBlockchain[dexName];
    if (!blockchain) throw new NotFoundException('Main layer blockchain not found');
    return this.assetRepo.findOneBy({ dexName, blockchain, type: AssetType.COIN });
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

  async updatePrice(assetId: number, usdPrice: number) {
    await this.assetRepo.update(assetId, { approxPriceUsd: usdPrice });
  }

  //*** UTILITY METHODS ***//

  getByQuerySync(assets: Asset[], { dexName, blockchain, type }: AssetQuery): Asset | undefined {
    return assets.find((a) => a.dexName === dexName && a.blockchain === blockchain && a.type === type);
  }

  getByChainIdSync(assets: Asset[], blockchain: Blockchain, chainId: string): Asset | undefined {
    return assets.find((a) => a.blockchain === blockchain && a.type === AssetType.TOKEN && a.chainId === chainId);
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
