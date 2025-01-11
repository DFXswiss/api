import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { createCustomExchangeTx } from 'src/integration/exchange/dto/__mocks__/exchange-tx.entity.mock';
import { ExchangeTxService } from 'src/integration/exchange/services/exchange-tx.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { LiquidityManagementPipelineService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-pipeline.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TradingOrderService } from 'src/subdomains/core/trading/services/trading-order.service';
import { TradingRuleService } from 'src/subdomains/core/trading/services/trading-rule.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankTxRepeatService } from '../../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx/bank-tx-return/bank-tx-return.service';
import { createCustomBankTx } from '../../bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { BankService } from '../../bank/bank/bank.service';
import { PayInService } from '../../payin/services/payin.service';
import { PayoutService } from '../../payout/services/payout.service';
import { LogJobService } from '../log-job.service';
import { LogService } from '../log.service';

describe('LogJobService', () => {
  let service: LogJobService;

  let tradingRuleService: TradingRuleService;
  let assetService: AssetService;
  let liqManagementBalanceService: LiquidityManagementBalanceService;
  let logService: LogService;
  let payInService: PayInService;
  let buyFiatService: BuyFiatService;
  let buyCryptoService: BuyCryptoService;
  let settingService: SettingService;
  let bankTxService: BankTxService;
  let bankTxRepeatService: BankTxRepeatService;
  let bankTxReturnService: BankTxReturnService;
  let liquidityManagementPipelineService: LiquidityManagementPipelineService;
  let exchangeTxService: ExchangeTxService;
  let bankService: BankService;
  let blockchainRegistryService: BlockchainRegistryService;
  let refRewardService: RefRewardService;
  let tradingOrderService: TradingOrderService;
  let payoutService: PayoutService;

  beforeEach(async () => {
    tradingRuleService = createMock<TradingRuleService>();
    assetService = createMock<AssetService>();
    liqManagementBalanceService = createMock<LiquidityManagementBalanceService>();
    logService = createMock<LogService>();
    payInService = createMock<PayInService>();
    buyFiatService = createMock<BuyFiatService>();
    buyCryptoService = createMock<BuyCryptoService>();
    settingService = createMock<SettingService>();
    bankTxService = createMock<BankTxService>();
    bankTxRepeatService = createMock<BankTxRepeatService>();
    bankTxReturnService = createMock<BankTxReturnService>();
    liquidityManagementPipelineService = createMock<LiquidityManagementPipelineService>();
    exchangeTxService = createMock<ExchangeTxService>();
    bankService = createMock<BankService>();
    blockchainRegistryService = createMock<BlockchainRegistryService>();
    refRewardService = createMock<RefRewardService>();
    tradingOrderService = createMock<TradingOrderService>();
    payoutService = createMock<PayoutService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        LogJobService,
        { provide: TradingRuleService, useValue: tradingRuleService },
        { provide: AssetService, useValue: assetService },
        { provide: LiquidityManagementBalanceService, useValue: liqManagementBalanceService },
        { provide: LogService, useValue: logService },
        { provide: PayInService, useValue: payInService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: SettingService, useValue: settingService },
        { provide: BankTxService, useValue: bankTxService },
        { provide: BankTxRepeatService, useValue: bankTxRepeatService },
        { provide: BankTxReturnService, useValue: bankTxReturnService },
        { provide: LiquidityManagementPipelineService, useValue: liquidityManagementPipelineService },
        { provide: ExchangeTxService, useValue: exchangeTxService },
        { provide: BankService, useValue: bankService },
        { provide: BlockchainRegistryService, useValue: blockchainRegistryService },
        { provide: RefRewardService, useValue: refRewardService },
        { provide: TradingOrderService, useValue: tradingOrderService },
        { provide: PayoutService, useValue: payoutService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<LogJobService>(LogJobService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return an empty array', async () => {
    expect(service.filterSenderPendingList([], [])).toMatchObject({ receiver: [], sender: [] });
  });

  it('should return sender & receiver', async () => {
    const senderTx = [createCustomExchangeTx({ id: 1, created: Util.hoursBefore(27), amount: 9999.0 })];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.hoursBefore(26),
        valueDate: Util.hoursBefore(26),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: senderTx,
      receiver: receiverTx,
    });
  });

  it('should filter not matching older senderTx', async () => {
    const senderTx = [
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(8), amount: 9999.0 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(8), amount: 9999.0 }),
      createCustomExchangeTx({ id: 3, created: Util.daysBefore(7), amount: 9999.0 }),
    ];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.daysBefore(6),
        valueDate: Util.daysBefore(6),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 2,
        created: Util.daysBefore(5),
        valueDate: Util.daysBefore(5),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 3,
        created: Util.daysBefore(5),
        valueDate: Util.daysBefore(5),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [senderTx[2]],
      receiver: receiverTx,
    });
  });

  it('should filter tx 14d or older', async () => {
    const senderTx = [
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(17), amount: 9999.0 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(12), amount: 9999.0 }),
      createCustomExchangeTx({ id: 3, created: Util.daysBefore(7), amount: 9999.0 }),
    ];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.daysBefore(16),
        valueDate: Util.daysBefore(16),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 2,
        created: Util.daysBefore(11),
        valueDate: Util.daysBefore(11),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 3,
        created: Util.daysBefore(6),
        valueDate: Util.daysBefore(6),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: senderTx.slice(1),
      receiver: receiverTx.slice(1),
    });
  });

  it('should filter tx 21d or older', async () => {
    const senderTx = [
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(21), amount: 47543.81 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(17), amount: 19999.0 }),
    ];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.daysBefore(20),
        valueDate: Util.daysBefore(20),
        instructedAmount: 47543.81,
        amount: 47520.04,
      }),
      createCustomBankTx({
        id: 2,
        created: Util.daysBefore(16),
        valueDate: Util.daysBefore(16),
        instructedAmount: 19999.0,
        amount: 19989.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [senderTx[1]],
      receiver: [receiverTx[1]],
    });
  });

  it('should filter receiver 21d or older', async () => {
    const senderTx = [
      createCustomExchangeTx({ id: 3, created: Util.daysBefore(19), amount: 9999.0 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(18), amount: 9999.0 }),
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(17), amount: 9999.0 }),
    ];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.daysBefore(21),
        valueDate: Util.daysBefore(21),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 2,
        created: Util.daysBefore(18),
        valueDate: Util.daysBefore(18),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: senderTx,
      receiver: [receiverTx[1]],
    });
  });
});
