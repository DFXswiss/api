import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { PricingService } from './pricing.service';

@Injectable()
export class FiatPricesService {
  private readonly logger: DfxLogger;

  constructor(
    readonly loggerFactory: LoggerFactory,
    private readonly fiatService: FiatService,
    private readonly pricingService: PricingService,
  ) {
    this.logger = loggerFactory.create(FiatPricesService);
  }

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.PRICING, timeout: 3600 })
  async updatePrices() {
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
