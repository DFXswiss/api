import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
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
  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.PRICING, timeout: 3600 })
  async updatePrices() {
    const usd = await this.fiatService.getFiatByName('USD');
    const chf = await this.fiatService.getFiatByName('CHF');
    const eur = await this.fiatService.getFiatByName('EUR');

    const assetsToUpdate = await this.assetService.getPricedAssets();

    for (const asset of assetsToUpdate) {
      try {
        const usdPrice = await this.pricingService.getPrice(asset, usd, false);
        const chfPrice = await this.pricingService.getPrice(asset, chf, false);
        const eurPrice = await this.pricingService.getPrice(asset, eur, false);

        await this.assetService.updatePrice(asset.id, usdPrice.convert(1), chfPrice.convert(1), eurPrice.convert(1));
      } catch (e) {
        this.logger.error(`Failed to update price of asset ${asset.uniqueName}:`, e);
      }
    }
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
}
