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

    // Items 0-6 are > 21 days old (will be filtered out), items 7-9 are < 21 days (will remain)
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
        created: Util.hoursBefore(309), // 13d
        valueDate: Util.hoursBefore(309),
        instructedAmount: 9500.0,
        amount: 9500.0,
      }),
    ];

    // With optimal matching: 3 senders (312h old) match 3 receivers (310h old), 1 sender (309h) remains
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [senderTx[10]], // Only 142409 remains unmatched
      receiver: [],
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

    // With optimal matching: sender (27h) and receiver (26h) match perfectly (same amount, receiver after sender, < 5d)
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [],
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

    // With optimal matching: all 3 senders match all 3 receivers optimally
    // sender[0] (8d) ↔ receiver[0] (6d): 2d apart
    // sender[1] (8d) ↔ receiver[1] (5d): 3d apart
    // sender[2] (7d) ↔ receiver[2] (5d): 2d apart
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [],
    });
  });

  it('should filter tx 21d or older', async () => {
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

    // With optimal matching: sender[1] (17d) matches receiver[1] (16d), sender[2] (7d) matches receiver[2] (6d)
    // First pair filtered by 21d rule
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [],
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

    // With optimal matching:
    // sender[0] filtered out (>= 21d)
    // sender[1] (17d, 19999.0) matches receiver[1] (16d, 19999.0)
    // receiver[0] stays unmatched (amount mismatch: 47543.81 vs 47520.04)
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [receiverTx[0]],
    });
  });

  it('should filter receiver 21d or older', async () => {
    // All senders created after receiver, so matching finds sender with highest id
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

    // With optimal matching:
    // receiver[0] filtered out (>= 21d)
    // receiver[1] (18d) matches sender[1] (19d, temporally closest: 1d apart)
    // sender[0] and sender[2] remain unmatched (sorted by id: [1, 3])
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [senderTx[2], senderTx[0]], // id=1 and id=3 remain unmatched, sorted by id
      receiver: [],
    });
  });

  it('should filter same length sender & receiver (reverse)', async () => {
    if (new Date().getHours() > 19) return;

    // Items 0-6 are > 21 days old (will be filtered out), items 7-9 are < 21 days (will remain)
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

    // With optimal matching: 3 senders (312h old) match 3 receivers (310h old)
    expect(service.filterSenderPendingList(senderTx, receiverTx)).toMatchObject({
      sender: [],
      receiver: [],
    });
  });

  describe('Optimal Transaction Matching', () => {
    it('should match transactions by exact reference (endToEndId ↔ txId) first', () => {
      const now = new Date();

      // Bank transaction with exact reference
      const senderWithRef = createCustomBankTx({
        id: 191175,
        created: new Date(now.getTime() - 2 * 60 * 1000), // 2 minutes ago
        valueDate: new Date(now.getTime() - 2 * 60 * 1000),
        instructedAmount: 40000,
        amount: 40000,
        endToEndId: 'E2E-79792',
      });

      // Bank transaction without matching reference
      const senderWithoutRef = createCustomBankTx({
        id: 190594,
        created: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        valueDate: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        instructedAmount: 40000,
        amount: 40000,
      });

      // Exchange transaction with matching reference
      const receiverWithRef = createCustomExchangeTx({
        id: 125970,
        created: now,
        amount: 40000,
        txId: 'DEPOSIT-79792',
      });

      const senderTx = [senderWithoutRef, senderWithRef]; // Older sender first
      const receiverTx = [receiverWithRef];

      const result = service.filterSenderPendingList(senderTx, receiverTx);

      // senderWithRef should be matched due to exact reference
      // senderWithoutRef should remain unmatched
      expect(result.sender).toHaveLength(1);
      expect(result.sender[0].id).toBe(190594);
      expect(result.receiver).toHaveLength(0);
    });

    it('should prefer temporally closer matches when no exact reference exists', () => {
      const baseTime = new Date('2026-03-02T10:00:00Z');

      // Two senders with different temporal distances to receiver
      const senderFarAway = createCustomBankTx({
        id: 190001,
        created: new Date(baseTime.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days before
        valueDate: new Date(baseTime.getTime() - 5 * 24 * 60 * 60 * 1000),
        instructedAmount: 40000,
        amount: 40000,
      });

      const senderClose = createCustomBankTx({
        id: 191001,
        created: new Date(baseTime.getTime() - 10 * 60 * 1000), // 10 minutes before
        valueDate: new Date(baseTime.getTime() - 10 * 60 * 1000),
        instructedAmount: 40000,
        amount: 40000,
      });

      // One receiver
      const receiver1 = createCustomExchangeTx({
        id: 125001,
        created: baseTime,
        amount: 40000,
      });

      const senderTx = [senderFarAway, senderClose];
      const receiverTx = [receiver1];

      const result = service.filterSenderPendingList(senderTx, receiverTx);

      // senderClose should be matched (temporally closer)
      // senderFarAway should remain unmatched
      expect(result.sender).toHaveLength(1);
      expect(result.sender[0].id).toBe(190001); // Far away sender is unmatched
      expect(result.receiver).toHaveLength(0);
    });

    it('should handle multiple matches optimally', () => {
      const baseTime = new Date('2026-03-02T10:00:00Z');

      const sender1 = createCustomBankTx({
        id: 191001,
        created: new Date(baseTime.getTime() - 30 * 60 * 1000), // 30 min before
        valueDate: new Date(baseTime.getTime() - 30 * 60 * 1000),
        instructedAmount: 40000,
        amount: 40000,
      });

      const sender2 = createCustomBankTx({
        id: 191002,
        created: new Date(baseTime.getTime() - 20 * 60 * 1000), // 20 min before
        valueDate: new Date(baseTime.getTime() - 20 * 60 * 1000),
        instructedAmount: 40000,
        amount: 40000,
      });

      const receiver1 = createCustomExchangeTx({
        id: 125001,
        created: new Date(baseTime.getTime() - 25 * 60 * 1000), // 25 min before (closer to sender1)
        amount: 40000,
      });

      const receiver2 = createCustomExchangeTx({
        id: 125002,
        created: baseTime, // Now (closer to sender2)
        amount: 40000,
      });

      const senderTx = [sender1, sender2];
      const receiverTx = [receiver1, receiver2];

      const result = service.filterSenderPendingList(senderTx, receiverTx);

      // Both should be matched optimally
      expect(result.sender).toHaveLength(0);
      expect(result.receiver).toHaveLength(0);
    });

    it('should handle transactions outside 5-day tolerance correctly', () => {
      const baseTime = new Date('2026-03-02T10:00:00Z');

      // Sender outside 5-day tolerance
      const senderTooOld = createCustomBankTx({
        id: 190001,
        created: new Date(baseTime.getTime() - 6 * 24 * 60 * 60 * 1000), // 6 days before
        valueDate: new Date(baseTime.getTime() - 6 * 24 * 60 * 60 * 1000),
        instructedAmount: 40000,
        amount: 40000,
      });

      const receiver = createCustomExchangeTx({
        id: 125001,
        created: baseTime,
        amount: 40000,
      });

      const senderTx = [senderTooOld];
      const receiverTx = [receiver];

      const result = service.filterSenderPendingList(senderTx, receiverTx);

      // Should not match (outside tolerance)
      expect(result.sender).toHaveLength(1);
      expect(result.sender[0].id).toBe(190001);
      expect(result.receiver).toHaveLength(1);
    });
  });
});
