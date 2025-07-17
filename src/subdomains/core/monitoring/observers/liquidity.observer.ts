import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { ExchangeTxService } from 'src/integration/exchange/services/exchange-tx.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process, ProcessService } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { In, LessThan } from 'typeorm';
import { TradingOrderStatus, TradingRuleStatus } from '../../trading/enums';

interface LiquidityData {
  stuckTradingOrderCount: number;
  stuckTradingRuleCount: number;
  stuckLiquidityOrderCount: number;
  safetyModeActive: boolean;
  krakenSyncDelay: number; // min
  binanceSyncDelay: number; // min
}

@Injectable()
export class LiquidityObserver extends MetricObserver<LiquidityData> {
  protected readonly logger = new DfxLogger(LiquidityObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly repos: RepositoryFactory,
    private readonly processService: ProcessService,
    private readonly assetService: AssetService,
    private readonly exchangeTxService: ExchangeTxService,
  ) {
    super(monitoringService, 'liquidity', 'trading');
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.MONITORING, timeout: 1800 })
  async fetch() {
    const data = await this.getLiquidityData();

    this.emit(data);

    return data;
  }

  // --- HELPER METHODS --- //

  private async getLiquidityData(): Promise<LiquidityData> {
    const binanceLiqBalances = await this.assetService
      .getAllBlockchainAssets([Blockchain.BINANCE], undefined, { balance: true })
      .then((asset) => asset.filter((a) => a.balance).map((a) => a.balance));

    const binance = Util.sort(binanceLiqBalances, 'updated', 'DESC')[0];

    const krakenLiqBalances = await this.assetService
      .getAllBlockchainAssets([Blockchain.KRAKEN], undefined, { balance: true })
      .then((asset) => asset.filter((a) => a.balance).map((a) => a.balance));

    const kraken = Util.sort(krakenLiqBalances, 'updated', 'DESC')[0];

    const lastBinanceTx = await this.exchangeTxService.getLastExchangeTx(ExchangeName.BINANCE);
    const lastKrakenTx = await this.exchangeTxService.getLastExchangeTx(ExchangeName.KRAKEN);

    return {
      stuckTradingOrderCount: await this.repos.tradingOrder.countBy({
        status: In([TradingOrderStatus.CREATED, TradingOrderStatus.IN_PROGRESS]),
        created: LessThan(Util.minutesBefore(15)),
      }),
      stuckTradingRuleCount: await this.repos.tradingRule.countBy({
        status: In([TradingRuleStatus.PAUSED, TradingRuleStatus.PROCESSING]),
        updated: LessThan(Util.minutesBefore(30)),
      }),
      stuckLiquidityOrderCount: await this.repos.liquidityOrder.countBy({
        isComplete: false,
        updated: LessThan(Util.minutesBefore(30)),
      }),
      safetyModeActive: this.processService.isSafetyModeActive(),
      binanceSyncDelay: Math.abs(Util.minutesDiff(lastBinanceTx?.created, binance.updated)),
      krakenSyncDelay: Math.abs(Util.minutesDiff(lastKrakenTx?.created, kraken.updated)),
    };
  }
}
