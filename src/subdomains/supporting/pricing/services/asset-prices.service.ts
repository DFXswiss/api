import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { UpdateResult } from 'src/shared/models/entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { In, MoreThanOrEqual } from 'typeorm';
import { AssetPrice } from '../domain/entities/asset-price.entity';
import { AssetPriceRepository } from '../repositories/asset-price.repository';
import { FiatPriceCurrency, PricingService } from './pricing.service';

@Injectable()
export class AssetPricesService {
  private readonly logger = new DfxLogger(AssetPricesService);

  constructor(
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly pricingService: PricingService,
    private readonly assetPriceRepo: AssetPriceRepository,
  ) {}

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.PRICING, timeout: 3600 })
  async updatePrices() {
    const assetsToUpdate = await this.assetService.getPricedAssets();
    const updates: UpdateResult<Asset>[] = [];

    // fetch prices
    for (const asset of assetsToUpdate) {
      try {
        const usdPrice = await this.pricingService.getFiatPrice(asset, FiatPriceCurrency.USD, false);
        const chfPrice = await this.pricingService.getFiatPrice(asset, FiatPriceCurrency.CHF, false);
        const eurPrice = await this.pricingService.getFiatPrice(asset, FiatPriceCurrency.EUR, false);

        updates.push(asset.updatePrice(usdPrice.convert(1), chfPrice.convert(1), eurPrice.convert(1)));

        if (asset.type === AssetType.COIN || asset.type === AssetType.TOKEN) await this.saveAssetPrices(asset);
      } catch (e) {
        this.logger.error(`Failed to update price of asset ${asset.uniqueName}:`, e);
      }
    }

    // update DB
    await this.assetService.updatePrices(updates);
  }

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.PRICING, timeout: 3600 })
  async updatePaymentPrices() {
    const relevantFiats = await this.fiatService.getActiveFiat();
    const relevantAssets = await this.assetService.getPaymentAssets();

    for (const asset of relevantAssets) {
      try {
        await Promise.all(relevantFiats.map((f) => this.pricingService.getPrice(asset, f, false)));
      } catch (e) {
        this.logger.error(`Failed to update price of payment asset ${asset.uniqueName}:`, e);
      }
    }
  }

  async getAssetPrices(assets: Asset[], fromDate: Date): Promise<AssetPrice[]> {
    return this.assetPriceRepo.find({
      where: { asset: { id: In(assets.map((a) => a.id)) }, created: MoreThanOrEqual(fromDate) },
      relations: { asset: true },
      order: { created: 'ASC' },
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

  calculateMeanPrice(todayPrice: number, price: number): number {
    const count = new Date().getHours() + 1;
    return Util.round((todayPrice * (count - 1) + price) / count, 8);
  }
}
