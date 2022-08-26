import { Injectable } from '@nestjs/common';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { Asset } from './asset.entity';

export interface AssetQuery {
  dexName: string;
  blockchain: string;
  isToken?: boolean;
}

@Injectable()
export class AssetService {
  constructor(private assetRepo: AssetRepository) {}

  async getAllAsset(): Promise<Asset[]> {
    return this.assetRepo.find();
  }

  async getAssetById(id: number): Promise<Asset> {
    return this.assetRepo.findOne(id);
  }

  async getAssetByQuery(query: AssetQuery): Promise<Asset> {
    let { dexName } = query;
    const { blockchain, isToken } = query;

    if (dexName === 'DFI' && isToken) dexName = 'DFI-Token';
    return this.assetRepo.findOne({ where: { dexName, blockchain } });
  }
}
