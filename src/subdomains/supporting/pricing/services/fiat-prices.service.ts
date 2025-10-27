import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { PriceCurrency, PriceValidity, PricingService } from './pricing.service';

@Injectable()
export class FiatPricesService {
  private readonly logger = new DfxLogger(FiatPricesService);

  constructor(private readonly fiatService: FiatService, private readonly pricingService: PricingService) {}

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.PRICING, timeout: 3600 })
  async updatePrices() {
    const fiats = await this.fiatService.getActiveFiat();

    for (const fiat of fiats) {
      try {
        const chfPrice = await this.pricingService.getPrice(fiat, PriceCurrency.CHF, PriceValidity.VALID_ONLY);

        await this.fiatService.updatePrice(fiat.id, chfPrice.convert(1));
      } catch (e) {
        this.logger.error(`Failed to update price of fiat ${fiat.name}:`, e);
      }
    }
  }
}
