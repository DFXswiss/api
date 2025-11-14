import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { In, MoreThanOrEqual } from 'typeorm';
import { AssetPrice } from '../domain/entities/asset-price.entity';
import { AssetPriceRepository } from '../repositories/asset-price.repository';

@Injectable()
export class AssetPricesService {
  constructor(private readonly assetPriceRepo: AssetPriceRepository) {}

  async getAssetPrices(assets: Asset[], fromDate: Date): Promise<AssetPrice[]> {
    return this.assetPriceRepo.find({
      where: { asset: { id: In(assets.map((a) => a.id)) }, created: MoreThanOrEqual(fromDate) },
      relations: { asset: true },
      order: { created: 'ASC' },
    });
  }

  async getAssetPricesAt(date: Date): Promise<AssetPrice[]> {
    return this.assetPriceRepo
      .createQueryBuilder('assetPrice')
      .where('CAST(assetPrice.created AS DATE) = CAST(:date AS DATE)', { date })
      .getMany();
  }

  async getAssetPriceAt(asset: Asset, date: Date): Promise<AssetPrice> {
    return this.assetPriceRepo
      .createQueryBuilder('assetPrice')
      .where('assetPrice.assetId = :assetId', { assetId: asset.id })
      .andWhere('CAST(assetPrice.created AS DATE) = CAST(:date AS DATE)', { date })
      .getOne();
  }
}
