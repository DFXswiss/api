import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { TradingRuleService } from 'src/subdomains/core/trading/services/trading-rule.service';
import { LogSeverity } from './log.entity';
import { LogService } from './log.service';

@Injectable()
export class LogJobService {
  private readonly logger = new DfxLogger(LogJobService);

  constructor(
    private readonly tradingRuleService: TradingRuleService,
    private readonly assetService: AssetService,
    private readonly liqManagementBalanceService: LiquidityManagementBalanceService,
    private readonly logService: LogService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async saveTradingLog() {
    if (DisabledProcess(Process.TRADING_LOG)) return;

    try {
      const tradingOrders = await this.tradingRuleService.getCurrentTradingOrders().then((t) =>
        t.map((o) => {
          return {
            ...o,
            assetIn: o.assetIn.id,
            assetOut: o.assetOut.id,
            tradingRule: o.tradingRule.id,
          };
        }),
      );
      const assets = await this.assetService
        .getAllAssets()
        .then((assets) => assets.filter((a) => a.blockchain !== Blockchain.DEFICHAIN));
      const liqBalances = await this.liqManagementBalanceService.getAllLiqBalancesForAssets(assets.map((a) => a.id));

      await this.logService.create({
        system: 'LogService',
        subsystem: 'TradingLog',
        severity: LogSeverity.INFO,
        message: JSON.stringify({
          assets: assets.map((a) => {
            return {
              id: a.id,
              approxPriceChf: a.approxPriceChf,
              approxPriceUsd: a.approxPriceUsd,
              balance: liqBalances.find((b) => b.asset.id === a.id)?.amount,
            };
          }),
          tradings: tradingOrders,
        }),
      });
    } catch (e) {
      this.logger.error('Error in creating trading log:', e);
    }
  }
}
