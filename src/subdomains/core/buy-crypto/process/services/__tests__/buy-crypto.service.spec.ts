import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CheckoutPaymentStatus } from 'src/integration/checkout/dto/checkout.dto';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { ScorechainScreening } from 'src/integration/scorechain/entities/scorechain-screening.entity';
import { ScorechainScreeningService } from 'src/integration/scorechain/services/scorechain-screening.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { AmlSourceType, TransactionAmlCheck } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { CustodyOrderService } from 'src/subdomains/core/custody/services/custody-order.service';
import { createCustomHistory } from 'src/subdomains/core/history/dto/__mocks__/history.dto.mock';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { ScorechainDocumentService } from 'src/subdomains/generic/kyc/services/scorechain-document.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { FiatOutputType } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { CryptoInput, PayInAction, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { EntityManager, IsNull } from 'typeorm';
import { BuyRepository } from '../../../routes/buy/buy.repository';
import { BuyService } from '../../../routes/buy/buy.service';
import { createCustomBuyHistory } from '../../../routes/buy/dto/__mocks__/buy-history.dto.mock';
import { UpdateBuyCryptoDto } from '../../dto/update-buy-crypto.dto';
import { createCustomBuyCrypto } from '../../entities/__mocks__/buy-crypto.entity.mock';
import { BuyCrypto, BuyCryptoStatus } from '../../entities/buy-crypto.entity';
import { BuyCryptoFee } from '../../entities/buy-crypto-fees.entity';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from '../buy-crypto-notification.service';
import { BuyCryptoWebhookService } from '../buy-crypto-webhook.service';
import { BuyCryptoService } from '../buy-crypto.service';

enum MockBuyData {
  DEFAULT,
  BUY_HISTORY_EMPTY,
  BUY_HISTORY,
  BUY_HISTORY_SMALL,
  CRYPTO_HISTORY_EMPTY,
  CRYPTO_HISTORY,
}

describe('BuyCryptoService', () => {
  let service: BuyCryptoService;

  let buyCryptoRepo: BuyCryptoRepository;
  let bankTxService: BankTxService;
  let buyRepo: BuyRepository;
  let buyService: BuyService;
  let swapService: SwapService;
  let userService: UserService;
  let buyFiatService: BuyFiatService;
  let buyCryptoWebhookService: BuyCryptoWebhookService;
  let assetService: AssetService;
  let fiatService: FiatService;
  let bankDataService: BankDataService;
  let transactionRequestService: TransactionRequestService;
  let specialExternalBankAccountService: SpecialExternalAccountService;
  let transactionService: TransactionService;
  let siftService: SiftService;
  let checkoutService: CheckoutService;
  let payInService: PayInService;
  let fiatOutputService: FiatOutputService;
  let transactionUtilService: TransactionUtilService;
  let buyCryptoNotificationService: BuyCryptoNotificationService;
  let amlService: AmlService;
  let transactionHelper: TransactionHelper;
  let custodyOrderService: CustodyOrderService;
  let userDataService: UserDataService;
  let scorechainScreeningService: ScorechainScreeningService;
  let scorechainDocumentService: ScorechainDocumentService;
  let transactionAmlCheckService: TransactionAmlCheckService;

  beforeEach(async () => {
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    bankTxService = createMock<BankTxService>();
    buyRepo = createMock<BuyRepository>();
    buyService = createMock<BuyService>();
    swapService = createMock<SwapService>();
    userService = createMock<UserService>();
    buyFiatService = createMock<BuyFiatService>();
    buyCryptoWebhookService = createMock<BuyCryptoWebhookService>();
    assetService = createMock<AssetService>();
    fiatService = createMock<FiatService>();
    bankDataService = createMock<BankDataService>();
    transactionRequestService = createMock<TransactionRequestService>();
    specialExternalBankAccountService = createMock<SpecialExternalAccountService>();
    transactionService = createMock<TransactionService>();
    siftService = createMock<SiftService>();
    checkoutService = createMock<CheckoutService>();
    payInService = createMock<PayInService>();
    fiatOutputService = createMock<FiatOutputService>();
    transactionUtilService = createMock<TransactionUtilService>();
    buyCryptoNotificationService = createMock<BuyCryptoNotificationService>();
    amlService = createMock<AmlService>();
    transactionHelper = createMock<TransactionHelper>();
    custodyOrderService = createMock<CustodyOrderService>();
    userDataService = createMock<UserDataService>();
    scorechainScreeningService = createMock<ScorechainScreeningService>();
    scorechainDocumentService = createMock<ScorechainDocumentService>();
    transactionAmlCheckService = createMock<TransactionAmlCheckService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyCryptoService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: BankTxService, useValue: bankTxService },
        { provide: BuyRepository, useValue: buyRepo },
        { provide: BuyService, useValue: buyService },
        { provide: SwapService, useValue: swapService },
        { provide: UserService, useValue: userService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: BuyCryptoWebhookService, useValue: buyCryptoWebhookService },
        { provide: AssetService, useValue: assetService },
        { provide: FiatService, useValue: fiatService },
        { provide: BankDataService, useValue: bankDataService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: SpecialExternalAccountService, useValue: specialExternalBankAccountService },
        { provide: TransactionService, useValue: transactionService },
        { provide: SiftService, useValue: siftService },
        { provide: CheckoutService, useValue: checkoutService },
        { provide: PayInService, useValue: payInService },
        { provide: FiatOutputService, useValue: fiatOutputService },
        { provide: TransactionUtilService, useValue: transactionUtilService },
        { provide: BuyCryptoNotificationService, useValue: buyCryptoNotificationService },
        { provide: AmlService, useValue: amlService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: CustodyOrderService, useValue: custodyOrderService },
        { provide: UserDataService, useValue: userDataService },
        { provide: ScorechainScreeningService, useValue: scorechainScreeningService },
        { provide: ScorechainDocumentService, useValue: scorechainDocumentService },
        { provide: TransactionAmlCheckService, useValue: transactionAmlCheckService },
      ],
    }).compile();

    service = module.get<BuyCryptoService>(BuyCryptoService);
  });

  const txOne = {
    inputAmount: 1,
    inputAsset: 'EUR',
    outputAmount: 0.00005,
    outputAsset: 'BTC',
  };

  const txTwo = {
    inputAmount: 10,
    inputAsset: 'EUR',
    outputAmount: 0.0005,
    outputAsset: 'BTC',
  };

  const txSmallAmount = {
    inputAmount: 1,
    inputAsset: 'EUR',
    outputAmount: 3e-8,
    outputAsset: 'GOOGL',
  };

  const txCrypto = {
    inputAmount: 1,
    inputAsset: 'BTC',
    outputAmount: 0.988,
    outputAsset: 'BTC',
    txId: 'TX_ID_01',
  };

  function setup(mock: MockBuyData, date?: Date) {
    if (mock !== MockBuyData.DEFAULT) {
      let wantedData: BuyCrypto[] = [];
      switch (mock) {
        case MockBuyData.BUY_HISTORY:
          wantedData = [
            createCustomBuyCrypto({ outputDate: date, ...txOne, outputAsset: createCustomAsset({ dexName: 'BTC' }) }),
            createCustomBuyCrypto({ outputDate: date, ...txTwo, outputAsset: createCustomAsset({ dexName: 'BTC' }) }),
          ];
          break;
        case MockBuyData.BUY_HISTORY_SMALL:
          wantedData = [
            createCustomBuyCrypto({
              outputDate: date,
              ...txSmallAmount,
              outputAsset: createCustomAsset({ dexName: 'GOOGL' }),
            }),
          ];
          break;
        case MockBuyData.CRYPTO_HISTORY:
          wantedData = [
            createCustomBuyCrypto({
              outputDate: date,
              cryptoInput: createCustomCryptoInput({}),
              ...txCrypto,
              outputAsset: createCustomAsset({ dexName: 'BTC' }),
            }),
          ];
          break;
      }

      // The history goes through the projected queries; both are stubbed because one `setup`
      // serves the buy-route and the swap-route cases.
      jest.spyOn(buyCryptoRepo, 'findBuyHistory').mockResolvedValue(wantedData);
      jest.spyOn(buyCryptoRepo, 'findSwapHistory').mockResolvedValue(wantedData);
    }
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return an empty array, if buy route has no history', async () => {
    setup(MockBuyData.BUY_HISTORY_EMPTY);

    await expect(service.getBuyHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if buy route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY, date);

    await expect(service.getBuyHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyHistory({
        date: date,
        ...txOne,
      }),
      createCustomBuyHistory({
        date: date,
        ...txTwo,
      }),
    ]);
  });

  it('should return a history, if buy route has transactions and show small amount correctly', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY_SMALL, date);

    await expect(service.getBuyHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyHistory({
        date: date,
        ...txSmallAmount,
      }),
    ]);
  });

  it('should return an empty history, if crypto route has no transactions', async () => {
    setup(MockBuyData.CRYPTO_HISTORY_EMPTY);

    await expect(service.getCryptoHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if crypto route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.CRYPTO_HISTORY, date);

    await expect(service.getCryptoHistory(1, 1)).resolves.toStrictEqual([
      createCustomHistory({
        date: date,
        ...txCrypto,
      }),
    ]);
  });

  describe('retriggerScorechain', () => {
    it('re-screens the target address on the output blockchain via a fresh (cache-bypassing) call', async () => {
      const entity = {
        id: 42,
        outputAsset: { blockchain: Blockchain.ETHEREUM },
        targetAddress: '0xabc',
      } as unknown as BuyCrypto;
      jest.spyOn(buyCryptoRepo, 'findOne').mockResolvedValue(entity);
      const screening = new ScorechainScreening();
      jest.spyOn(scorechainScreeningService, 'rescreenWithdrawalAddress').mockResolvedValue(screening);

      const result = await service.retriggerScorechain(42);

      expect(scorechainScreeningService.rescreenWithdrawalAddress).toHaveBeenCalledWith(Blockchain.ETHEREUM, '0xabc');
      expect(result).toBe(screening);
      expect(scorechainDocumentService.createScreeningReport).not.toHaveBeenCalled(); // no userData / not newly screened
    });

    it('stores a compliance report when the fresh screening is tied to a customer', async () => {
      const userData = { id: 5 } as any;
      const entity = {
        id: 42,
        outputAsset: { blockchain: Blockchain.ETHEREUM },
        targetAddress: '0xabc',
        userData,
      } as unknown as BuyCrypto;
      jest.spyOn(buyCryptoRepo, 'findOne').mockResolvedValue(entity);
      const screening = Object.assign(new ScorechainScreening(), { isNewlyScreened: true });
      jest.spyOn(scorechainScreeningService, 'rescreenWithdrawalAddress').mockResolvedValue(screening);

      const result = await service.retriggerScorechain(42);

      expect(scorechainDocumentService.createScreeningReport).toHaveBeenCalledWith(userData, screening);
      expect(result).toBe(screening);
    });

    it('throws NotFoundException when the buy-crypto does not exist', async () => {
      jest.spyOn(buyCryptoRepo, 'findOne').mockResolvedValue(null);

      await expect(service.retriggerScorechain(1)).rejects.toThrow(NotFoundException);
      expect(scorechainScreeningService.rescreenWithdrawalAddress).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an output chain Scorechain does not support', async () => {
      const entity = {
        id: 7,
        outputAsset: { blockchain: Blockchain.MONERO },
        targetAddress: 'monero-address',
      } as unknown as BuyCrypto;
      jest.spyOn(buyCryptoRepo, 'findOne').mockResolvedValue(entity);

      await expect(service.retriggerScorechain(7)).rejects.toThrow(BadRequestException);
      expect(scorechainScreeningService.rescreenWithdrawalAddress).not.toHaveBeenCalled();
    });
  });

  describe('amlCheck audit trail', () => {
    it('excludes user refund claims from phone-call AML resets', async () => {
      const findBySpy = jest.spyOn(buyCryptoRepo, 'findBy').mockResolvedValue([]);

      await service.checkAmlResetTx(Object.assign(new UserData(), { id: 42 }));

      expect(findBySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          chargebackAllowedDate: IsNull(),
          chargebackAllowedDateUser: IsNull(),
        }),
      );
    });

    it('persists the checkout refund claim before calling the external provider', async () => {
      const buyCrypto = createCustomBuyCrypto({
        id: 7,
        inputAmount: 10,
        checkoutTx: Object.assign(new CheckoutTx(), { id: 22, paymentId: 'pay-22' }),
      });
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      const refundPaymentSpy = jest.spyOn(checkoutService, 'refundBuyCryptoPayment').mockResolvedValue({
        action_id: 'action-22',
        _links: { payment: { href: 'https://example.test/payment/pay-22' } },
      });
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyCrypto) return options.select?.id ? { id: 7 } : buyCrypto;
          if (type === CheckoutTx) return buyCrypto.checkoutTx;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });

      await service.refundCheckoutTx(buyCrypto, { chargebackAllowedDate: new Date() });

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        BuyCrypto,
        expect.objectContaining({
          id: 7,
          chargebackOutput: expect.anything(),
          chargebackAllowedDate: expect.anything(),
          chargebackDate: expect.anything(),
          chargebackCryptoTxId: expect.anything(),
          chargebackBankTx: expect.anything(),
        }),
        expect.objectContaining({ chargebackAllowedDate: expect.any(Date) }),
      );
      expect(manager.update).toHaveBeenNthCalledWith(2, CheckoutTx, 22, {
        status: CheckoutPaymentStatus.REFUND_PENDING,
      });
      expect(manager.update.mock.invocationCallOrder[1]).toBeLessThan(refundPaymentSpy.mock.invocationCallOrder[0]);
      expect(refundPaymentSpy).toHaveBeenCalledWith('pay-22', 7);
    });

    it('leaves a failed Checkout submission durably pending for the idempotent retry job', async () => {
      const buyCrypto = createCustomBuyCrypto({
        id: 7,
        inputAmount: 10,
        checkoutTx: Object.assign(new CheckoutTx(), { id: 22, paymentId: 'pay-22' }),
      });
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      jest.spyOn(checkoutService, 'refundBuyCryptoPayment').mockRejectedValue(new Error('network timeout'));
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyCrypto) return options.select?.id ? { id: 7 } : buyCrypto;
          if (type === CheckoutTx) return buyCrypto.checkoutTx;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });

      await expect(service.refundCheckoutTx(buyCrypto, { chargebackAllowedDate: new Date() })).rejects.toThrow(
        'network timeout',
      );

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        BuyCrypto,
        expect.anything(),
        expect.objectContaining({
          amlCheck: CheckStatus.FAIL,
          chargebackAllowedDate: expect.any(Date),
          isComplete: true,
          status: BuyCryptoStatus.COMPLETE,
        }),
      );
      expect(manager.update).toHaveBeenNthCalledWith(2, CheckoutTx, 22, {
        status: CheckoutPaymentStatus.REFUND_PENDING,
      });
      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalled();
    });

    it('claims and schedules a crypto refund atomically before releasing the BuyCrypto lock', async () => {
      const cryptoInput = createCustomCryptoInput({
        id: 23,
        action: PayInAction.WAITING,
        status: PayInStatus.ACKNOWLEDGED,
      });
      const buyCrypto = createCustomBuyCrypto({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        batch: null,
        outputAmount: null,
        chargebackAmount: 1,
        cryptoInput,
      });
      const currentBuyCrypto = createCustomBuyCrypto({ ...buyCrypto, cryptoInput: undefined });
      const refundUser = {
        address: '0x0000000000000000000000000000000000000001',
        userData: buyCrypto.userData,
        blockchains: [cryptoInput.asset.blockchain],
      };
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(refundUser as any);
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      jest.spyOn(transactionHelper, 'getBlockchainFee').mockResolvedValue(0.01);
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyCrypto) return options.select?.id ? { id: 7 } : currentBuyCrypto;
          if (type === CryptoInput) return cryptoInput;
          return undefined;
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });

      await service.refundCryptoInput(buyCrypto, {
        refundUserAddress: refundUser.address,
        chargebackAllowedDate: new Date(),
      });

      expect(manager.update).toHaveBeenCalledWith(
        BuyCrypto,
        expect.objectContaining({
          id: 7,
          chargebackAllowedDate: expect.anything(),
          chargebackDate: expect.anything(),
          chargebackCryptoTxId: expect.anything(),
          chargebackBankTx: expect.anything(),
        }),
        expect.objectContaining({ chargebackAllowedDate: expect.any(Date) }),
      );
      expect(returnPayInSpy).toHaveBeenCalledWith(cryptoInput, refundUser.address, 1, manager);
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(returnPayInSpy.mock.invocationCallOrder[0]);
    });

    it('does not schedule a crypto refund when a concurrent AML reset wins', async () => {
      const cryptoInput = createCustomCryptoInput({ id: 23 });
      const buyCrypto = createCustomBuyCrypto({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        batch: null,
        outputAmount: null,
        chargebackAmount: 1,
        cryptoInput,
      });
      const refundUser = {
        address: '0x0000000000000000000000000000000000000001',
        userData: buyCrypto.userData,
        blockchains: [cryptoInput.asset.blockchain],
      };
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(refundUser as any);
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      jest.spyOn(transactionHelper, 'getBlockchainFee').mockResolvedValue(0.01);
      const returnPayInSpy = jest.spyOn(payInService, 'returnPayIn').mockResolvedValue();
      const manager = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce({ id: 7 })
          .mockResolvedValueOnce(buyCrypto)
          .mockResolvedValueOnce({ id: 23 })
          .mockResolvedValueOnce(cryptoInput),
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });

      await expect(
        service.refundCryptoInput(buyCrypto, {
          refundUserAddress: refundUser.address,
          chargebackAllowedDate: new Date(),
        }),
      ).rejects.toThrow(ConflictException);

      expect(returnPayInSpy).not.toHaveBeenCalled();
    });

    it('creates and claims a bank refund in the same BuyCrypto transaction', async () => {
      const buyCrypto = createCustomBuyCrypto({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        batch: null,
        outputAmount: null,
        inputAsset: 'CHF',
        chargebackAmount: 10,
        chargebackAsset: 'CHF',
        bankTx: { iban: 'CH9300762011623852957' } as any,
      });
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      jest.spyOn(transactionUtilService, 'validateChargebackIban').mockResolvedValue(true);
      const chargebackOutput = { id: 44 } as any;
      const createOutputSpy = jest.spyOn(fiatOutputService, 'createInternal').mockResolvedValue(chargebackOutput);
      const manager = {
        findOne: jest.fn(async (_type: unknown, options: { select?: { id?: boolean } }) =>
          options.select?.id ? { id: 7 } : buyCrypto,
        ),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });
      const chargebackAllowedDate = new Date();

      await service.refundBankTx(buyCrypto, {
        refundIban: 'CH9300762011623852957',
        chargebackAllowedDate,
        creditorData: {
          name: 'Refund Recipient',
          address: 'Main Street',
          zip: '8000',
          city: 'Zurich',
          country: 'CH',
        },
      });

      expect(createOutputSpy).toHaveBeenCalledWith(
        FiatOutputType.BUY_CRYPTO_FAIL,
        { buyCrypto },
        7,
        false,
        expect.objectContaining({ iban: 'CH9300762011623852957', amount: 10, currency: 'CHF' }),
        manager,
      );
      expect(manager.update).toHaveBeenCalledWith(
        BuyCrypto,
        expect.objectContaining({ id: 7, chargebackOutput: expect.anything() }),
        expect.objectContaining({ chargebackAllowedDate, chargebackOutput }),
      );
    });

    it('rolls back a bank refund output when a concurrent AML reset wins', async () => {
      const buyCrypto = createCustomBuyCrypto({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        batch: null,
        outputAmount: null,
        inputAsset: 'CHF',
        chargebackAmount: 10,
        chargebackAsset: 'CHF',
        bankTx: { iban: 'CH9300762011623852957' } as any,
      });
      jest.spyOn(TransactionUtilService, 'validateRefund').mockImplementation();
      jest.spyOn(transactionUtilService, 'validateChargebackIban').mockResolvedValue(true);
      jest.spyOn(fiatOutputService, 'createInternal').mockResolvedValue({ id: 44 } as any);
      const manager = {
        findOne: jest.fn(async (_type: unknown, options: { select?: { id?: boolean } }) =>
          options.select?.id ? { id: 7 } : buyCrypto,
        ),
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });

      await expect(
        service.refundBankTx(buyCrypto, {
          refundIban: 'CH9300762011623852957',
          chargebackAllowedDate: new Date(),
          creditorData: {
            name: 'Refund Recipient',
            address: 'Main Street',
            zip: '8000',
            city: 'Zurich',
            country: 'CH',
          },
        }),
      ).rejects.toThrow(ConflictException);

      expect(buyCryptoRepo.update).not.toHaveBeenCalled();
      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });

    function reviewResetFixture(
      kycStatus = KycStatus.CHECK,
      amlCheck = CheckStatus.PASS,
    ): { entity: BuyCrypto; manager: Record<'findOne' | 'create' | 'save' | 'update' | 'remove', jest.Mock> } {
      const entity = createCustomBuyCrypto({
        id: 7,
        amlCheck,
        amlReason: AmlReason.NA,
        batch: null,
        status: BuyCryptoStatus.MISSING_LIQUIDITY,
        chargebackOutput: undefined,
        chargebackAllowedDate: undefined,
        isComplete: false,
        fee: Object.assign(new BuyCryptoFee(), {
          id: 8,
          allowedTotalFeeAmount: 0.5,
          feeReferenceAsset: { id: 9 },
        }),
        transaction: Object.assign(new Transaction(), {
          id: 70,
          userData: Object.assign(new UserData(), { id: 42 }),
        }),
      });
      const manager = {
        findOne: jest.fn(async (type: unknown, options: { select?: { id?: boolean } }) => {
          if (type === BuyCrypto) return options.select?.id ? { id: 7 } : entity;
          if (type === CheckoutTx) return entity.checkoutTx;
          if (type === CryptoInput) return entity.cryptoInput;
          if (type === UserData) return { id: 42, kycStatus };
          if (type === BuyCryptoFee) return options.select?.id ? { id: 8 } : entity.fee;
          return undefined;
        }),
        create: jest.fn((_type: unknown, dto: unknown) => dto),
        save: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });
      return { entity, manager };
    }

    it('atomically audits a review reset with the authenticated actor before the conditional update', async () => {
      const { manager } = reviewResetFixture();

      await service.resetAmlCheckForReview(
        7,
        { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA },
        99,
      );

      expect(manager.create).toHaveBeenCalledWith(
        TransactionAmlCheck,
        expect.objectContaining({
          entityType: 'BuyCrypto',
          entityId: 7,
          source: AmlSourceType.MANUAL_RESET,
          previousAmlCheck: CheckStatus.PASS,
          previousAmlReason: AmlReason.NA,
          amlResponsible: 'UserData 99',
          comment: expect.any(String),
        }),
      );
      const auditPayload = JSON.parse(manager.create.mock.calls[0][1].comment as string);
      expect(auditPayload).toMatchObject({
        operation: 'BuyCryptoAmlReviewReset',
        before: { amlCheck: CheckStatus.PASS, amlReason: AmlReason.NA, status: BuyCryptoStatus.MISSING_LIQUIDITY },
        after: { amlCheck: null, amlReason: null, status: BuyCryptoStatus.CREATED },
        deletedFee: { id: 8, allowedTotalFeeAmount: 0.5, feeReferenceAssetId: 9 },
      });
      expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(manager.update.mock.invocationCallOrder[0]);
      expect(manager.update).toHaveBeenCalledWith(
        BuyCrypto,
        expect.objectContaining({
          id: 7,
          amlCheck: CheckStatus.PASS,
          amlReason: AmlReason.NA,
          status: BuyCryptoStatus.MISSING_LIQUIDITY,
          isComplete: false,
          batch: expect.anything(),
          chargebackOutput: expect.anything(),
          chargebackAllowedDate: expect.anything(),
          chargebackAllowedDateUser: expect.anything(),
          chargebackDate: expect.anything(),
          chargebackCryptoTxId: expect.anything(),
          chargebackBankTx: expect.anything(),
        }),
        expect.objectContaining({ amlCheck: null, amlReason: null }),
      );
    });

    it('rejects a review reset until the user KYC status is Check', async () => {
      const { manager } = reviewResetFixture(KycStatus.COMPLETED);

      await expect(
        service.resetAmlCheckForReview(7, { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA }, 99),
      ).rejects.toThrow(ConflictException);

      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('does not reactivate a transaction that was stopped before the review reset acquired its lock', async () => {
      const { entity, manager } = reviewResetFixture();
      entity.status = BuyCryptoStatus.STOPPED;

      await expect(
        service.resetAmlCheckForReview(7, { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA }, 99),
      ).rejects.toThrow(BadRequestException);

      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('locks and rejects a checkout refund that started before the review reset', async () => {
      const { entity, manager } = reviewResetFixture();
      entity.checkoutTx = Object.assign(new CheckoutTx(), {
        id: 22,
        status: CheckoutPaymentStatus.REFUND_PENDING,
      });

      await expect(
        service.resetAmlCheckForReview(7, { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA }, 99),
      ).rejects.toThrow(BadRequestException);

      expect(manager.findOne).toHaveBeenCalledWith(
        CheckoutTx,
        expect.objectContaining({ where: { id: 22 }, lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('locks and rejects a crypto return that started before the review reset', async () => {
      const { entity, manager } = reviewResetFixture();
      entity.cryptoInput = Object.assign(new CryptoInput(), {
        id: 23,
        action: PayInAction.RETURN,
        status: PayInStatus.TO_RETURN,
      });

      await expect(
        service.resetAmlCheckForReview(7, { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA }, 99),
      ).rejects.toThrow(BadRequestException);

      expect(manager.findOne).toHaveBeenCalledWith(
        CryptoInput,
        expect.objectContaining({ where: { id: 23 }, lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('locks and rejects a crypto input that was already released for forwarding', async () => {
      const { entity, manager } = reviewResetFixture();
      entity.cryptoInput = Object.assign(new CryptoInput(), {
        id: 24,
        action: PayInAction.FORWARD,
        status: PayInStatus.ACKNOWLEDGED,
      });

      await expect(
        service.resetAmlCheckForReview(7, { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA }, 99),
      ).rejects.toThrow(BadRequestException);

      expect(manager.findOne).toHaveBeenCalledWith(
        CryptoInput,
        expect.objectContaining({ where: { id: 24 }, lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it.each([
      ['chargeback date', { chargebackDate: new Date() }],
      ['crypto return transaction', { chargebackCryptoTxId: 'return-tx' }],
      ['bank return transaction', { chargebackBankTx: { id: 42 } }],
    ])('rejects a review reset with an established %s marker', async (_name, marker) => {
      const { entity, manager } = reviewResetFixture();
      Object.assign(entity, marker);

      await expect(
        service.resetAmlCheckForReview(7, { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA }, 99),
      ).rejects.toThrow(BadRequestException);

      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('does not mutate or delete state when the immutable audit event cannot be saved', async () => {
      const { manager } = reviewResetFixture();
      manager.save.mockRejectedValue(new Error('audit unavailable'));

      await expect(
        service.resetAmlCheckForReview(7, { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA }, 99),
      ).rejects.toThrow('audit unavailable');

      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.remove).not.toHaveBeenCalled();
    });

    it('rejects a stale review reset before writing the audit event', async () => {
      const { manager } = reviewResetFixture(KycStatus.CHECK, CheckStatus.FAIL);

      await expect(
        service.resetAmlCheckForReview(7, { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA }, 99),
      ).rejects.toThrow(ConflictException);

      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('rolls back the audit event when the transaction is stopped concurrently', async () => {
      const { manager } = reviewResetFixture();
      manager.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.resetAmlCheckForReview(7, { expectedAmlCheck: CheckStatus.PASS, expectedAmlReason: AmlReason.NA }, 99),
      ).rejects.toThrow(ConflictException);

      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        BuyCrypto,
        expect.objectContaining({ status: BuyCryptoStatus.MISSING_LIQUIDITY }),
        expect.objectContaining({ status: BuyCryptoStatus.CREATED }),
      );
      expect(manager.remove).not.toHaveBeenCalled();
    });

    it('records a MANUAL_RESET history row (previous verdict → null) when resetAmlCheckInternal clears the check', async () => {
      const entity = createCustomBuyCrypto({
        id: 7,
        amlCheck: CheckStatus.PENDING,
        amlReason: null,
        batch: null,
        chargebackOutput: undefined,
        chargebackAllowedDate: undefined,
        isComplete: false,
      });
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.resetAmlCheckInternal(entity, AmlSourceType.MANUAL_RESET);

      expect(buyCryptoRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          chargebackAllowedDate: IsNull(),
          chargebackAllowedDateUser: IsNull(),
        }),
        expect.anything(),
      );
      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalledTimes(1);
      expect(transactionAmlCheckService.createFromEntity).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, amlCheck: null }),
        'BuyCrypto',
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
      const entity = createCustomBuyCrypto({
        id: 11,
        amlCheck: CheckStatus.PENDING,
        amlReason: null,
        isComplete: false,
      });
      jest.spyOn(buyCryptoRepo, 'findOne').mockResolvedValue(entity);
      jest.spyOn(buyCryptoRepo, 'create').mockImplementation((dto: any) => Object.assign(new BuyCrypto(), dto));
      const manager = {
        create: jest.fn((_type: unknown, value: unknown) => value),
        save: jest.fn(async (_type: unknown, value: BuyCrypto) => value),
      };
      jest
        .spyOn(service as any, 'runWithVersionLock')
        .mockImplementation(async (_id: number, _version: number, run: (manager: EntityManager) => unknown) =>
          run(manager as unknown as EntityManager),
        );

      await service.update(
        11,
        Object.assign(new UpdateBuyCryptoDto(), { recipientMail: 'gs@example.com' }),
        AmlSourceType.MANUAL_UPDATE,
      );

      // the entity handed to the audit trail carries the persisted (unchanged) PENDING verdict, NOT undefined
      expect(manager.create).not.toHaveBeenCalled();
    });

    // Companion: an admin PUT that EXPLICITLY sets amlCheck: null is a genuine verdict clear that save()
    // persists. The coalesce only restores an OMITTED field (undefined), so an explicit null must still
    // reach the audit trail as null rather than being coalesced back to the prior verdict.
    it('records a verdict-cleared row when an admin update explicitly sets amlCheck: null', async () => {
      const entity = createCustomBuyCrypto({
        id: 13,
        amlCheck: CheckStatus.PENDING,
        amlReason: null,
        isComplete: false,
      });
      jest.spyOn(buyCryptoRepo, 'findOne').mockResolvedValue(entity);
      jest.spyOn(buyCryptoRepo, 'create').mockImplementation((dto: any) => Object.assign(new BuyCrypto(), dto));
      const manager = {
        create: jest.fn((_type: unknown, value: unknown) => value),
        save: jest.fn(async (_type: unknown, value: BuyCrypto) => value),
      };
      jest
        .spyOn(service as any, 'runWithVersionLock')
        .mockImplementation(async (_id: number, _version: number, run: (manager: EntityManager) => unknown) =>
          run(manager as unknown as EntityManager),
        );

      await service.update(
        13,
        Object.assign(new UpdateBuyCryptoDto(), { amlCheck: null }),
        AmlSourceType.MANUAL_UPDATE,
      );

      // the explicit null verdict change survives the coalesce and is handed to the audit trail as null
      expect(manager.create).toHaveBeenCalledWith(
        TransactionAmlCheck,
        expect.objectContaining({
          entityType: 'BuyCrypto',
          entityId: 13,
          source: AmlSourceType.MANUAL_UPDATE,
          previousAmlCheck: CheckStatus.PENDING,
          amlCheck: null,
        }),
      );
    });

    it('rejects a generic compliance update before its callback when the locked version changed', async () => {
      const manager = {
        findOne: jest.fn().mockResolvedValue({ id: 15, version: 6 }),
      };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });

      const sideEffect = jest.fn();
      await expect((service as any).runWithVersionLock(15, 5, sideEffect)).rejects.toThrow(ConflictException);

      expect(manager.findOne).toHaveBeenCalledWith(
        BuyCrypto,
        expect.objectContaining({
          where: { id: 15 },
          select: { id: true, version: true },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(sideEffect).not.toHaveBeenCalled();
    });

    it('does not run manual AML post-processing after the saved AML state changed', async () => {
      const entity = createCustomBuyCrypto({
        id: 17,
        version: 8,
        status: BuyCryptoStatus.CREATED,
        amlCheck: CheckStatus.PASS,
        amlReason: AmlReason.NA,
        isComplete: false,
      });
      const manager = { findOne: jest.fn().mockResolvedValue(null) };
      Object.defineProperty(buyCryptoRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
            run(manager as unknown as EntityManager),
          ),
        },
      });
      const postProcess = jest.fn();

      await expect((service as any).runIfAmlStateCurrent(entity, postProcess)).resolves.toBe(false);

      expect(manager.findOne).toHaveBeenCalledWith(
        BuyCrypto,
        expect.objectContaining({
          where: expect.objectContaining({ id: 17, version: 8, amlCheck: CheckStatus.PASS }),
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(postProcess).not.toHaveBeenCalled();
    });

    it('requires the dedicated refund endpoint for checkout refunds in a generic compliance update', async () => {
      const entity = createCustomBuyCrypto({
        id: 18,
        checkoutTx: { id: 22, paymentId: 'pay-22' } as any,
        isComplete: false,
      });
      jest.spyOn(buyCryptoRepo, 'findOne').mockResolvedValue(entity);
      jest.spyOn(buyCryptoRepo, 'create').mockImplementation((dto: any) => Object.assign(new BuyCrypto(), dto));
      jest
        .spyOn(service as any, 'runWithVersionLock')
        .mockImplementation(async (_id: number, _version: number, run: (manager: EntityManager) => unknown) =>
          run({} as EntityManager),
        );

      await expect(
        service.update(
          18,
          Object.assign(new UpdateBuyCryptoDto(), { chargebackAllowedDate: new Date() }),
          AmlSourceType.MANUAL_UPDATE,
        ),
      ).rejects.toThrow('Checkout refunds must use the dedicated refund endpoint');

      expect(checkoutService.refundBuyCryptoPayment).not.toHaveBeenCalled();
    });

    it('does not reset AML or reactivate a stopped BuyCrypto after a phone call', async () => {
      const entity = createCustomBuyCrypto({
        id: 16,
        amlCheck: CheckStatus.FAIL,
        amlReason: AmlReason.MANUAL_CHECK_PHONE,
        status: BuyCryptoStatus.STOPPED,
        isComplete: false,
      });

      await expect(service.resetAmlCheckInternal(entity, AmlSourceType.PHONE_CALL_RESET)).rejects.toThrow(
        BadRequestException,
      );

      expect(buyCryptoRepo.update).not.toHaveBeenCalled();
      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });

    it('does not reset AML or reactivate a user-refund claim after a phone call', async () => {
      const entity = createCustomBuyCrypto({
        id: 17,
        amlCheck: CheckStatus.FAIL,
        amlReason: AmlReason.MANUAL_CHECK_PHONE,
        status: BuyCryptoStatus.CREATED,
        chargebackAllowedDate: undefined,
        chargebackAllowedDateUser: new Date(),
        isComplete: false,
      });

      await expect(service.resetAmlCheckInternal(entity, AmlSourceType.PHONE_CALL_RESET)).rejects.toThrow(
        BadRequestException,
      );

      expect(buyCryptoRepo.update).not.toHaveBeenCalled();
      expect(transactionAmlCheckService.createFromEntity).not.toHaveBeenCalled();
    });
  });

  describe('createFromCryptoInput exact base-unit propagation (#4287 stage 4)', () => {
    it('propagates the linked crypto_input on-chain base units into inputAmountBaseUnits (exact beyond 8 dp)', async () => {
      jest.spyOn(buyCryptoRepo, 'create').mockImplementation((dto: any) => Object.assign(new BuyCrypto(), dto));
      jest.spyOn(service as any, 'createEntity').mockImplementation(async (e: BuyCrypto) => e);

      const cryptoInput = createCustomCryptoInput({
        amount: 1.23456789,
        // 18-dp wei — NOT representable in the 8-dp float `amount`; the exact integer must survive verbatim
        amountBaseUnits: 1234567890123456789n,
        asset: createCustomAsset({ name: 'ETH', decimals: 18 }),
        transaction: { id: 1 } as any,
      });

      const result = await service.createFromCryptoInput(cryptoInput, {} as any);

      expect(result.inputAmountBaseUnits).toBe(1234567890123456789n);
      // existing float column is untouched (backward compatible)
      expect(result.inputAmount).toBe(1.23456789);
    });

    it('fails open to a null inputAmountBaseUnits when the crypto_input has no captured base units', async () => {
      jest.spyOn(buyCryptoRepo, 'create').mockImplementation((dto: any) => Object.assign(new BuyCrypto(), dto));
      jest.spyOn(service as any, 'createEntity').mockImplementation(async (e: BuyCrypto) => e);

      const cryptoInput = createCustomCryptoInput({
        amount: 0.1,
        amountBaseUnits: null,
        transaction: { id: 2 } as any,
      });

      const result = await service.createFromCryptoInput(cryptoInput, {} as any);

      expect(result.inputAmountBaseUnits).toBeNull();
      expect(result.inputAmount).toBe(0.1);
    });
  });
});
