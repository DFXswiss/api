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

  async getAssetPricesAt(date: Date): Promise<AssetPrice[]> {
    return this.assetPriceRepo
      .createQueryBuilder('assetPrice')
      .where('CAST(assetPrice.created AS DATE) = CAST(:date AS DATE)', { date })
      .getMany();
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

  async saveAssetPrices(asset: Asset): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayPrice = await this.assetPriceRepo.findOne({
      where: {
        asset: { id: asset.id },
        created: MoreThanOrEqual(today),
      },
    });

    if (todayPrice) {
      const meanUsdPrice = this.calculateMeanPrice(todayPrice.priceUsd, asset.approxPriceUsd);
      const meanChfPrice = this.calculateMeanPrice(todayPrice.priceChf, asset.approxPriceChf);
      const meanEurPrice = this.calculateMeanPrice(todayPrice.priceEur, asset.approxPriceEur);

      await this.assetPriceRepo.update(todayPrice.id, {
        priceUsd: meanUsdPrice,
        priceChf: meanChfPrice,
        priceEur: meanEurPrice,
      });
    } else {
      const assetPrice = this.assetPriceRepo.create({
        asset,
        priceUsd: asset.approxPriceUsd,
        priceChf: asset.approxPriceChf,
        priceEur: asset.approxPriceEur,
      });
      await this.assetPriceRepo.save(assetPrice);
    }
  }

  async getAssetPriceAt(asset: Asset, date: Date): Promise<AssetPrice> {
    return this.assetPriceRepo
      .createQueryBuilder('assetPrice')
      .where('assetPrice.assetId = :assetId', { assetId: asset.id })
      .andWhere('CAST(assetPrice.created AS DATE) = CAST(:date AS DATE)', { date })
      .getOne();
  }
}
