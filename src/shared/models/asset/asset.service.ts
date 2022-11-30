import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { In } from 'typeorm';
import { Asset, AssetType } from './asset.entity';

export interface AssetQuery {
  dexName: string;
  blockchain: string;
  type: AssetType;
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

  async getBtcCoin(): Promise<Asset> {
    return this.getAssetByQuery({
      dexName: 'BTC',
      blockchain: Blockchain.BITCOIN,
      type: AssetType.COIN,
    });
  }
}
