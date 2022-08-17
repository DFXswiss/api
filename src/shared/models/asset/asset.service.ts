import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/ain/node/node.service';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { Asset } from './asset.entity';

@Injectable()
export class AssetService {
  constructor(private assetRepo: AssetRepository) {}

  async getAllAsset(blockchain: Blockchain): Promise<Asset[]> {
    return this.assetRepo.find({ where: { blockchain } });
  }

  async getAsset(id: number): Promise<Asset> {
    return this.assetRepo.findOne(id);
  }

  async getAssetByDexName(name: string, isToken?: boolean): Promise<Asset> {
    if (name === 'DFI' && isToken) name = 'DFI-Token';
    return this.assetRepo.findOne({ where: { dexName: name } });
  }
}
