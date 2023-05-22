import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PriceProviderService } from './price-provider.service';
import { Lock } from 'src/shared/utils/lock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';

@Injectable()
export class AssetPricesService {
  private readonly logger = new DfxLogger(AssetPricesService);

  constructor(
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly priceProvider: PriceProviderService,
  ) {}

  // --- JOBS --- //
  @Cron(CronExpression.EVERY_30_MINUTES)
  @Lock(3600)
  async updateUsdValues() {
    if (Config.processDisabled(Process.PRICING)) return;

    const usd = await this.fiatService.getFiatByName('USD');
    const assets = await this.assetService.getAllAsset([]);

    for (const asset of assets) {
      try {
        const usdPrice = await this.priceProvider.getPrice(asset, usd);
        await this.assetService.updatePrice(asset.id, 1 / usdPrice.price);
      } catch (e) {
        this.logger.error(`Failed to update price of asset ${asset.uniqueName}:`, e);
      }
    }
  }
}
