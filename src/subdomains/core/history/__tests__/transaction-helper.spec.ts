import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { createCustomPrice } from 'src/integration/exchange/dto/__mocks__/price.dto.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomFiat, createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { createDefaultUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { createDefaultBankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { CardBankName, IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { createDefaultCheckoutTx } from 'src/subdomains/supporting/fiat-payin/__mocks__/checkout-tx.entity.mock';
import { createDefaultCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import {
  createCustomInternalChargebackFeeDto,
  createInternalChargebackFeeDto,
} from 'src/subdomains/supporting/payment/__mocks__/internal-fee.dto.mock';
import { createCustomTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import { TransactionSpecificationRepository } from 'src/subdomains/supporting/payment/repositories/transaction-specification.repository';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
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
    jest.spyOn(feeService, 'getChargebackFee').mockResolvedValue(createInternalChargebackFeeDto());
    jest
      .spyOn(pricingService, 'getPrice')
      .mockResolvedValue(createCustomPrice({ source: 'CHF', target: 'CHF', price: 1 }));

    await expect(
      txHelper.getRefundData(
        transaction.refundTargetEntity,
        defaultUserData,
        IbanBankName.MAERKI,
        'DE12500105170648489890',
        !transaction.cryptoInput,
      ),
    ).resolves.toMatchObject({
      fee: { network: 0, bank: 3.01 },
      refundAmount: 97.99,
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
    jest.spyOn(feeService, 'getChargebackFee').mockResolvedValue(createInternalChargebackFeeDto());

    await expect(
      txHelper.getRefundData(
        transaction.refundTargetEntity,
        defaultUserData,
        IbanBankName.MAERKI,
        'DE12500105170648489890',
        !transaction.cryptoInput,
      ),
    ).resolves.toMatchObject({
      fee: { network: 0, bank: 3.01 },
      refundAmount: 97.99,
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
    jest.spyOn(feeService, 'getChargebackFee').mockResolvedValue(createInternalChargebackFeeDto());
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
    jest
      .spyOn(feeService, 'getChargebackFee')
      .mockResolvedValue(createCustomInternalChargebackFeeDto({ network: 0.01 }));
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
    jest
      .spyOn(feeService, 'getChargebackFee')
      .mockResolvedValue(createCustomInternalChargebackFeeDto({ network: 0.01 }));
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
});
