import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/ain/services/crypto.service';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { In } from 'typeorm';
import { Asset } from './asset.entity';

@Injectable()
export class AssetService {
  constructor(private assetRepo: AssetRepository) {}

  async getAllAsset(blockchains: Blockchain[]): Promise<Asset[]> {
    blockchains ??= [Blockchain.DEFICHAIN];
    return this.assetRepo.find({ where: { blockchain: In(blockchains) } });
  }

  async getAsset(id: number): Promise<Asset> {
    return this.assetRepo.findOne(id);
  }

  async getAssetByDexName(name: string, isToken?: boolean): Promise<Asset> {
    if (name === 'DFI' && isToken) name = 'DFI-Token';
    return this.assetRepo.findOne({ where: { dexName: name } });
  }
}
