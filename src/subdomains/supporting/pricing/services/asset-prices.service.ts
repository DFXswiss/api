import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Between, In, MoreThanOrEqual } from 'typeorm';
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

  async getAssetPriceForDate(assetId: number, date: Date): Promise<AssetPrice | null> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return this.assetPriceRepo.findOne({
      where: {
        asset: { id: assetId },
        created: Between(startOfDay, endOfDay),
      },
    });
  }
}
