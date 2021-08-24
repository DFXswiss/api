import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { Asset } from './asset.entity';
import { isString } from 'class-validator';

@EntityRepository(Asset)
export class AssetRepository extends Repository<Asset> {
  async createAsset(createAssetDto: CreateAssetDto): Promise<any> {

    const asset = this.create(createAssetDto);

    try {
      await this.save(asset);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    return asset;
  }

  async getAllAsset(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateAsset(asset: UpdateAssetDto): Promise<any> {
    try {
      const currentAsset = await this.findOne({ id: asset.id });
      if (!currentAsset)
        throw new NotFoundException('No matching asset for id found');

      return Object.assign(currentAsset, await this.save(asset));
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getAsset(key: any): Promise<any> {
    if (key.key) {
      if (!isNaN(key.key)) {
        const asset = await this.findOne({ id: key.key });

        if (asset) return asset;
      } else if (isString(key.key)) {
        const asset = await this.findOne({ name: key.key });

        if (asset) return asset;

        throw new NotFoundException('No matching asset found');
      }
    } else if (!isNaN(key)) {
      const asset = await this.findOne({ id: key });

      if (asset) return asset;
    } else if (isString(key)) {
      const asset = await this.findOne({ name: key });

      if (asset) return asset;

      throw new NotFoundException('No matching asset found');
    } else if (key.id) {
      const asset = await this.findOne({ id: key.id });

      if (asset) return asset;

      throw new NotFoundException('No matching asset found');
    } else if (key.name) {
      const asset = await this.findOne({ name: key.name });

      if (asset) return asset;

      throw new NotFoundException('No matching asset found');
    }

    throw new BadRequestException(
      'key must be number or string or JSON-Object',
    );
  }
}
