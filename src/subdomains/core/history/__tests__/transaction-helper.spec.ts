import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { createCustomPrice, createDefaultPrice } from 'src/integration/exchange/dto/__mocks__/price.dto.mock';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { createDefaultUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import {
  createCustomBankTx,
  createDefaultBankTx,
} from 'src/subdomains/supporting/bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { createDefaultCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import {
  createCustomInternalChargebackFeeDto,
  createInternalChargebackFeeDto,
} from 'src/subdomains/supporting/payment/__mocks__/internal-fee.dto.mock';
import { createCustomTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import { TransactionSpecificationRepository } from 'src/subdomains/supporting/payment/repositories/transaction-specification.repository';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
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

  beforeEach(async () => {
    specRepo = createMock<TransactionSpecificationRepository>();
    pricingService = createMock<PricingService>();
    blockchainRegistryService = createMock<BlockchainRegistryService>();
    buyFiatService = createMock<BuyFiatService>();
    walletService = createMock<WalletService>();
    fiatService = createMock<FiatService>();
    buyCryptoService = createMock<BuyCryptoService>();
    feeService = createMock<FeeService>();

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
        TestUtil.provideConfig(),
      ],
    }).compile();

    txHelper = module.get<TransactionHelper>(TransactionHelper);
  });

  const jwt: JwtPayload = {
    role: UserRole.ACCOUNT,
    ip: '1.1.1.1',
    account: 1,
  };

  const defaultUserData = createDefaultUserData();

  it('should be defined', () => {
    expect(txHelper).toBeDefined();
  });

  it('should return buyCrypto refund data', async () => {
    const transaction = createCustomTransaction({
      buyCrypto: createCustomBuyCrypto({
        amlCheck: CheckStatus.FAIL,
        bankTx: createDefaultBankTx(),
      }),
      bankTx: createDefaultBankTx(),
    });

    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue(createDefaultFiat());
    jest.spyOn(feeService, 'getChargebackFee').mockResolvedValue(createInternalChargebackFeeDto());
    jest.spyOn(pricingService, 'getPrice').mockResolvedValue(createDefaultPrice());

    await expect(
      txHelper.getRefundData(
        transaction.refundTargetEntity,
        defaultUserData,
        IbanBankName.MAERKI,
        'DE12500105170648489890',
        !transaction.cryptoInput,
      ),
    ).resolves.toMatchObject({
      fee: { network: 0, bank: 0 },
      refundAmount: 100,
      refundTarget: 'DE12500105170648489890',
    });
  });

  it('should return cryptoCrypto refund data', async () => {
    const transaction = createCustomTransaction({
      buyCrypto: createCustomBuyCrypto({
        amlCheck: CheckStatus.FAIL,
        cryptoInput: createDefaultCryptoInput(),
      }),
      bankTx: createCustomBankTx({ accountIban: 'AT00 0000 0000 0000 0000' }),
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
      }),
      //bankTx: createCustomBankTx({ accountIban: 'AT00 0000 0000 0000 0000' }),
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
