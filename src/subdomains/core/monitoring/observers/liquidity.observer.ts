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
import { LiquidityManagementOrderStatus, LiquidityManagementRuleStatus } from '../../liquidity-management/enums';
import { TradingOrderStatus, TradingRuleStatus } from '../../trading/enums';

interface LiquidityData {
  stuckLiquidityOrderCount: number;
  stuckTradingOrderCount: number;
  stuckTradingRuleCount: number;
  stuckLmOrderCount: number;
  stuckLmRuleCount: number;
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
      stuckLiquidityOrderCount: await this.repos.liquidityOrder.countSimpleBy({
        isComplete: false,
        updated: LessThan(Util.minutesBefore(60)),
      }),
      stuckTradingOrderCount: await this.repos.tradingOrder.countSimpleBy({
        status: In([TradingOrderStatus.CREATED, TradingOrderStatus.IN_PROGRESS]),
        created: LessThan(Util.minutesBefore(15)),
      }),
      stuckTradingRuleCount: await this.repos.tradingRule.countSimpleBy({
        status: In([TradingRuleStatus.PAUSED, TradingRuleStatus.PROCESSING]),
        updated: LessThan(Util.minutesBefore(60)),
      }),
      stuckLmOrderCount: await this.repos.lmOrder.countSimpleBy({
        status: In([LiquidityManagementOrderStatus.CREATED, LiquidityManagementOrderStatus.IN_PROGRESS]),
        created: LessThan(Util.minutesBefore(30)),
      }),
      stuckLmRuleCount: await this.repos.lmRule.countSimpleBy({
        status: In([LiquidityManagementRuleStatus.PAUSED, LiquidityManagementRuleStatus.PROCESSING]),
        updated: LessThan(Util.minutesBefore(60)),
      }),
      safetyModeActive: this.processService.isSafetyModeActive(),
      binanceSyncDelay: Math.abs(Util.minutesDiff(lastBinanceTx?.externalCreated, binance?.updated)),
      krakenSyncDelay: Math.abs(Util.minutesDiff(lastKrakenTx?.externalCreated, kraken?.updated)),
    };
  }
}
