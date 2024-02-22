import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { PricingService } from './pricing.service';

@Injectable()
export class FiatPricesService {
  private readonly logger = new DfxLogger(FiatPricesService);

  constructor(private readonly fiatService: FiatService, private readonly pricingService: PricingService) {}

  // --- JOBS --- //
  @Cron(CronExpression.EVERY_HOUR)
  @Lock(3600)
  async updatePrices() {
    if (DisabledProcess(Process.PRICING)) return;

    const chf = await this.fiatService.getFiatByName('CHF');

    const fiats = await this.fiatService.getActiveFiat();

    for (const fiat of fiats) {
      try {
        const chfPrice = await this.pricingService.getPrice(fiat, chf, false);

        await this.fiatService.updatePrice(fiat.id, chfPrice.convert(1));
      } catch (e) {
        this.logger.error(`Failed to update price of fiat ${fiat.name}:`, e);
      }
    }
  }
}
