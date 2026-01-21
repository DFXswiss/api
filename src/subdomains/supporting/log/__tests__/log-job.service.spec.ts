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

  it('should filter same length sender & receiver with 1:1 matching', async () => {
    if (new Date().getHours() > 19) return;

    // Items 0-6 are > 21 days old (will be filtered out), items 7-9 are < 21 days (will remain)
    // After 21d filter: 3 receivers (310h) and 4 senders (3 at 312h + 1 at 309h)
    // 1:1 matching: 3 senders match 3 receivers, 1 sender (142409) remains unmatched
    const receiverTx = [
      createCustomExchangeTx({ id: 63189, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63190, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63191, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63232, created: Util.hoursBefore(527), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63277, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63278, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63279, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63280, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
      createCustomExchangeTx({ id: 63281, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
      createCustomExchangeTx({ id: 63282, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
    ];

    const senderTx = [
      createCustomBankTx({
        id: 142006,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142007,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142008,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142153,
        created: Util.hoursBefore(528), // 22d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142199,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142218,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142265,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142396,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142407,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142408,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142409,
        created: Util.hoursBefore(309), // 13d - only unmatched sender
        valueDate: Util.hoursBefore(309),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
    ];

    // With 1:1 matching: 3 senders (312h) match 3 receivers (310h), 1 sender (309h) has no match
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [senderTx[10]], // Only the unmatched sender
      receiver: [],
    });
  });

  it('should return an empty array', async () => {
    expect(service.filterSenderPendingList([], [])).toMatchObject({ receiver: [], sender: [] });
  });

  it('should match sender & receiver with 1:1 matching', async () => {
    // Sender at 27h, receiver at 26h (more recent) - they should match
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

    // With 1:1 matching, sender matches receiver, both are filtered out
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [],
    });
  });

  it('should match all senders with receivers using 1:1 matching', async () => {
    // 3 senders, 3 receivers, all with matching amounts
    // All receivers are created after their corresponding senders
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

    // With 1:1 matching, all 3 senders match all 3 receivers
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [],
    });
  });

  it('should filter tx 21d or older and match remaining', async () => {
    // sender[0] at 22d (filtered), sender[1] at 17d, sender[2] at 7d
    // receiver[0] at 21d (filtered), receiver[1] at 16d, receiver[2] at 6d
    // After filter: 2 senders match 2 receivers
    const senderTx = [
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(22), amount: 9999.0 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(17), amount: 9999.0 }),
      createCustomExchangeTx({ id: 3, created: Util.daysBefore(7), amount: 9999.0 }),
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
        created: Util.daysBefore(16),
        valueDate: Util.daysBefore(16),
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

    // After 21d filter: sender[1,2] and receiver[1,2] remain, all match
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [],
    });
  });

  it('should filter tx 21d or older with non-matching amounts', async () => {
    // sender[0] at 21d (filtered), sender[1] at 17d (amount 19999)
    // receiver[0] at 20d (amount 47543.81 - no match), receiver[1] at 16d (amount 19999 - matches sender[1])
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

    // sender[1] matches receiver[1], receiver[0] has no matching sender
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [receiverTx[0]],
    });
  });

  it('should filter receiver 21d or older with 1:1 matching', async () => {
    // 3 senders at 20d, 19d, 19d - all within 21d
    // 1 receiver at 18d (receiver[0] at 21d is filtered)
    // Only 1 receiver available, so only 1 sender can match
    const senderTx = [
      createCustomExchangeTx({ id: 3, created: Util.daysBefore(20), amount: 9999.0 }),
      createCustomExchangeTx({ id: 2, created: Util.daysBefore(19), amount: 9999.0 }),
      createCustomExchangeTx({ id: 1, created: Util.daysBefore(19), amount: 9999.0 }),
    ];

    const receiverTx = [
      createCustomBankTx({
        id: 1,
        created: Util.daysBefore(21), // This will be filtered out (>= 21d)
        valueDate: Util.daysBefore(21),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
      createCustomBankTx({
        id: 2,
        created: Util.daysBefore(18), // This will remain (< 21d)
        valueDate: Util.daysBefore(18),
        instructedAmount: 9999.0,
        amount: 9999.0,
      }),
    ];

    // With 1:1 matching: sender[0] (20d, oldest) matches receiver[1] (18d)
    // sender[1] (id=2) and sender[2] (id=1) have no receiver to match
    // Results are sorted by id, so [id=1, id=2] = [senderTx[2], senderTx[1]]
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [senderTx[2], senderTx[1]], // Unmatched senders sorted by id
      receiver: [],
    });
  });

  it('should filter same length sender & receiver (reverse) with 1:1 matching', async () => {
    if (new Date().getHours() > 19) return;

    // Items 0-6 are > 21 days old (will be filtered out), items 7-9 are < 21 days (will remain)
    // After 21d filter: 3 senders (312h) and 3 receivers (310h)
    // All 3 pairs match, so result should be empty
    const receiverTx = [
      createCustomExchangeTx({ id: 63189, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63190, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63191, created: Util.hoursBefore(529), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63232, created: Util.hoursBefore(527), amount: 9500.0 }), // 22d
      createCustomExchangeTx({ id: 63277, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63278, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63279, created: Util.hoursBefore(520), amount: 9500.0 }), // 21.6d
      createCustomExchangeTx({ id: 63280, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
      createCustomExchangeTx({ id: 63281, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
      createCustomExchangeTx({ id: 63282, created: Util.hoursBefore(310), amount: 9500.0 }), // 13d
    ];

    const senderTx = [
      createCustomBankTx({
        id: 142006,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142007,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142008,
        created: Util.hoursBefore(552), // 23d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142153,
        created: Util.hoursBefore(528), // 22d
        valueDate: Util.hoursBefore(526),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142199,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142218,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142265,
        created: Util.hoursBefore(520), // 21.6d
        valueDate: Util.hoursBefore(520),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142396,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142407,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
      createCustomBankTx({
        id: 142408,
        created: Util.hoursBefore(312), // 13d
        valueDate: Util.hoursBefore(312),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
    ];

    // With 1:1 matching: all 3 senders (312h) match all 3 receivers (310h)
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [],
    });
  });
});
