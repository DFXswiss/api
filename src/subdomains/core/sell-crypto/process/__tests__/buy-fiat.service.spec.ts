import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScorechainScreening } from 'src/integration/scorechain/entities/scorechain-screening.entity';
import { ScorechainScreeningService } from 'src/integration/scorechain/services/scorechain-screening.service';
import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { AmlSourceType } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { CustodyOrderService } from 'src/subdomains/core/custody/services/custody-order.service';
import { ScorechainDocumentService } from 'src/subdomains/generic/kyc/services/scorechain-document.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { createCustomFiatOutput } from 'src/subdomains/supporting/fiat-output/__mocks__/fiat-output.entity.mock';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { SupportLogService } from 'src/subdomains/supporting/support-issue/services/support-log.service';
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

      jest.spyOn(buyFiatRepo, 'find').mockResolvedValue(wantedData);
    }
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
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

  describe('amlCheck audit trail', () => {
    it('records a MANUAL_RESET history row (previous verdict → null) when resetAmlCheckInternal clears the check', async () => {
      const entity = createCustomBuyFiat({ id: 5, amlCheck: CheckStatus.PENDING, amlReason: null });

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
      jest.spyOn(buyFiatRepo, 'save').mockImplementation(async (e) => e as BuyFiat);

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
      jest.spyOn(buyFiatRepo, 'save').mockImplementation(async (e) => e as BuyFiat);

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
});
