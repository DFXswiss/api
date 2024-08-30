import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { TradingRuleService } from 'src/subdomains/core/trading/services/trading-rule.service';
import { LogSeverity } from './log.entity';
import { LogService } from './log.service';

@Injectable()
export class LogJobService {
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

    // trading
    const tradingLog = await this.tradingRuleService.getCurrentTradingOrders().then((t) =>
      t.reduce((prev, curr) => {
        prev[curr.tradingRule.id] = {
          price1: curr.price1,
          price2: curr.price2,
          price3: curr.price3,
        };

        return prev;
      }, {}),
    );

    // assets
    const assets = await this.assetService
      .getAllAssets()
      .then((assets) => assets.filter((a) => a.blockchain !== Blockchain.DEFICHAIN));
    const financialTypeMap = Util.groupBy(assets, 'financialType');

    const liqBalances = await this.liqManagementBalanceService.getAllLiqBalancesForAssets(assets.map((a) => a.id));

    const assetLog = assets.reduce((prev, curr) => {
      const liquidityBalance = liqBalances.find((b) => b.asset.id === curr.id)?.amount ?? 0;

      prev[curr.id] = {
        priceChf: curr.approxPriceChf,
        liquidityBalance,
        plusBalance: liquidityBalance,
        minusBalance: 0,
      };

      return prev;
    }, {});

    const balancesByFinancialType = Array.from(financialTypeMap.entries()).map(([financialType, assets]) => ({
      financialType,
      plusBalance: assets.reduce(
        (prev, curr) => prev + (liqBalances.find((b) => b.asset.id === curr.id)?.amount ?? 0),
        0,
      ),
      minusBalance: 0,
    }));

    await this.logService.create({
      system: 'LogService',
      subsystem: 'TradingLog',
      severity: LogSeverity.INFO,
      message: JSON.stringify({
        assets: assetLog,
        tradings: tradingLog,
        balancesByFinancialType,
      }),
    });
  }
}
