import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TradingRuleService } from 'src/subdomains/core/trading/services/trading-rule.service';
import { PayInService } from '../payin/services/payin.service';
import { LogSeverity } from './log.entity';
import { LogService } from './log.service';

type pendingBalance = {
  cryptoInput: number;
  buyFiat: number;
  buyCryptoPass: number;
  buyCrypto: number;
};

type ManualDebtPosition = {
  assetId: number;
  value: number;
};

@Injectable()
export class LogJobService {
  constructor(
    private readonly tradingRuleService: TradingRuleService,
    private readonly assetService: AssetService,
    private readonly liqManagementBalanceService: LiquidityManagementBalanceService,
    private readonly logService: LogService,
    private readonly payInService: PayInService,
    private readonly buyFiatService: BuyFiatService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly settingService: SettingService,
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
    const financialTypeMap = Util.groupBy<Asset, string>(
      assets.filter((a) => a.financialType),
      'financialType',
    );

    const liqBalances = await this.liqManagementBalanceService.getAllLiqBalancesForAssets(assets.map((a) => a.id));
    const pendingPayIns = await this.payInService.getPendingPayIns();
    const pendingBuyFiat = await this.buyFiatService.getPendingTransactions();
    const pendingBuyCrypto = await this.buyCryptoService.getPendingTransactions();
    const manualDebtPositions = await this.settingService.getObj<ManualDebtPosition[]>('balanceLogDebtPositions', []);

    const assetLog = assets.reduce((prev, curr) => {
      const liquidityBalance = liqBalances.find((b) => b.asset.id === curr.id)?.amount ?? 0;
      const manualDebtPosition = manualDebtPositions.find((p) => p.assetId === curr.id)?.value ?? 0;

      const pendingBalance: pendingBalance = {
        cryptoInput: pendingPayIns.reduce((sum, tx) => (sum + tx.asset.id === curr.id ? tx.amount : 0), 0),
        buyFiat: pendingBuyFiat.reduce(
          (sum, tx) => (sum + tx.cryptoInput.asset.id === curr.id ? tx.inputAmount : 0),
          0,
        ),
        buyCrypto: pendingBuyCrypto.reduce(
          (sum, tx) => sum + (!tx.outputAmount && tx.cryptoInput?.asset?.id === curr.id ? tx.inputAmount : 0),
          0,
        ),
        buyCryptoPass: pendingBuyCrypto.reduce(
          (sum, tx) => sum + (tx.outputAmount && tx.outputAsset?.id === curr.id ? tx.outputAmount ?? 0 : 0),
          0,
        ),
      };

      prev[curr.id] = {
        priceChf: curr.approxPriceChf,
        liquidityBalance,
        plusBalance: liquidityBalance,
        manualDebtPosition,
        minusBalance: 0,
        pendingBalance,
      };

      return prev;
    }, {});

    const balancesByFinancialType = Array.from(financialTypeMap.entries()).reduce((acc, [financialType, assets]) => {
      acc[financialType] = {
        financialType,
        plusBalance: assets.reduce(
          (prev, curr) => prev + (liqBalances.find((b) => b.asset.id === curr.id)?.amount ?? 0),
          0,
        ),
        plusBalanceChf: assets.reduce(
          (prev, curr) => prev + (liqBalances.find((b) => b.asset.id === curr.id)?.amount ?? 0) * curr.approxPriceChf,
          0,
        ),
        minusBalance: 0,
        minusBalanceChf: 0,
      };
      return acc;
    }, {});

    await this.logService.create({
      system: 'LogService',
      subsystem: 'FinancialDataLog',
      severity: LogSeverity.INFO,
      message: JSON.stringify({
        assets: assetLog,
        tradings: tradingLog,
        balancesByFinancialType,
      }),
    });
  }
}
