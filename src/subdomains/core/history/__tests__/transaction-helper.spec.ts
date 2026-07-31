import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { createCustomPrice } from 'src/integration/exchange/dto/__mocks__/price.dto.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { createCustomFiat, createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import {
  createCustomUserData,
  createDefaultUserData,
} from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { createDefaultBankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { olkyEUR, yapealEUR } from 'src/subdomains/supporting/bank/bank/__mocks__/bank.entity.mock';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { CardBankName, IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { createCustomVirtualIban } from 'src/subdomains/supporting/bank/virtual-iban/__mocks__/virtual-iban.entity.mock';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { createDefaultCheckoutTx } from 'src/subdomains/supporting/fiat-payin/__mocks__/checkout-tx.entity.mock';
import { createDefaultCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import {
  createChargebackFeeInfo,
  createCustomChargebackFeeInfo,
} from 'src/subdomains/supporting/payment/__mocks__/fee.dto.mock';
import { createCustomTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import { createCustomTransactionRequest } from 'src/subdomains/supporting/payment/__mocks__/transaction-request.entity.mock';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TxStatementType } from 'src/subdomains/supporting/payment/dto/transaction-helper/tx-statement-details.dto';
import { TransactionSpecificationRepository } from 'src/subdomains/supporting/payment/repositories/transaction-specification.repository';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { TransactionSourceType } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { createCustomBuyCrypto } from '../../buy-crypto/process/entities/__mocks__/buy-crypto.entity.mock';
import { createCustomBuyFiat } from '../../sell-crypto/process/__mocks__/buy-fiat.entity.mock';
import { BuyFiatService } from '../../sell-crypto/process/services/buy-fiat.service';

describe('TransactionHelper', () => {
  let txHelper: TransactionHelper;

  let specRepo: TransactionSpecificationRepository;
  let pricingService: PricingService;
  let fiatService: FiatService;
  let feeService: FeeService;
  let buyCryptoService: BuyCryptoService;
  let buyFiatService: BuyFiatService;
  let blockchainRegistryService: BlockchainRegistryService;
  let walletService: WalletService;
  let transactionService: TransactionService;
  let buyService: BuyService;
  let assetService: AssetService;
  let countryService: CountryService;
  let bankService: BankService;
  let virtualIbanService: VirtualIbanService;

  beforeEach(async () => {
    specRepo = createMock<TransactionSpecificationRepository>();
    pricingService = createMock<PricingService>();
    blockchainRegistryService = createMock<BlockchainRegistryService>();
    buyFiatService = createMock<BuyFiatService>();
    walletService = createMock<WalletService>();
    fiatService = createMock<FiatService>();
    buyCryptoService = createMock<BuyCryptoService>();
    feeService = createMock<FeeService>();
    transactionService = createMock<TransactionService>();
    buyService = createMock<BuyService>();
    assetService = createMock<AssetService>();
    countryService = createMock<CountryService>();
    bankService = createMock<BankService>();
    virtualIbanService = createMock<VirtualIbanService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TransactionHelper,
        { provide: TransactionSpecificationRepository, useValue: specRepo },
        { provide: PricingService, useValue: pricingService },
        { provide: BlockchainRegistryService, useValue: blockchainRegistryService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: WalletService, useValue: walletService },
        { provide: FiatService, useValue: fiatService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: FeeService, useValue: feeService },
        { provide: TransactionService, useValue: transactionService },
        { provide: BuyService, useValue: buyService },
        { provide: AssetService, useValue: assetService },
        { provide: CountryService, useValue: countryService },
        { provide: BankService, useValue: bankService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    txHelper = module.get<TransactionHelper>(TransactionHelper);
  });

  const defaultUserData = createDefaultUserData();

  it('should be defined', () => {
    expect(txHelper).toBeDefined();
  });

  it('should return buyCrypto refund data', async () => {
    const transaction = createCustomTransaction({
      buyCrypto: createCustomBuyCrypto({
        amlCheck: CheckStatus.FAIL,
        bankTx: createDefaultBankTx(),
        amountInChf: null,
      }),
      bankTx: createDefaultBankTx(),
    });

    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(createCustomFiat({ name: 'CHF' }));
    jest.spyOn(feeService, 'getChargebackFee').mockResolvedValue(createChargebackFeeInfo());
    jest
      .spyOn(pricingService, 'getPrice')
      .mockResolvedValue(createCustomPrice({ source: 'CHF', target: 'CHF', price: 1 }));

    await expect(
      txHelper.getRefundData(
        transaction.refundTargetEntity,
        defaultUserData,
        IbanBankName.YAPEAL,
        'DE12500105170648489890',
        !transaction.cryptoInput,
      ),
    ).resolves.toMatchObject({
      fee: { network: 0, bank: 1.01 },
      refundAmount: 99.99,
      refundTarget: 'DE12500105170648489890',
    });
  });

  it('should return buyCrypto refund data with manualPrice', async () => {
    const transaction = createCustomTransaction({
      buyCrypto: createCustomBuyCrypto({
        amlCheck: CheckStatus.FAIL,
        bankTx: createDefaultBankTx(),
        amountInChf: 90,
        priceDefinitionAllowedDate: new Date(),
      }),
      bankTx: createDefaultBankTx(),
    });

    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(createCustomFiat({ name: 'CHF' }));
    jest.spyOn(feeService, 'getChargebackFee').mockResolvedValue(createChargebackFeeInfo());
    jest
      .spyOn(pricingService, 'getPrice')
      .mockResolvedValue(createCustomPrice({ source: 'CHF', target: 'CHF', price: 1 }));

    await expect(
      txHelper.getRefundData(
        transaction.refundTargetEntity,
        defaultUserData,
        IbanBankName.YAPEAL,
        'DE12500105170648489890',
        !transaction.cryptoInput,
      ),
    ).resolves.toMatchObject({
      fee: { network: 0, bank: 1.13 },
      refundAmount: 99.88,
      refundTarget: 'DE12500105170648489890',
    });
  });

  it('should return checkout refund data', async () => {
    const transaction = createCustomTransaction({
      buyCrypto: createCustomBuyCrypto({
        amlCheck: CheckStatus.FAIL,
        checkoutTx: createDefaultCheckoutTx(),
      }),
    });

    jest.spyOn(feeService, 'getBlockchainFee').mockResolvedValue(0.01);
    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(createDefaultFiat());
    jest.spyOn(feeService, 'getChargebackFee').mockResolvedValue(createChargebackFeeInfo());
    jest.spyOn(pricingService, 'getPrice').mockResolvedValue(createCustomPrice({ price: 1 }));

    await expect(
      txHelper.getRefundData(
        transaction.refundTargetEntity,
        defaultUserData,
        CardBankName.CHECKOUT,
        undefined,
        !transaction.cryptoInput,
      ),
    ).resolves.toMatchObject({
      fee: { network: 0, bank: 0 },
      refundAmount: 100,
      refundTarget: undefined,
    });
  });

  it('should return cryptoCrypto refund data', async () => {
    const transaction = createCustomTransaction({
      buyCrypto: createCustomBuyCrypto({
        amlCheck: CheckStatus.FAIL,
        cryptoInput: createDefaultCryptoInput(),
      }),
    });

    jest.spyOn(feeService, 'getBlockchainFee').mockResolvedValue(0.01);
    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(createDefaultFiat());
    jest.spyOn(feeService, 'getChargebackFee').mockResolvedValue(createCustomChargebackFeeInfo({ network: 0.01 }));
    jest.spyOn(pricingService, 'getPrice').mockResolvedValue(createCustomPrice({ price: 1 }));

    await expect(
      txHelper.getRefundData(
        transaction.refundTargetEntity,
        defaultUserData,
        undefined,
        undefined,
        !transaction.cryptoInput,
      ),
    ).resolves.toMatchObject({
      fee: { network: 0.01, bank: 0 },
      refundAmount: 99.99,
      refundTarget: undefined,
    });
  });

  it('should return buyFiat refund data', async () => {
    const transaction = createCustomTransaction({
      buyFiat: createCustomBuyFiat({
        amlCheck: CheckStatus.FAIL,
        cryptoInput: createDefaultCryptoInput(),
        amountInChf: null,
      }),
    });

    jest.spyOn(feeService, 'getBlockchainFee').mockResolvedValue(0.01);
    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(createDefaultFiat());
    jest.spyOn(feeService, 'getChargebackFee').mockResolvedValue(createCustomChargebackFeeInfo({ network: 0.01 }));
    jest.spyOn(pricingService, 'getPrice').mockResolvedValue(createCustomPrice({ price: 1 }));

    await expect(
      txHelper.getRefundData(
        transaction.refundTargetEntity,
        defaultUserData,
        undefined,
        undefined,
        !transaction.cryptoInput,
      ),
    ).resolves.toMatchObject({
      fee: { network: 0.01, bank: 0 },
      refundAmount: 0.09,
      refundTarget: undefined,
    });
  });
  describe('getBankIn', () => {
    const eur = createCustomFiat({ name: 'EUR' });

    it('should return the deposit bank for bank transfers', async () => {
      jest.spyOn(virtualIbanService, 'getActiveReceivingForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(bankService, 'getBank').mockResolvedValue(olkyEUR);

      await expect(
        txHelper['getBankIn'](eur, FiatPaymentMethod.BANK, createCustomUserData({ kycLevel: KycLevel.LEVEL_30 })),
      ).resolves.toBe(IbanBankName.OLKY);
    });

    it('should return the vIBAN bank for users with an active vIBAN', async () => {
      jest
        .spyOn(virtualIbanService, 'getActiveReceivingForUserAndCurrency')
        .mockResolvedValue(createCustomVirtualIban({ bank: yapealEUR }));

      await expect(
        txHelper['getBankIn'](eur, FiatPaymentMethod.BANK, createCustomUserData({ kycLevel: KycLevel.LEVEL_50 })),
      ).resolves.toBe(IbanBankName.YAPEAL);
    });

    it('should return the deposit bank for users without an active vIBAN', async () => {
      jest.spyOn(virtualIbanService, 'getActiveReceivingForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(bankService, 'getBank').mockResolvedValue(olkyEUR);

      await expect(
        txHelper['getBankIn'](eur, FiatPaymentMethod.BANK, createCustomUserData({ kycLevel: KycLevel.LEVEL_50 })),
      ).resolves.toBe(IbanBankName.OLKY);
    });

    it('should return the instant bank for instant transfers', async () => {
      jest.spyOn(bankService, 'getBank').mockResolvedValue(olkyEUR);

      await expect(txHelper['getBankIn'](eur, FiatPaymentMethod.INSTANT, undefined)).resolves.toBe(IbanBankName.OLKY);
    });

    it('should return the default bank for card payments', async () => {
      await expect(txHelper['getBankIn'](eur, FiatPaymentMethod.CARD, undefined)).resolves.toBe(CardBankName.CHECKOUT);
    });

    it('should fall back to the default bank if no deposit bank is found', async () => {
      jest.spyOn(bankService, 'getBank').mockResolvedValue(undefined);

      await expect(txHelper['getBankIn'](eur, FiatPaymentMethod.BANK, undefined)).resolves.toBe(IbanBankName.YAPEAL);
    });
  });

  it('uses an explicit bankIn override for fee lookup without re-resolving the bank', async () => {
    const from = createCustomFiat({ name: 'EUR' });
    const to = createCustomFiat({ name: 'CHF' });
    jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: () => 100 } as any);
    const getBankIn = jest.spyOn(txHelper as any, 'getBankIn');
    const getAllFees = jest
      .spyOn(txHelper as any, 'getAllFees')
      .mockResolvedValue([
        { network: 0, dfx: { rate: 0, fixed: 0 }, bank: { rate: 0, fixed: 0 }, partner: { rate: 0, fixed: 0 } },
        0,
      ]);
    jest.spyOn(txHelper as any, 'getMinSpecs').mockReturnValue({ minFee: 0, minVolume: 0 });
    jest.spyOn(txHelper as any, 'getLimits').mockResolvedValue({ kycLimit: 1000, defaultLimit: 1000 });
    jest.spyOn(txHelper as any, 'getTxErrors').mockReturnValue([]);
    jest.spyOn(txHelper as any, 'getSourceSpecs').mockResolvedValue({ volume: { min: 0, max: 1000 } });
    jest.spyOn(txHelper as any, 'getTargetSpecs').mockResolvedValue({ volume: { min: 0, max: 1000 } });
    jest.spyOn(txHelper as any, 'getTargetEstimation').mockResolvedValue({ sourceAmount: 100 });

    await txHelper.getTxDetails(
      100,
      undefined,
      from,
      to,
      FiatPaymentMethod.BANK,
      FiatPaymentMethod.BANK,
      false,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      IbanBankName.FRICK,
    );

    expect(getBankIn).not.toHaveBeenCalled();
    expect(getAllFees.mock.calls[0][4]).toBe(IbanBankName.FRICK);
  });

  it('uses the persisted bank selection when regenerating a completed buy invoice', async () => {
    const userData = createCustomUserData({
      accountType: AccountType.PERSONAL,
      firstname: 'Test',
      surname: 'User',
    });
    const buyCrypto = createCustomBuyCrypto({ inputAmount: 125, isComplete: true, outputAmount: 0.005 });
    const request = createCustomTransactionRequest({
      amount: 100,
      bankId: 19,
      isValid: true,
      routeId: 42,
      sourceId: 2,
      sourcePaymentMethod: FiatPaymentMethod.BANK,
      virtualIbanId: 501,
    });
    const transaction = createCustomTransaction({ buyCrypto, request, userData });
    const bankInfo = {
      bank: IbanBankName.FRICK,
      bic: 'BFRILI22XXX',
      city: 'Balzers',
      country: 'LI',
      iban: 'LI21088100002324013AA',
      isPersonalIban: true,
      name: 'Test User',
      reference: buyCrypto.buy.bankUsage,
      sepaInstant: false,
      street: 'Landstrasse 14',
      zip: '9496',
    };
    jest.spyOn(transactionService, 'getTransactionById').mockResolvedValue(transaction);
    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(createCustomFiat({ id: request.sourceId, name: 'EUR' }));
    jest.spyOn(buyService, 'getBankInfoForRequest').mockResolvedValue(bankInfo);

    const details = await txHelper.getTxStatementDetails(userData.id, transaction.id, TxStatementType.INVOICE);

    expect(details).toEqual(expect.objectContaining({ bankInfo, reference: buyCrypto.buy.bankUsage }));
    expect(details.request).toBeUndefined();
    expect(buyService.getBankInfoForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount: buyCrypto.inputAmount, currency: 'EUR', userData }),
      buyCrypto.buy,
      false,
      request.bankId,
      request.virtualIbanId,
      buyCrypto.buy.asset,
      buyCrypto.buy.user.wallet,
    );
    expect(buyService.getBankInfo).not.toHaveBeenCalled();
  });

  it('keeps completed card invoices on settled values and does not resolve bank details', async () => {
    const userData = createCustomUserData({
      accountType: AccountType.PERSONAL,
      firstname: 'Test',
      surname: 'User',
    });
    const buyCrypto = createCustomBuyCrypto({
      checkoutTx: createDefaultCheckoutTx(),
      inputAmount: 125,
      isComplete: true,
      outputAmount: 0.005,
    });
    const request = createCustomTransactionRequest({
      amount: 100,
      estimatedAmount: 0.004,
      isValid: true,
      sourcePaymentMethod: FiatPaymentMethod.CARD,
    });
    const transaction = createCustomTransaction({
      buyCrypto,
      request,
      sourceType: TransactionSourceType.CHECKOUT_TX,
      userData,
    });
    jest.spyOn(transactionService, 'getTransactionById').mockResolvedValue(transaction);
    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(createCustomFiat({ name: 'EUR' }));

    const details = await txHelper.getTxStatementDetails(userData.id, transaction.id, TxStatementType.INVOICE);

    expect(details.bankInfo).toBeUndefined();
    expect(details.currency).toBe('EUR');
    expect(details.transaction).toBe(transaction);
    expect(details.request).toBeUndefined();
    expect(buyService.getBankInfoForRequest).not.toHaveBeenCalled();
    expect(buyService.getBankInfo).not.toHaveBeenCalled();
  });

  // Regression: resolved as a single join this relation tree selects 1664 columns (61 joined nodes —
  // Asset appears 10x and Country 9x, dragged in by eager relations), so one more @Column anywhere in
  // it trips Postgres' "target lists can have at most 1664 entries" and 500s every invoice/receipt.
  // Loading relations as separate queries keeps the statement path off that cliff for good.
  it('loads statement relations as separate queries instead of one join', async () => {
    const userData = createCustomUserData({
      accountType: AccountType.PERSONAL,
      firstname: 'Test',
      surname: 'User',
    });
    const buyCrypto = createCustomBuyCrypto({
      checkoutTx: createDefaultCheckoutTx(),
      inputAmount: 125,
      isComplete: true,
      outputAmount: 0.005,
    });
    const transaction = createCustomTransaction({
      buyCrypto,
      sourceType: TransactionSourceType.CHECKOUT_TX,
      userData,
    });
    const uid = 'T0123456789ABCDEF';
    jest.spyOn(transactionService, 'getTransactionById').mockResolvedValue(transaction);
    jest.spyOn(transactionService, 'getTransactionByUid').mockResolvedValue(transaction);
    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(createCustomFiat({ name: 'EUR' }));

    await txHelper.getTxStatementDetails(userData.id, transaction.id, TxStatementType.INVOICE);
    await txHelper.getTxStatementDetails(userData.id, uid, TxStatementType.INVOICE);

    expect(transactionService.getTransactionById).toHaveBeenCalledWith(transaction.id, expect.any(Object), 'query');
    expect(transactionService.getTransactionByUid).toHaveBeenCalledWith(uid, expect.any(Object), 'query');
  });
});
