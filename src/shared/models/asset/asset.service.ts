import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { In } from 'typeorm';
import { Asset, AssetType } from './asset.entity';

export interface AssetQuery {
  dexName: string;
  blockchain: string;
  type: AssetType;
  chainId?: string | null;
}

@Injectable()
export class AssetService {
  constructor(private assetRepo: AssetRepository) {}

  async getAllAsset(blockchains: Blockchain[]): Promise<Asset[]> {
    return blockchains.length > 0
      ? this.assetRepo.find({ where: { blockchain: In(blockchains) } })
      : this.assetRepo.find();
  }

  async getAssetById(id: number): Promise<Asset> {
    return this.assetRepo.findOne(id);
  }

  async getAssetByQuery(query: AssetQuery): Promise<Asset> {
    return this.assetRepo.findOne({ where: query });
  }

  //*** UTILITY METHODS ***//

  getByQuerySync(assets: Asset[], { dexName, blockchain, type, chainId }: AssetQuery): Asset | undefined {
    return assets.find((a) => {
      const queryMatch = a.dexName === dexName && a.blockchain === blockchain && a.type === type;
      const chainIdMatch = a.chainId && chainId ? a.chainId.toLowerCase() === chainId.toLowerCase() : true;

      return queryMatch && chainIdMatch;
    });
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
}
