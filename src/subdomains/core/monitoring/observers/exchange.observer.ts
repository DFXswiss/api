import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { MoreThan } from 'typeorm';

interface ExchangeData {
  name: string;
  volume30: number; //volume of the last 30 days
}

interface ExchangeDeviationData {
  name: string;
  deviation: number; // deviation of exchange pair to reference price
}

@Injectable()
export class ExchangeObserver extends MetricObserver<ExchangeData[]> {
  protected readonly logger = new DfxLogger(ExchangeObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly repos: RepositoryFactory,
    private readonly pricingService: PricingService,
  ) {
    super(monitoringService, 'exchange', 'volume');
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.MONITORING, timeout: 1800 })
  async fetch() {
    if (DisabledProcess(Process.MONITORING)) return;

    const data = [];
    data.push(await this.getKraken());
    data.push(await this.getBinance());
    data.push(await this.getXtPriceDeviation());
    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getXtPriceDeviation(): Promise<ExchangeDeviationData[]> {
    const xtDeurUsdtPrice = await this.pricingService.getPriceFrom(PriceSource.XT, 'DEURO', 'USDT');
    const xtDeurBtcPrice = await this.pricingService.getPriceFrom(PriceSource.XT, 'DEURO', 'BTC');
    const xtDepsUsdtPrice = await this.pricingService.getPriceFrom(PriceSource.XT, 'DEPS', 'USDT');
    const xtDepsBtcPrice = await this.pricingService.getPriceFrom(PriceSource.XT, 'DEPS', 'BTC');

    const referenceDeurUsdtPrice = await this.pricingService.getPriceFrom(PriceSource.DEURO, 'DEURO', 'USDT');
    const referenceDeurBtcPrice = await this.pricingService.getPriceFrom(PriceSource.DEURO, 'DEURO', 'BTC');
    const referenceDepsUsdtPrice = await this.pricingService.getPriceFrom(PriceSource.DEURO, 'DEPS', 'USDT');
    const referenceDepsBtcPrice = await this.pricingService.getPriceFrom(PriceSource.DEURO, 'DEPS', 'BTC');

    return [
      {
        name: 'XT-dEURO-USDT',
        deviation: Util.round(xtDeurUsdtPrice.price / referenceDeurUsdtPrice.price - 1, 3),
      },
      {
        name: 'XT-dEURO-BTC',
        deviation: Util.round(xtDeurBtcPrice.price / referenceDeurBtcPrice.price - 1, 3),
      },
      {
        name: 'XT-DEPS-USDT',
        deviation: Util.round(xtDepsUsdtPrice.price / referenceDepsUsdtPrice.price - 1, 3),
      },
      {
        name: 'XT-DEPS-BTC',
        deviation: Util.round(xtDepsBtcPrice.price / referenceDepsBtcPrice.price - 1, 3),
      },
    ];
  }

  private async getKraken(): Promise<ExchangeData> {
    const volume30 = await this.getVolume30(ExchangeName.KRAKEN);
    return {
      name: 'Kraken',
      volume30,
    };
  }

  private async getBinance(): Promise<ExchangeData> {
    const volume30 = await this.getVolume30(ExchangeName.BINANCE);
    return {
      name: 'Binance',
      volume30,
    };
  }

  private async getVolume30(exchange: ExchangeName): Promise<number> {
    return this.repos.exchangeTx.sum('amountChf', {
      exchange,
      type: ExchangeTxType.TRADE,
      created: MoreThan(Util.daysBefore(30)),
    });
  }
}
