import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isString } from 'class-validator';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { Asset } from './asset.entity';

@Injectable()
export class AssetService {
  constructor(private assetRepo: AssetRepository) {}

  async getAllAsset(): Promise<Asset[]> {
    return this.assetRepo.find();
  }

  async getAsset(id: number): Promise<Asset> {
    return this.assetRepo.findOne(id);
  }

  async getAssetByDexName(name: string, isToken?: boolean): Promise<Asset> {
    if (name === 'DFI' && isToken) name = 'DFI-Token';
    return this.assetRepo.findOne({ where: { dexName: name } });
  }

  // TODO: remove
  async getAssetOld(key: any): Promise<Asset> {
    if (key.key) {
      if (!isNaN(key.key)) {
        const asset = await this.assetRepo.findOne({ id: key.key });

        if (asset) return asset;
      } else if (isString(key.key)) {
        const asset = await this.assetRepo.findOne({ name: key.key });

        if (asset) return asset;

        throw new NotFoundException('Asset not found');
      }
    } else if (!isNaN(key)) {
      const asset = await this.assetRepo.findOne({ id: key });

      if (asset) return asset;
    } else if (isString(key)) {
      const asset = await this.assetRepo.findOne({ name: key });

      if (asset) return asset;

      throw new NotFoundException('Asset not found');
    } else if (key.id) {
      const asset = await this.assetRepo.findOne({ id: key.id });

      if (asset) return asset;

      throw new NotFoundException('Asset not found');
    } else if (key.name) {
      const asset = await this.assetRepo.findOne({ name: key.name });

      if (asset) return asset;

      throw new NotFoundException('Asset not found');
    }

    throw new BadRequestException('Key must be number or string or JSON-Object');
  }
}
