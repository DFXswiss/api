import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { LiquidityManagementPipelineService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-pipeline.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TradingRuleService } from 'src/subdomains/core/trading/services/trading-rule.service';
import { BankTxRepeat } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxRepeatService } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturn } from '../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTxReturnService } from '../bank-tx/bank-tx-return/bank-tx-return.service';
import { BankTx, BankTxType } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { PayInService } from '../payin/services/payin.service';
import { LogSeverity } from './log.entity';
import { LogService } from './log.service';

type BalancesByFinancialType = {
  [financialType: string]: {
    plusBalance: number;
    plusBalanceChf: number;
    minusBalance: number;
    minusBalanceChf: number;
  };
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
    private readonly bankTxService: BankTxService,
    private readonly bankTxRepeatService: BankTxRepeatService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly liquidityManagementPipelineService: LiquidityManagementPipelineService,
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
    const pendingBankTx = await this.bankTxService.getPendingTx();
    const pendingBankTxRepeat = await this.bankTxRepeatService.getPendingTx();
    const pendingBankTxReturn = await this.bankTxReturnService.getPendingTx();
    const pendingExchangeOrders = await this.liquidityManagementPipelineService.getPendingTx();
    const manualDebtPositions = await this.settingService.getObj<ManualDebtPosition[]>('balanceLogDebtPositions', []);

    const assetLog = assets.reduce((prev, curr) => {
      const liquidityBalance = liqBalances.find((b) => b.asset.id === curr.id)?.amount ?? 0;
      const manualDebtPosition = manualDebtPositions.find((p) => p.assetId === curr.id)?.value ?? 0;

      const cryptoInput = pendingPayIns.reduce((sum, tx) => (sum + tx.asset.id === curr.id ? tx.amount : 0), 0);
      const exchangeOrders = pendingExchangeOrders.reduce(
        (sum, tx) => (sum + tx.pipeline.rule.targetAsset.id === curr.id ? tx.amount : 0),
        0,
      );

      const { input: buyFiat, output: buyFiatPass } = this.getPendingAmounts([curr], pendingBuyFiat);
      const { input: buyCrypto, output: buyCryptoPass } = this.getPendingAmounts([curr], pendingBuyCrypto);

      const bankTxNull = this.getPendingAmounts(
        [curr],
        pendingBankTx.filter((b) => !b.type),
      ).input;
      const bankTxPending = this.getPendingAmounts(
        [curr],
        pendingBankTx.filter((b) => b.type === BankTxType.PENDING),
      ).input;
      const bankTxUnknown = this.getPendingAmounts(
        [curr],
        pendingBankTx.filter((b) => b.type === BankTxType.UNKNOWN),
      ).input;
      const bankTxGSheet = this.getPendingAmounts(
        [curr],
        pendingBankTx.filter((b) => b.type === BankTxType.GSHEET),
      ).input;

      const bankTxRepeat = this.getPendingAmounts([curr], pendingBankTxRepeat).input;
      const bankTxReturn = this.getPendingAmounts([curr], pendingBankTxReturn).input;

      prev[curr.id] = {
        priceChf: curr.approxPriceChf,
        liquidityBalance,
        plusPendingBalance:
          cryptoInput || exchangeOrders
            ? { cryptoInput: cryptoInput || undefined, exchangeOrders: exchangeOrders || undefined }
            : undefined,
        plusBalance: liquidityBalance + cryptoInput,
        manualDebtPosition: manualDebtPosition || undefined,
        minusPendingBalance:
          buyFiat ||
          buyFiatPass ||
          buyCrypto ||
          buyCryptoPass ||
          bankTxNull ||
          bankTxPending ||
          bankTxUnknown ||
          bankTxGSheet ||
          bankTxRepeat ||
          bankTxReturn
            ? {
                buyFiat: buyFiat || undefined,
                buyFiatPass: buyFiatPass || undefined,
                buyCrypto: buyCrypto || undefined,
                buyCryptoPass: buyCryptoPass || undefined,
                bankTxNull: bankTxNull || undefined,
                bankTxPending: bankTxPending || undefined,
                bankTxUnknown: bankTxUnknown || undefined,
                bankTxGSheet: bankTxGSheet || undefined,
                bankTxRepeat: bankTxRepeat || undefined,
                bankTxReturn: bankTxReturn || undefined,
              }
            : undefined,
        minusBalance: manualDebtPosition + buyFiat + buyFiatPass + buyCrypto + buyCryptoPass,
      };

      return prev;
    }, {});

    const balancesByFinancialType: BalancesByFinancialType = Array.from(financialTypeMap.entries()).reduce(
      (acc, [financialType, assets]) => {
        const manualDebtPosition = assets.reduce(
          (prev, curr) => prev + (manualDebtPositions.find((p) => p.assetId === curr.id)?.value ?? 0),
          0,
        );
        const manualDebtPositionChf = assets.reduce(
          (prev, curr) =>
            prev + (manualDebtPositions.find((p) => p.assetId === curr.id)?.value ?? 0) * curr.approxPriceChf,
          0,
        );

        const cryptoInput = assets.reduce(
          (prev, curr) => prev + pendingPayIns.reduce((sum, tx) => (sum + tx.asset.id === curr.id ? tx.amount : 0), 0),
          0,
        );
        const cryptoInputChf = assets.reduce(
          (prev, curr) =>
            prev +
            pendingPayIns.reduce((sum, tx) => (sum + tx.asset.id === curr.id ? tx.amount : 0), 0) * curr.approxPriceChf,
          0,
        );

        const { input: buyFiat, output: buyFiatPass } = this.getPendingAmounts(assets, pendingBuyFiat);
        const { input: buyCrypto, output: buyCryptoPass } = this.getPendingAmounts(assets, pendingBuyCrypto);

        const { input: buyFiatChf, output: buyFiatPassChf } = this.getPendingChfAmounts(assets, pendingBuyFiat);
        const { input: buyCryptoChf, output: buyCryptoPassChf } = this.getPendingChfAmounts(assets, pendingBuyCrypto);

        const liqBalance = assets.reduce(
          (prev, curr) => prev + (liqBalances.find((b) => b.asset.id === curr.id)?.amount ?? 0),
          0,
        );
        const liqBalanceChf = assets.reduce(
          (prev, curr) => prev + (liqBalances.find((b) => b.asset.id === curr.id)?.amount ?? 0) * curr.approxPriceChf,
          0,
        );

        acc[financialType] = {
          plusBalance: liqBalance + cryptoInput,
          plusBalanceChf: liqBalanceChf + cryptoInputChf,
          minusBalance: manualDebtPosition + buyFiat + buyFiatPass + buyCrypto + buyCryptoPass,
          minusBalanceChf: manualDebtPositionChf + buyFiatChf + buyFiatPassChf + buyCryptoChf + buyCryptoPassChf,
        };
        return acc;
      },
      {},
    );

    const plusBalanceChf = Util.sumObjValue(Object.values(balancesByFinancialType), 'plusBalanceChf');
    const minusBalanceChf = Util.sumObjValue(Object.values(balancesByFinancialType), 'minusBalanceChf');

    await this.logService.create({
      system: 'LogService',
      subsystem: 'FinancialDataLog',
      severity: LogSeverity.INFO,
      message: JSON.stringify({
        assets: assetLog,
        tradings: tradingLog,
        balancesByFinancialType,
        balancesTotal: {
          plusBalanceChf,
          minusBalanceChf,
          totalBalanceChf: plusBalanceChf - minusBalanceChf,
        },
      }),
    });
  }

  private getPendingAmounts(
    assets: Asset[],
    pendingTx: (BuyCrypto | BuyFiat | BankTx | BankTxReturn | BankTxRepeat)[],
  ): { input: number; output: number } {
    return {
      input: assets.reduce(
        (prev, curr) => prev + pendingTx.reduce((sum, tx) => sum + tx.pendingInputAmount(curr), 0),
        0,
      ),
      output: assets.reduce(
        (prev, curr) => prev + pendingTx.reduce((sum, tx) => sum + tx.pendingOutputAmount(curr), 0),
        0,
      ),
    };
  }

  private getPendingChfAmounts(assets: Asset[], pendingTx: (BuyCrypto | BuyFiat)[]): { input: number; output: number } {
    return {
      input: assets.reduce(
        (prev, curr) =>
          prev + pendingTx.reduce((sum, tx) => sum + tx.pendingInputAmount(curr), 0) * curr.approxPriceChf,
        0,
      ),
      output: assets.reduce(
        (prev, curr) =>
          prev + pendingTx.reduce((sum, tx) => sum + tx.pendingOutputAmount(curr), 0) * curr.approxPriceChf,
        0,
      ),
    };
  }
}
