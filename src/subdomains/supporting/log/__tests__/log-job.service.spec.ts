import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { createCustomExchangeTx } from 'src/integration/exchange/dto/__mocks__/exchange-tx.entity.mock';
import { ExchangeTxService } from 'src/integration/exchange/services/exchange-tx.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { ProcessService } from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { LiquidityManagementPipelineService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-pipeline.service';
import { PaymentBalanceService } from 'src/subdomains/core/payment-link/services/payment-balance.service';
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
  let processService: ProcessService;
  let paymentBalanceService: PaymentBalanceService;

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
    processService = createMock<ProcessService>();
    paymentBalanceService = createMock<PaymentBalanceService>();

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
        { provide: ProcessService, useValue: processService },
        { provide: PaymentBalanceService, useValue: paymentBalanceService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<LogJobService>(LogJobService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should filter same length sender & receiver', async () => {
    if (new Date().getHours() > 19) return;

    const receiverTx = [
      createCustomExchangeTx({ id: 63189, created: Util.hoursBefore(409), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63190, created: Util.hoursBefore(409), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63191, created: Util.hoursBefore(409), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63232, created: Util.hoursBefore(407), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63277, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63278, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63279, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63280, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63281, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63282, created: Util.hoursBefore(310), amount: 9500.0 }),
    ];

    const senderTx = [
      createCustomBankTx({
        id: 142006,
        created: Util.hoursBefore(432),
        valueDate: Util.hoursBefore(406),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142007,
        created: Util.hoursBefore(432),
        valueDate: Util.hoursBefore(406),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142008,
        created: Util.hoursBefore(432),
        valueDate: Util.hoursBefore(406),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142153,
        created: Util.hoursBefore(408),
        valueDate: Util.hoursBefore(406),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142199,
        created: Util.hoursBefore(384),
        valueDate: Util.hoursBefore(384),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142218,
        created: Util.hoursBefore(384),
        valueDate: Util.hoursBefore(384),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142265,
        created: Util.hoursBefore(384),
        valueDate: Util.hoursBefore(384),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142396,
        created: Util.hoursBefore(312),
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142407,
        created: Util.hoursBefore(312),
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142408,
        created: Util.hoursBefore(312),
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142409,
        created: Util.hoursBefore(309),
        valueDate: Util.hoursBefore(309),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: senderTx.slice(7),
      receiver: receiverTx.slice(7),
    });
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
      receiver: [receiverTx[2]],
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

  it('should filter same length sender & receiver', async () => {
    if (new Date().getHours() > 19) return;

    const receiverTx = [
      createCustomExchangeTx({ id: 63189, created: Util.hoursBefore(409), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63190, created: Util.hoursBefore(409), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63191, created: Util.hoursBefore(409), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63232, created: Util.hoursBefore(407), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63277, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63278, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63279, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63280, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63281, created: Util.hoursBefore(310), amount: 9500.0 }),
      createCustomExchangeTx({ id: 63282, created: Util.hoursBefore(310), amount: 9500.0 }),
    ];

    const senderTx = [
      createCustomBankTx({
        id: 142006,
        created: Util.hoursBefore(432),
        valueDate: Util.hoursBefore(406),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142007,
        created: Util.hoursBefore(432),
        valueDate: Util.hoursBefore(406),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142008,
        created: Util.hoursBefore(432),
        valueDate: Util.hoursBefore(406),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142153,
        created: Util.hoursBefore(408),
        valueDate: Util.hoursBefore(406),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142199,
        created: Util.hoursBefore(384),
        valueDate: Util.hoursBefore(384),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142218,
        created: Util.hoursBefore(384),
        valueDate: Util.hoursBefore(384),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142265,
        created: Util.hoursBefore(384),
        valueDate: Util.hoursBefore(384),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142396,
        created: Util.hoursBefore(312),
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142407,
        created: Util.hoursBefore(312),
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142408,
        created: Util.hoursBefore(312),
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
    ];

    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: senderTx.slice(7),
      receiver: receiverTx.slice(7),
    });
  });
});
