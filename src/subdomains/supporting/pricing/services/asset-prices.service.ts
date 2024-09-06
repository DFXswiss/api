import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { PricingService } from './pricing.service';

@Injectable()
export class AssetPricesService {
  private readonly logger = new DfxLogger(AssetPricesService);

  constructor(
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly pricingService: PricingService,
  ) {}

  // --- JOBS --- //
  @Cron(CronExpression.EVERY_HOUR)
  @Lock(3600)
  async updatePrices() {
    if (DisabledProcess(Process.PRICING)) return;

    const usd = await this.fiatService.getFiatByName('USD');
    const chf = await this.fiatService.getFiatByName('CHF');

    const assetsToUpdate = await this.assetService.getPricedAssets();

    for (const asset of assetsToUpdate) {
      try {
        const usdPrice = await this.pricingService.getPrice(asset, usd, false);
        const chfPrice = await this.pricingService.getPrice(asset, chf, false);

        await this.assetService.updatePrice(asset.id, usdPrice.convert(1), chfPrice.convert(1));
      } catch (e) {
        this.logger.error(`Failed to update price of asset ${asset.uniqueName}:`, e);
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock(3600)
  async updatePaymentPrices() {
    if (DisabledProcess(Process.PRICING)) return;

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
}
