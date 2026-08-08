import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScorechainScreening } from 'src/integration/scorechain/entities/scorechain-screening.entity';
import { ScorechainScreeningService } from 'src/integration/scorechain/services/scorechain-screening.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { AmlSourceType } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { CustodyOrderService } from 'src/subdomains/core/custody/services/custody-order.service';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { ScorechainDocumentService } from 'src/subdomains/generic/kyc/services/scorechain-document.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { createCustomFiatOutput } from 'src/subdomains/supporting/fiat-output/__mocks__/fiat-output.entity.mock';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { CryptoInput, PayInAction, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { PayoutOrderContext } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { SupportLogService } from 'src/subdomains/supporting/support-issue/services/support-log.service';
import { DeepPartial, EntityManager, IsNull, Not } from 'typeorm';
import { createCustomSellHistory } from '../../route/dto/__mocks__/sell-history.dto.mock';
import { SellRepository } from '../../route/sell.repository';
import { SellService } from '../../route/sell.service';
import { createCustomBuyFiat } from '../__mocks__/buy-fiat.entity.mock';
import { BuyFiat } from '../buy-fiat.entity';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { UpdateBuyFiatDto } from '../dto/update-buy-fiat.dto';
import { BuyFiatNotificationService } from '../services/buy-fiat-notification.service';
import { BuyFiatService } from '../services/buy-fiat.service';

enum MockBuyData {
  DEFAULT,
  BUY_HISTORY_EMPTY,
  BUY_HISTORY,
  BUY_HISTORY_SMALL,
}

describe('BuyFiatService', () => {
  let service: BuyFiatService;

  let buyFiatRepo: BuyFiatRepository;
  let userService: UserService;
  let sellRepo: SellRepository;
  let sellService: SellService;
  let bankTxService: BankTxService;
  let fiatOutputService: FiatOutputService;
  let buyCryptoService: BuyCryptoService;
  let webhookService: WebhookService;
  let fiatService: FiatService;
  let transactionRequestService: TransactionRequestService;
  let bankDataService: BankDataService;
  let transactionService: TransactionService;
  let payInService: PayInService;
  let userDataService: UserDataService;
  let buyFiatNotificationService: BuyFiatNotificationService;
  let amlService: AmlService;
  let transactionHelper: TransactionHelper;
  let custodyOrderService: CustodyOrderService;
  let supportLogService: SupportLogService;
  let payoutService: PayoutService;
  let scorechainScreeningService: ScorechainScreeningService;
  let scorechainDocumentService: ScorechainDocumentService;
  let transactionAmlCheckService: TransactionAmlCheckService;

  beforeEach(async () => {
    buyFiatRepo = createMock<BuyFiatRepository>();
    userService = createMock<UserService>();
    sellRepo = createMock<SellRepository>();
    sellService = createMock<SellService>();
    bankTxService = createMock<BankTxService>();
    fiatOutputService = createMock<FiatOutputService>();
    buyCryptoService = createMock<BuyCryptoService>();
    webhookService = createMock<WebhookService>();
    fiatService = createMock<FiatService>();
    transactionRequestService = createMock<TransactionRequestService>();
    bankDataService = createMock<BankDataService>();
    transactionService = createMock<TransactionService>();
    payInService = createMock<PayInService>();
    userDataService = createMock<UserDataService>();
    buyFiatNotificationService = createMock<BuyFiatNotificationService>();
    amlService = createMock<AmlService>();
    transactionHelper = createMock<TransactionHelper>();
    custodyOrderService = createMock<CustodyOrderService>();
    supportLogService = createMock<SupportLogService>();
    payoutService = createMock<PayoutService>();
    scorechainScreeningService = createMock<ScorechainScreeningService>();
    scorechainDocumentService = createMock<ScorechainDocumentService>();
    transactionAmlCheckService = createMock<TransactionAmlCheckService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyFiatService,
        { provide: BuyFiatRepository, useValue: buyFiatRepo },
        { provide: UserService, useValue: userService },
        { provide: SellRepository, useValue: sellRepo },
        { provide: SellService, useValue: sellService },
        { provide: BankTxService, useValue: bankTxService },
        { provide: FiatOutputService, useValue: fiatOutputService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: WebhookService, useValue: webhookService },
        { provide: FiatService, useValue: fiatService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: BankDataService, useValue: bankDataService },
        { provide: TransactionService, useValue: transactionService },
        { provide: PayInService, useValue: payInService },
        { provide: UserDataService, useValue: userDataService },
        { provide: BuyFiatNotificationService, useValue: buyFiatNotificationService },
        { provide: AmlService, useValue: amlService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: CustodyOrderService, useValue: custodyOrderService },
        { provide: SupportLogService, useValue: supportLogService },
        { provide: PayoutService, useValue: payoutService },
        { provide: ScorechainScreeningService, useValue: scorechainScreeningService },
        { provide: ScorechainDocumentService, useValue: scorechainDocumentService },
        { provide: TransactionAmlCheckService, useValue: transactionAmlCheckService },
      ],
    }).compile();

    service = module.get<BuyFiatService>(BuyFiatService);
  });

  const txOne = {
    inputAmount: 0.00005,
    inputAsset: 'BTC',
    outputAmount: 1,
    outputAsset: createDefaultFiat(),
  };

  const txTwo = {
    inputAmount: 0.0005,
    inputAsset: 'BTC',
    outputAmount: 10,
    outputAsset: createDefaultFiat(),
  };

  const txSmallAmount = {
    inputAmount: 3e-8,
    inputAsset: 'GOOGL',
    outputAmount: 1,
    outputAsset: createDefaultFiat(),
  };

  function setup(mock: MockBuyData, date?: Date) {
    if (mock !== MockBuyData.DEFAULT) {
      let wantedData: BuyFiat[] = [];
      switch (mock) {
        case MockBuyData.BUY_HISTORY:
          wantedData = [
            createCustomBuyFiat({
              fiatOutput: createCustomFiatOutput({ outputDate: date }),
              cryptoInput: createCustomCryptoInput({ inTxId: 'IN_TX_ID_0' }),
              ...txOne,
            }),
            createCustomBuyFiat({
              fiatOutput: createCustomFiatOutput({ outputDate: date }),
              cryptoInput: createCustomCryptoInput({ inTxId: 'IN_TX_ID_1' }),
              ...txTwo,
            }),
          ];
          break;
        case MockBuyData.BUY_HISTORY_SMALL:
          wantedData = [
            createCustomBuyFiat({
              fiatOutput: createCustomFiatOutput({ outputDate: date }),
              cryptoInput: createCustomCryptoInput({ created: date, inTxId: 'IN_TX_ID_0' }),
              ...txSmallAmount,
            }),
          ];
      }

      // The history goes through the projected query.
      jest.spyOn(buyFiatRepo, 'findSellHistory').mockResolvedValue(wantedData);
    }
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.each([PayInStatus.SENDING, PayInStatus.SEND_UNCERTAIN])(
    'does not re-arm a buy-fiat return while the pay-in send status is %s',
    async (status) => {
      const buyFiat = createCustomBuyFiat({
        id: 71,
        chargebackAddress: '0x0000000000000000000000000000000000000001',
        chargebackAmount: 0.1,
      });
      const cryptoInput = createCustomCryptoInput({ status, returnTxId: null });
      jest.spyOn(payInService, 'getPayIn').mockResolvedValue(cryptoInput);

      await expect(service['triggerBuyFiatReturn'](buyFiat, cryptoInput)).rejects.toThrow(
        new BadRequestException('CryptoInput send in flight or uncertain'),
      );

      expect(payInService.returnPayIn).not.toHaveBeenCalled();
      expect(payoutService.doPayout).not.toHaveBeenCalled();
    },
  );

  it('routes triggerBuyFiatReturn on the fresh pay-in row, not the caller snapshot', async () => {
    const buyFiat = createCustomBuyFiat({
      id: 72,
      chargebackAddress: '0x0000000000000000000000000000000000000001',
      chargebackAmount: 0.1,
    });
    // Stale snapshot still says FORWARDED/FORWARD — would fall through both branches if used.
    const staleSnapshot = createCustomCryptoInput({
      id: 23,
      status: PayInStatus.FORWARDED,
      action: PayInAction.FORWARD,
      returnTxId: null,
    });
    const freshConfirmed = createCustomCryptoInput({
      id: 23,
      status: PayInStatus.FORWARD_CONFIRMED,
      action: PayInAction.FORWARD,
      returnTxId: null,
      asset: staleSnapshot.asset,
    });
    jest.spyOn(payInService, 'getPayIn').mockResolvedValue(freshConfirmed);
    const doPayoutSpy = jest.spyOn(payoutService, 'doPayout').mockResolvedValue(undefined as never);
    const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();

    await service['triggerBuyFiatReturn'](buyFiat, staleSnapshot);

    expect(payInService.getPayIn).toHaveBeenCalledWith(23);
    expect(doPayoutSpy).toHaveBeenCalledWith(
      {
        context: PayoutOrderContext.BUY_FIAT_RETURN,
        correlationId: '72',
        asset: freshConfirmed.asset,
        amount: 0.1,
        destinationAddress: buyFiat.chargebackAddress,
      },
      undefined,
    );
    expect(returnPayInSpy).not.toHaveBeenCalled();
  });

  it('throws when the fresh pay-in is still FORWARDED with action FORWARD (pending confirmation)', async () => {
    const buyFiat = createCustomBuyFiat({
      id: 73,
      chargebackAddress: '0x0000000000000000000000000000000000000001',
      chargebackAmount: 0.1,
    });
    const pendingForward = createCustomCryptoInput({
      id: 24,
      status: PayInStatus.FORWARDED,
      action: PayInAction.FORWARD,
      returnTxId: null,
    });
    jest.spyOn(payInService, 'getPayIn').mockResolvedValue(pendingForward);
    const doPayoutSpy = jest.spyOn(payoutService, 'doPayout').mockResolvedValue(undefined as never);
    const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();

    await expect(service['triggerBuyFiatReturn'](buyFiat, pendingForward)).rejects.toThrow(
      new BadRequestException('CryptoInput forward is pending confirmation - retry once confirmed'),
    );

    expect(doPayoutSpy).not.toHaveBeenCalled();
    expect(returnPayInSpy).not.toHaveBeenCalled();
  });

  it('silently skips when the fresh pay-in is already PREPARING with action RETURN', async () => {
    const buyFiat = createCustomBuyFiat({
      id: 74,
      chargebackAddress: '0x0000000000000000000000000000000000000001',
      chargebackAmount: 0.1,
    });
    const returnInProgress = createCustomCryptoInput({
      id: 25,
      status: PayInStatus.PREPARING,
      action: PayInAction.RETURN,
      returnTxId: null,
    });
    jest.spyOn(payInService, 'getPayIn').mockResolvedValue(returnInProgress);
    const doPayoutSpy = jest.spyOn(payoutService, 'doPayout').mockResolvedValue(undefined as never);
    const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();

    await expect(service['triggerBuyFiatReturn'](buyFiat, returnInProgress)).resolves.toBeUndefined();

    expect(doPayoutSpy).not.toHaveBeenCalled();
    expect(returnPayInSpy).not.toHaveBeenCalled();
  });

  it('should return an empty array, if sell route has no history', async () => {
    setup(MockBuyData.BUY_HISTORY_EMPTY);

    await expect(service.getSellHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if sell route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY, date);

    await expect(service.getSellHistory(1, 1)).resolves.toStrictEqual([
      createCustomSellHistory({
        date: date,
        txId: 'IN_TX_ID_0',
        txUrl: 'https://etherscan.io/tx/IN_TX_ID_0',
        ...txOne,
        outputAsset: txOne.outputAsset.name,
      }),
      createCustomSellHistory({
        date: date,
        txId: 'IN_TX_ID_1',
        txUrl: 'https://etherscan.io/tx/IN_TX_ID_1',
        ...txTwo,
        outputAsset: txTwo.outputAsset.name,
      }),
    ]);
  });

  it('should return a history, if sell route has transactions and show small amount correctly', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY_SMALL, date);

    await expect(service.getSellHistory(1, 1)).resolves.toStrictEqual([
      createCustomSellHistory({
        date: date,
        txId: 'IN_TX_ID_0',
        txUrl: 'https://etherscan.io/tx/IN_TX_ID_0',
        ...txSmallAmount,
        outputAsset: txSmallAmount.outputAsset.name,
      }),
    ]);
  });

  describe('retriggerScorechain', () => {
    it('re-screens the incoming deposit tx on the input blockchain via a fresh (cache-bypassing) call', async () => {
      const entity = {
        id: 42,
        cryptoInput: { asset: { blockchain: Blockchain.ETHEREUM }, inTxId: 'txhash' },
      } as unknown as BuyFiat;
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(entity);
      const screening = new ScorechainScreening();
      jest.spyOn(scorechainScreeningService, 'rescreenDepositTransaction').mockResolvedValue(screening);

      const result = await service.retriggerScorechain(42);

      expect(scorechainScreeningService.rescreenDepositTransaction).toHaveBeenCalledWith(Blockchain.ETHEREUM, 'txhash');
      expect(result).toBe(screening);
      expect(scorechainDocumentService.createScreeningReport).not.toHaveBeenCalled(); // no userData / not newly screened
    });

    it('stores a compliance report when the fresh screening is tied to a customer', async () => {
      const userData = { id: 5 } as any;
      const entity = {
        id: 42,
        cryptoInput: { asset: { blockchain: Blockchain.ETHEREUM }, inTxId: 'txhash' },
        userData,
      } as unknown as BuyFiat;
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(entity);
      const screening = Object.assign(new ScorechainScreening(), { isNewlyScreened: true });
      jest.spyOn(scorechainScreeningService, 'rescreenDepositTransaction').mockResolvedValue(screening);

      const result = await service.retriggerScorechain(42);

      expect(scorechainDocumentService.createScreeningReport).toHaveBeenCalledWith(userData, screening);
      expect(result).toBe(screening);
    });

    it('throws NotFoundException when the buy-fiat does not exist', async () => {
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(null);

      await expect(service.retriggerScorechain(1)).rejects.toThrow(NotFoundException);
      expect(scorechainScreeningService.rescreenDepositTransaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the buy-fiat has no deposit transaction to screen', async () => {
      const entity = { id: 7, cryptoInput: { asset: { blockchain: Blockchain.ETHEREUM } } } as unknown as BuyFiat;
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(entity);

      await expect(service.retriggerScorechain(7)).rejects.toThrow(BadRequestException);
      expect(scorechainScreeningService.rescreenDepositTransaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an input chain Scorechain does not support', async () => {
      const entity = {
        id: 7,
        cryptoInput: { asset: { blockchain: Blockchain.MONERO }, inTxId: 'monero-txhash' },
      } as unknown as BuyFiat;
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(entity);

      await expect(service.retriggerScorechain(7)).rejects.toThrow(BadRequestException);
      expect(scorechainScreeningService.rescreenDepositTransaction).not.toHaveBeenCalled();
    });
  });

  function mockManagerTransaction(manager: {
    findOne?: jest.Mock;
    update?: jest.Mock;
    save?: jest.Mock;
    getRepository?: jest.Mock;
  }): void {
    Object.defineProperty(buyFiatRepo, 'manager', {
      configurable: true,
      value: {
        transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
          run(manager as unknown as EntityManager),
        ),
      },
    });
  }

  describe('amlCheck audit trail', () => {
    it('records a MANUAL_RESET history row (previous verdict → null) when resetAmlCheckInternal clears the check', async () => {
      const entity = createCustomBuyFiat({ id: 5, amlCheck: CheckStatus.PENDING, amlReason: null });
      const cryptoInput = entity.cryptoInput;
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyFiat) return options.select?.id ? { id: 5 } : entity;
          if (type === CryptoInput) return options.select?.id ? { id: cryptoInput.id } : cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManagerTransaction(manager);

      await service.resetAmlCheckInternal(entity, AmlSourceType.MANUAL_RESET);

      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalledTimes(1);
      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalledWith(
        expect.objectContaining({ id: 5, amlCheck: null }),
        'BuyFiat',
        AmlSourceType.MANUAL_RESET,
        CheckStatus.PENDING,
        null,
      );
    });

    // Regression: an admin PUT that omits amlCheck makes `forceUpdate` inject amlCheck/amlReason: undefined,
    // which save() drops — leaving the in-memory entity with amlCheck=undefined. update() must coalesce it
    // back to the persisted verdict before recording history, otherwise the trail gets a phantom
    // "PENDING → null (verdict cleared)" row for an edit that never touched the verdict.
    it('does NOT emit a phantom verdict-cleared row when a non-AML admin update omits amlCheck', async () => {
      const entity = createCustomBuyFiat({ id: 12, amlCheck: CheckStatus.PENDING, amlReason: null, isComplete: false });
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(entity);
      jest.spyOn(buyFiatRepo, 'create').mockImplementation((dto: any) => Object.assign(new BuyFiat(), dto));
      // save returns exactly what it is handed, so forceUpdate's amlCheck=undefined clobber survives and the
      // test actually exercises update()'s in-memory coalesce (not a DB round-trip that would refill it).
      const manager = {
        save: jest.fn(async (_type: unknown, e: BuyFiat) => e),
      };
      mockManagerTransaction(manager);

      await service.update(
        12,
        Object.assign(new UpdateBuyFiatDto(), { recipientMail: 'gs@example.com' }),
        AmlSourceType.MANUAL_UPDATE,
      );

      // the entity handed to the audit trail carries the persisted (unchanged) PENDING verdict, NOT undefined
      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalledWith(
        expect.objectContaining({ amlCheck: CheckStatus.PENDING }),
        'BuyFiat',
        AmlSourceType.MANUAL_UPDATE,
        CheckStatus.PENDING,
        null,
      );
    });

    // Companion: an admin PUT that EXPLICITLY sets amlCheck: null is a genuine verdict clear that save()
    // persists. The coalesce only restores an OMITTED field (undefined), so an explicit null must still
    // reach the audit trail as null rather than being coalesced back to the prior verdict.
    it('records a verdict-cleared row when an admin update explicitly sets amlCheck: null', async () => {
      const entity = createCustomBuyFiat({ id: 14, amlCheck: CheckStatus.PENDING, amlReason: null, isComplete: false });
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(entity);
      jest.spyOn(buyFiatRepo, 'create').mockImplementation((dto: any) => Object.assign(new BuyFiat(), dto));
      const manager = {
        save: jest.fn(async (_type: unknown, e: BuyFiat) => e),
      };
      mockManagerTransaction(manager);

      await service.update(14, Object.assign(new UpdateBuyFiatDto(), { amlCheck: null }), AmlSourceType.MANUAL_UPDATE);

      // the explicit null verdict change survives the coalesce and is handed to the audit trail as null
      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalledWith(
        expect.objectContaining({ amlCheck: null }),
        'BuyFiat',
        AmlSourceType.MANUAL_UPDATE,
        CheckStatus.PENDING,
        null,
      );
    });
  });

  describe('createFromCryptoInput exact base-unit propagation (#4287 stage 4)', () => {
    it('propagates the linked crypto_input on-chain base units into inputAmountBaseUnits (exact beyond 8 dp)', async () => {
      jest.spyOn(buyFiatRepo, 'create').mockImplementation((dto: any) => Object.assign(new BuyFiat(), dto));
      jest.spyOn(buyFiatRepo, 'save').mockImplementation(async (e) => e as BuyFiat);
      jest.spyOn(service as any, 'getAndCompleteTxRequest').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'triggerWebhook').mockResolvedValue(undefined);
      jest.spyOn(transactionService, 'updateInternal').mockImplementation(async (t: any) => t);

      const cryptoInput = createCustomCryptoInput({
        amount: 1.23456789,
        // 18-dp wei — NOT representable in the 8-dp float `amount`; the exact integer must survive verbatim
        amountBaseUnits: 1234567890123456789n,
        asset: createCustomAsset({ name: 'ETH', decimals: 18 }),
        transaction: { id: 1 } as any,
      });
      const sell = { fiat: createDefaultFiat(), user: {}, userData: {} } as any;

      const result = await service.createFromCryptoInput(cryptoInput, sell);

      expect(result.inputAmountBaseUnits).toBe(1234567890123456789n);
      // existing float column is untouched (backward compatible)
      expect(result.inputAmount).toBe(1.23456789);
    });

    it('fails open to a null inputAmountBaseUnits when the crypto_input has no captured base units', async () => {
      jest.spyOn(buyFiatRepo, 'create').mockImplementation((dto: any) => Object.assign(new BuyFiat(), dto));
      jest.spyOn(buyFiatRepo, 'save').mockImplementation(async (e) => e as BuyFiat);
      jest.spyOn(service as any, 'getAndCompleteTxRequest').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'triggerWebhook').mockResolvedValue(undefined);
      jest.spyOn(transactionService, 'updateInternal').mockImplementation(async (t: any) => t);

      const cryptoInput = createCustomCryptoInput({
        amount: 0.1,
        amountBaseUnits: null,
        transaction: { id: 2 } as any,
      });
      const sell = { fiat: createDefaultFiat(), user: {}, userData: {} } as any;

      const result = await service.createFromCryptoInput(cryptoInput, sell);

      expect(result.inputAmountBaseUnits).toBeNull();
      expect(result.inputAmount).toBe(0.1);
    });
  });

  describe('update chargeback release (F1)', () => {
    it('runs save + triggerBuyFiatReturn inside one transaction and fires webhook only after', async () => {
      const cryptoInput = createCustomCryptoInput({
        id: 23,
        action: PayInAction.WAITING,
        status: PayInStatus.ACKNOWLEDGED,
        returnTxId: null,
      });
      const entity = createCustomBuyFiat({
        id: 80,
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        chargebackAllowedDate: null,
        chargebackAddress: '0x0000000000000000000000000000000000000001',
        chargebackAmount: 0.1,
        cryptoInput,
      });
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(entity);
      jest
        .spyOn(buyFiatRepo, 'create')
        .mockImplementation((dto: DeepPartial<BuyFiat>) => Object.assign(new BuyFiat(), dto));
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const webhookSpy = jest.spyOn(service, 'triggerWebhook').mockResolvedValue();
      const manager = {
        save: jest.fn(async (_type: unknown, e: BuyFiat) => e),
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === CryptoInput) return options.select?.id ? { id: 23 } : cryptoInput;
          return undefined;
        }),
      };
      mockManagerTransaction(manager);

      const allowedDate = new Date('2026-08-01T12:00:00.000Z');
      await service.update(
        80,
        Object.assign(new UpdateBuyFiatDto(), {
          chargebackAllowedDate: allowedDate,
          chargebackDate: allowedDate,
        }),
        AmlSourceType.MANUAL_UPDATE,
      );

      expect(manager.save).toHaveBeenCalledWith(BuyFiat, expect.objectContaining({ id: 80 }));
      expect(returnPayInSpy).toHaveBeenCalledWith(cryptoInput, entity.chargebackAddress, 0.1, manager);
      expect(payInService.getPayIn).not.toHaveBeenCalled();
      expect(webhookSpy).toHaveBeenCalled();
      expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(returnPayInSpy.mock.invocationCallOrder[0]);
      expect(returnPayInSpy.mock.invocationCallOrder[0]).toBeLessThan(webhookSpy.mock.invocationCallOrder[0]);
    });

    it('propagates forward-pending and skips webhook/volume side effects when routing fails', async () => {
      const pendingForward = createCustomCryptoInput({
        id: 24,
        status: PayInStatus.FORWARDED,
        action: PayInAction.FORWARD,
        returnTxId: null,
      });
      const bankData = { id: 7, iban: 'CH9300762011623852957', approved: false };
      const freshBankData = {
        id: 7,
        iban: 'CH9300762011623852957',
        approved: false,
        userData: { id: 1 },
      };
      const entity = createCustomBuyFiat({
        id: 81,
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        chargebackAllowedDate: null,
        chargebackAddress: '0x0000000000000000000000000000000000000001',
        chargebackAmount: 0.1,
        cryptoInput: pendingForward,
        bankData: bankData as BuyFiat['bankData'],
      });
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(entity);
      jest
        .spyOn(buyFiatRepo, 'create')
        .mockImplementation((dto: DeepPartial<BuyFiat>) => Object.assign(new BuyFiat(), dto));
      const bankTxRepo = {
        findOneBy: jest.fn().mockResolvedValue({ id: 99 }),
        setNewUpdateTime: jest.fn(),
      };
      jest.spyOn(bankTxService, 'getBankTxRepo').mockReturnValue(bankTxRepo as never);
      const updateBankDataInternalSpy = jest
        .spyOn(bankDataService, 'updateBankDataInternal')
        .mockResolvedValue(freshBankData as never);
      const updateBankDataSpy = jest.spyOn(bankDataService, 'updateBankData');
      const webhookSpy = jest.spyOn(service, 'triggerWebhook').mockResolvedValue();
      const updateSellVolumeSpy = jest.spyOn(service, 'updateSellVolume').mockResolvedValue();
      const updateRefVolumeSpy = jest
        .spyOn(service as unknown as { updateRefVolume: (...args: unknown[]) => Promise<void> }, 'updateRefVolume')
        .mockResolvedValue(undefined);
      const bankTxUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const bankDataFindOne = jest.fn().mockResolvedValue(freshBankData);
      const manager = {
        save: jest.fn(async (_type: unknown, e: BuyFiat) => e),
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === CryptoInput) return options.select?.id ? { id: 24 } : pendingForward;
          return undefined;
        }),
        getRepository: jest.fn((type: unknown) => {
          if (type === BankTx) return { update: bankTxUpdate };
          return { findOne: bankDataFindOne };
        }),
      };
      mockManagerTransaction(manager);

      await expect(
        service.update(
          81,
          Object.assign(new UpdateBuyFiatDto(), {
            chargebackAllowedDate: new Date(),
            chargebackDate: new Date(),
            amountInChf: 10,
            amountInEur: 10,
            bankTxId: 99,
            bankDataActive: true,
          }),
          AmlSourceType.MANUAL_UPDATE,
        ),
      ).rejects.toThrow(new BadRequestException('CryptoInput forward is pending confirmation - retry once confirmed'));

      // In-tx mutations ran through the manager (would roll back with the failed routing).
      expect(manager.getRepository).toHaveBeenCalledWith(BankTx);
      expect(bankTxUpdate).toHaveBeenCalledWith(99, expect.objectContaining({ updated: expect.any(Date) }));
      expect(bankDataFindOne).toHaveBeenCalledWith({
        where: { id: 7 },
        relations: { userData: true },
      });
      expect(updateBankDataInternalSpy).toHaveBeenCalledWith(freshBankData, { approved: true }, manager);
      // Pre-tx paths must not escape the rollback.
      expect(bankTxRepo.setNewUpdateTime).not.toHaveBeenCalled();
      expect(updateBankDataSpy).not.toHaveBeenCalled();
      // Transaction mock rethrows, so nothing after the tx runs — release did not commit.
      expect(webhookSpy).not.toHaveBeenCalled();
      expect(updateSellVolumeSpy).not.toHaveBeenCalled();
      expect(updateRefVolumeSpy).not.toHaveBeenCalled();
      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });

    it('fails loud when chargebackAmount is missing so the release does not commit without a return', async () => {
      const cryptoInput = createCustomCryptoInput({
        id: 26,
        action: PayInAction.WAITING,
        status: PayInStatus.ACKNOWLEDGED,
        returnTxId: null,
      });
      const entity = createCustomBuyFiat({
        id: 83,
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        chargebackAllowedDate: null,
        chargebackAddress: '0x0000000000000000000000000000000000000001',
        chargebackAmount: null,
        cryptoInput,
      });
      jest.spyOn(buyFiatRepo, 'findOne').mockResolvedValue(entity);
      jest
        .spyOn(buyFiatRepo, 'create')
        .mockImplementation((dto: DeepPartial<BuyFiat>) => Object.assign(new BuyFiat(), dto));
      const webhookSpy = jest.spyOn(service, 'triggerWebhook').mockResolvedValue();
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const doPayoutSpy = jest.spyOn(payoutService, 'doPayout').mockResolvedValue(undefined as never);
      const manager = {
        save: jest.fn(async (_type: unknown, e: BuyFiat) => e),
      };
      mockManagerTransaction(manager);

      await expect(
        service.update(
          83,
          Object.assign(new UpdateBuyFiatDto(), {
            chargebackAllowedDate: new Date(),
            chargebackDate: new Date(),
          }),
          AmlSourceType.MANUAL_UPDATE,
        ),
      ).rejects.toThrow(
        new BadRequestException('Chargeback address, amount or asset missing - refund cannot be routed'),
      );

      expect(webhookSpy).not.toHaveBeenCalled();
      expect(returnPayInSpy).not.toHaveBeenCalled();
      expect(doPayoutSpy).not.toHaveBeenCalled();
      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });

    it('with a manager, triggerBuyFiatReturn reads the pay-in via manager.findOne not getPayIn', async () => {
      const cryptoInput = createCustomCryptoInput({
        id: 25,
        action: PayInAction.WAITING,
        status: PayInStatus.ACKNOWLEDGED,
        returnTxId: null,
      });
      const buyFiat = createCustomBuyFiat({
        id: 82,
        chargebackAddress: '0x0000000000000000000000000000000000000001',
        chargebackAmount: 0.1,
      });
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const getPayInSpy = jest.spyOn(payInService, 'getPayIn');
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === CryptoInput) return options.select?.id ? { id: 25 } : cryptoInput;
          return undefined;
        }),
      };

      await service['triggerBuyFiatReturn'](buyFiat, cryptoInput, manager as unknown as EntityManager);

      expect(manager.findOne).toHaveBeenCalledWith(
        CryptoInput,
        expect.objectContaining({
          where: { id: 25 },
          select: { id: true },
          loadEagerRelations: false,
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(manager.findOne).toHaveBeenCalledWith(
        CryptoInput,
        expect.objectContaining({
          where: { id: 25 },
          relations: { asset: true },
        }),
      );
      expect(getPayInSpy).not.toHaveBeenCalled();
      expect(returnPayInSpy).toHaveBeenCalledWith(cryptoInput, buyFiat.chargebackAddress, 0.1, manager);
    });
  });

  describe('resetAmlCheckInternal claim (F2)', () => {
    it('claims with the pinned where and applies resetAmlCheck update', async () => {
      const cryptoInput = createCustomCryptoInput({ id: 30 });
      const userDate = new Date('2026-07-15T00:00:00.000Z');
      const entity = createCustomBuyFiat({
        id: 90,
        amlCheck: CheckStatus.PENDING,
        amlReason: null,
        isComplete: false,
        chargebackAllowedDate: null,
        chargebackAllowedDateUser: userDate,
        chargebackDate: null,
        chargebackTxId: null,
        cryptoInput,
        fiatOutput: null,
      });
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyFiat) return options.select?.id ? { id: 90 } : entity;
          if (type === CryptoInput) return options.select?.id ? { id: 30 } : cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManagerTransaction(manager);

      await service.resetAmlCheckInternal(entity, AmlSourceType.MANUAL_RESET);

      expect(manager.update).toHaveBeenCalledWith(
        BuyFiat,
        {
          id: 90,
          amlCheck: CheckStatus.PENDING,
          isComplete: false,
          chargebackAllowedDate: IsNull(),
          chargebackAllowedDateUser: userDate,
          chargebackDate: IsNull(),
          chargebackTxId: IsNull(),
        },
        expect.objectContaining({ amlCheck: null, amlReason: null, amlPostProcessed: false }),
      );
      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalled();
    });

    it('throws ConflictException on a lost claim and skips side effects', async () => {
      const cryptoInput = createCustomCryptoInput({ id: 31 });
      const entity = createCustomBuyFiat({
        id: 91,
        amlCheck: CheckStatus.FAIL,
        amlReason: null,
        isComplete: false,
        chargebackAllowedDate: null,
        chargebackAllowedDateUser: null,
        chargebackDate: null,
        chargebackTxId: null,
        cryptoInput,
        fiatOutput: createCustomFiatOutput({ id: 44 }),
      });
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyFiat) return options.select?.id ? { id: 91 } : entity;
          if (type === CryptoInput) return options.select?.id ? { id: 31 } : cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      mockManagerTransaction(manager);

      await expect(service.resetAmlCheckInternal(entity, AmlSourceType.MANUAL_RESET)).rejects.toThrow(
        new ConflictException('BuyFiat state changed concurrently'),
      );

      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
      expect(fiatOutputService.delete).not.toHaveBeenCalled();
      expect(supportLogService.createSupportLog).not.toHaveBeenCalled();
    });

    it('evaluates guards against the fresh entity (released row → BadRequest, no update)', async () => {
      const cryptoInput = createCustomCryptoInput({ id: 32 });
      // Caller snapshot still looks resettable.
      const caller = createCustomBuyFiat({
        id: 92,
        amlCheck: CheckStatus.PENDING,
        isComplete: false,
        chargebackAllowedDate: null,
        cryptoInput,
      });
      // Fresh row already released for chargeback.
      const freshReleased = createCustomBuyFiat({
        id: 92,
        amlCheck: CheckStatus.PENDING,
        isComplete: false,
        chargebackAllowedDate: new Date('2026-08-01T00:00:00.000Z'),
        cryptoInput,
        fiatOutput: null,
        transaction: caller.transaction,
      });
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyFiat) return options.select?.id ? { id: 92 } : freshReleased;
          if (type === CryptoInput) return options.select?.id ? { id: 32 } : cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManagerTransaction(manager);

      await expect(service.resetAmlCheckInternal(caller, AmlSourceType.MANUAL_RESET)).rejects.toThrow(
        new BadRequestException('BuyFiat is already complete or refund in progress'),
      );

      expect(manager.update).not.toHaveBeenCalled();
      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });

    it('pins chargebackAllowedDateUser to IsNull when the fresh row has none', async () => {
      const cryptoInput = createCustomCryptoInput({ id: 33 });
      const entity = createCustomBuyFiat({
        id: 93,
        amlCheck: CheckStatus.GSHEET,
        amlReason: null,
        isComplete: false,
        chargebackAllowedDate: null,
        chargebackAllowedDateUser: null,
        chargebackDate: null,
        chargebackTxId: null,
        cryptoInput,
        fiatOutput: null,
      });
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyFiat) return options.select?.id ? { id: 93 } : entity;
          if (type === CryptoInput) return options.select?.id ? { id: 33 } : cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManagerTransaction(manager);

      await service.resetAmlCheckInternal(entity, AmlSourceType.PHONE_CALL_RESET);

      expect(manager.update).toHaveBeenCalledWith(
        BuyFiat,
        expect.objectContaining({
          id: 93,
          chargebackAllowedDateUser: IsNull(),
          chargebackAllowedDate: IsNull(),
          chargebackDate: IsNull(),
          chargebackTxId: IsNull(),
        }),
        expect.objectContaining({ amlCheck: null }),
      );
    });
  });

  describe('refundBuyFiatInternal', () => {
    it('claims the BuyFiat before returnPayIn on the approval leg and pins the caller request version', async () => {
      const cryptoInput = createCustomCryptoInput({
        id: 23,
        action: PayInAction.WAITING,
        status: PayInStatus.ACKNOWLEDGED,
      });
      const staleUserDate = new Date('2026-07-01T10:00:00.000Z');
      const freshUserDate = new Date('2026-07-02T10:00:00.000Z');
      const staleChargebackAddress = '0x00000000000000000000000000000000000000aa';
      const freshChargebackAddress = '0x00000000000000000000000000000000000000bb';
      const staleChargebackAmount = 1;
      const freshChargebackAmount = 99;
      const buyFiat = createCustomBuyFiat({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        outputAmount: null,
        chargebackAmount: staleChargebackAmount,
        chargebackAddress: staleChargebackAddress,
        chargebackAllowedDate: null,
        chargebackAllowedDateUser: staleUserDate,
        chargebackDate: null,
        chargebackTxId: null,
        cryptoInput,
      });
      // Fresh row was amended between cron select and claim (request version, address, amount).
      const currentBuyFiat = createCustomBuyFiat({
        ...buyFiat,
        chargebackAllowedDateUser: freshUserDate,
        chargebackAddress: freshChargebackAddress,
        chargebackAmount: freshChargebackAmount,
        cryptoInput: undefined,
      });
      const refundUser = {
        address: '0x0000000000000000000000000000000000000001',
        userData: buyFiat.userData,
        blockchains: [cryptoInput.asset.blockchain],
      };
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(refundUser as never);
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      jest.spyOn(transactionHelper, 'getBlockchainFee').mockResolvedValue(0.01);
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyFiat) return options.select?.id ? { id: 7 } : currentBuyFiat;
          if (type === CryptoInput) return options.select?.id ? { id: 23 } : cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManagerTransaction(manager);

      const allowedDate = new Date('2026-08-01T12:00:00.000Z');
      await service.refundBuyFiatInternal(buyFiat, {
        refundUserAddress: refundUser.address,
        chargebackAllowedDate: allowedDate,
      });

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        BuyFiat,
        expect.objectContaining({
          id: 7,
          chargebackAllowedDate: IsNull(),
          chargebackTxId: IsNull(),
          // Claim pins the CALLER snapshot's request version, address and amount — not the fresh row's.
          chargebackAllowedDateUser: staleUserDate,
          chargebackAddress: staleChargebackAddress,
          chargebackAmount: staleChargebackAmount,
        }),
        expect.objectContaining({ chargebackAllowedDate: allowedDate }),
      );
      expect(returnPayInSpy).toHaveBeenCalledWith(cryptoInput, refundUser.address, staleChargebackAmount, manager);
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(returnPayInSpy.mock.invocationCallOrder[0]);
      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalled();
    });

    it.each([
      { label: 'missing', amount: undefined as number | undefined },
      { label: 'zero', amount: 0 },
    ])(
      'rejects the approval leg when chargeback amount is $label before fee fetch or transaction',
      async ({ amount }) => {
        const cryptoInput = createCustomCryptoInput({
          id: 23,
          action: PayInAction.WAITING,
          status: PayInStatus.ACKNOWLEDGED,
        });
        const buyFiat = createCustomBuyFiat({
          id: 8,
          amlCheck: CheckStatus.PENDING,
          outputAmount: null,
          chargebackAmount: amount,
          chargebackAddress: '0x00000000000000000000000000000000000000aa',
          chargebackAllowedDate: null,
          chargebackAllowedDateUser: new Date('2026-07-01T10:00:00.000Z'),
          chargebackDate: null,
          chargebackTxId: null,
          cryptoInput,
        });
        const refundUser = {
          address: '0x0000000000000000000000000000000000000001',
          userData: buyFiat.userData,
          blockchains: [cryptoInput.asset.blockchain],
        };
        jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(refundUser as never);
        const validateSpy = jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
        validateSpy.mockClear();
        const getFeeSpy = jest.spyOn(transactionHelper, 'getBlockchainFee');
        getFeeSpy.mockClear();
        const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
        returnPayInSpy.mockClear();
        const transactionSpy = jest.fn();
        Object.defineProperty(buyFiatRepo, 'manager', {
          configurable: true,
          value: { transaction: transactionSpy },
        });

        await expect(
          service.refundBuyFiatInternal(buyFiat, {
            refundUserAddress: refundUser.address,
            chargebackAllowedDate: new Date(),
            ...(amount !== undefined ? { chargebackAmount: amount } : {}),
          }),
        ).rejects.toThrow(new BadRequestException('Chargeback amount missing - release rejected'));

        expect(getFeeSpy).not.toHaveBeenCalled();
        expect(transactionSpy).not.toHaveBeenCalled();
        expect(returnPayInSpy).not.toHaveBeenCalled();
        // Outer validation must not run either — fail before any side-effect path.
        expect(validateSpy).not.toHaveBeenCalled();
      },
    );

    it('does not call returnPayIn or createFromEntity when the claim loses (request-version drift)', async () => {
      const cryptoInput = createCustomCryptoInput({ id: 23 });
      const buyFiat = createCustomBuyFiat({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        outputAmount: null,
        chargebackAmount: 1,
        chargebackAllowedDateUser: new Date('2026-07-01T10:00:00.000Z'),
        cryptoInput,
      });
      const refundUser = {
        address: '0x0000000000000000000000000000000000000001',
        userData: buyFiat.userData,
        blockchains: [cryptoInput.asset.blockchain],
      };
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(refundUser as never);
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      jest.spyOn(transactionHelper, 'getBlockchainFee').mockResolvedValue(0.01);
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const manager = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce({ id: 7 })
          .mockResolvedValueOnce(buyFiat)
          .mockResolvedValueOnce({ id: 23 })
          .mockResolvedValueOnce(cryptoInput),
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      mockManagerTransaction(manager);

      await expect(
        service.refundBuyFiatInternal(buyFiat, {
          refundUserAddress: refundUser.address,
          chargebackAllowedDate: new Date(),
        }),
      ).rejects.toThrow(new ConflictException('BuyFiat refund state changed concurrently'));

      expect(returnPayInSpy).not.toHaveBeenCalled();
      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });

    it('claims on the user-request leg without scheduling a return', async () => {
      const cryptoInput = createCustomCryptoInput({
        id: 23,
        action: PayInAction.WAITING,
        status: PayInStatus.ACKNOWLEDGED,
      });
      const buyFiat = createCustomBuyFiat({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        outputAmount: null,
        chargebackAmount: 1,
        chargebackAllowedDate: null,
        chargebackAllowedDateUser: null,
        chargebackDate: null,
        chargebackTxId: null,
        cryptoInput,
      });
      const currentBuyFiat = createCustomBuyFiat({ ...buyFiat, cryptoInput: undefined });
      const refundUser = {
        address: '0x0000000000000000000000000000000000000001',
        userData: buyFiat.userData,
        blockchains: [cryptoInput.asset.blockchain],
      };
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(refundUser as never);
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const doPayoutSpy = jest.spyOn(payoutService, 'doPayout').mockResolvedValue(undefined as never);
      const getFeeSpy = jest.spyOn(transactionHelper, 'getBlockchainFee');
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyFiat) return options.select?.id ? { id: 7 } : currentBuyFiat;
          if (type === CryptoInput) return options.select?.id ? { id: 23 } : cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManagerTransaction(manager);

      const userDate = new Date('2026-08-01T10:00:00.000Z');
      await service.refundBuyFiatInternal(buyFiat, {
        refundUserAddress: refundUser.address,
        chargebackAllowedDateUser: userDate,
      });

      expect(manager.update).toHaveBeenCalledWith(
        BuyFiat,
        expect.objectContaining({ id: 7, chargebackAllowedDate: IsNull() }),
        expect.objectContaining({ chargebackAllowedDateUser: userDate }),
      );
      expect(returnPayInSpy).not.toHaveBeenCalled();
      expect(doPayoutSpy).not.toHaveBeenCalled();
      expect(getFeeSpy).not.toHaveBeenCalled();
      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalled();
    });

    it('re-validates the fresh entity inside the transaction', async () => {
      // Earlier tests in this suite mock validateRefund; restore so the in-tx re-check runs for real.
      jest.spyOn(TransactionUtilService, 'validateRefund').mockRestore();

      const cryptoInput = createCustomCryptoInput({
        id: 23,
        action: PayInAction.WAITING,
        status: PayInStatus.ACKNOWLEDGED,
      });
      const buyFiat = createCustomBuyFiat({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        outputAmount: null,
        inputAmount: 100,
        chargebackAmount: 1,
        chargebackAllowedDate: null,
        chargebackDate: null,
        chargebackTxId: null,
        cryptoInput,
      });
      // Fresh row already has an approved chargeback — validateRefund must reject it.
      const alreadyReturned = createCustomBuyFiat({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        outputAmount: null,
        inputAmount: 100,
        chargebackAmount: 1,
        chargebackAllowedDate: new Date('2026-07-01T00:00:00.000Z'),
        chargebackDate: null,
        chargebackTxId: null,
        cryptoInput: undefined,
        transaction: buyFiat.transaction,
      });
      const refundUser = {
        address: '0x0000000000000000000000000000000000000001',
        userData: buyFiat.userData,
        blockchains: [cryptoInput.asset.blockchain],
      };
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(refundUser as never);
      jest.spyOn(transactionHelper, 'getBlockchainFee').mockResolvedValue(0.01);
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyFiat) return options.select?.id ? { id: 7 } : alreadyReturned;
          if (type === CryptoInput) return options.select?.id ? { id: 23 } : cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManagerTransaction(manager);

      await expect(
        service.refundBuyFiatInternal(buyFiat, {
          refundUserAddress: refundUser.address,
          chargebackAllowedDate: new Date(),
        }),
      ).rejects.toThrow(new BadRequestException('Transaction is already returned'));

      expect(manager.update).not.toHaveBeenCalled();
      expect(returnPayInSpy).not.toHaveBeenCalled();
    });

    it('uses doPayout for FORWARD_CONFIRMED crypto inputs after a winning claim', async () => {
      const cryptoInput = createCustomCryptoInput({
        id: 23,
        action: PayInAction.FORWARD,
        status: PayInStatus.FORWARD_CONFIRMED,
      });
      const buyFiat = createCustomBuyFiat({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        outputAmount: null,
        chargebackAmount: 1,
        chargebackAllowedDate: null,
        chargebackDate: null,
        chargebackTxId: null,
        cryptoInput,
      });
      const currentBuyFiat = createCustomBuyFiat({ ...buyFiat, cryptoInput: undefined });
      const refundUser = {
        address: '0x0000000000000000000000000000000000000001',
        userData: buyFiat.userData,
        blockchains: [cryptoInput.asset.blockchain],
      };
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(refundUser as never);
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      jest.spyOn(transactionHelper, 'getBlockchainFee').mockResolvedValue(0.01);
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const doPayoutSpy = jest.spyOn(payoutService, 'doPayout').mockResolvedValue(undefined as never);
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyFiat) return options.select?.id ? { id: 7 } : currentBuyFiat;
          if (type === CryptoInput) return options.select?.id ? { id: 23 } : cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockManagerTransaction(manager);

      await service.refundBuyFiatInternal(buyFiat, {
        refundUserAddress: refundUser.address,
        chargebackAllowedDate: new Date(),
      });

      expect(manager.update).toHaveBeenCalled();
      expect(doPayoutSpy).toHaveBeenCalledWith(
        {
          context: PayoutOrderContext.BUY_FIAT_RETURN,
          correlationId: '7',
          asset: cryptoInput.asset,
          amount: 1,
          destinationAddress: refundUser.address,
        },
        manager,
      );
      expect(returnPayInSpy).not.toHaveBeenCalled();
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(doPayoutSpy.mock.invocationCallOrder[0]);
    });
  });

  describe('getPendingChargebacks', () => {
    // Where exclusions keep already-completed chargebacks out of the pending queue so
    // compliance is not asked again to approve a refund that already went through.
    it('excludes completed chargebacks from the pending queue and loads required relations', async () => {
      const findSpy = jest.spyOn(buyFiatRepo, 'find').mockResolvedValue([]);

      await service.getPendingChargebacks();

      expect(findSpy).toHaveBeenCalledWith({
        where: {
          chargebackAllowedDateUser: Not(IsNull()),
          chargebackAllowedDate: IsNull(),
          chargebackDate: IsNull(),
          chargebackTxId: IsNull(),
          isComplete: false,
          outputAmount: IsNull(),
        },
        relations: {
          transaction: { userData: true, user: true },
          cryptoInput: true,
        },
        order: { chargebackAllowedDateUser: 'ASC' },
      });
    });
  });
});
