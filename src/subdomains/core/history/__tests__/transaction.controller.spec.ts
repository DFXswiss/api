import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { BankTxReturnService } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service';
import { createDefaultBankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { createDefaultCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { createCustomTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { createCustomBuyCrypto } from '../../buy-crypto/process/entities/__mocks__/buy-crypto.entity.mock';
import { BuyCryptoWebhookService } from '../../buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { RefRewardService } from '../../referral/reward/services/ref-reward.service';
import { createCustomBuyFiat } from '../../sell-crypto/process/__mocks__/buy-fiat.entity.mock';
import { BuyFiatService } from '../../sell-crypto/process/services/buy-fiat.service';
import { TransactionUtilService } from '../../transaction/transaction-util.service';
import { TransactionController } from '../controllers/transaction.controller';
import { HistoryService } from '../services/history.service';

describe('TransactionController', () => {
  let controller: TransactionController;

  let historyService: HistoryService;
  let transactionService: TransactionService;
  let buyCryptoWebhookService: BuyCryptoWebhookService;
  let buyFiatService: BuyFiatService;
  let refRewardService: RefRewardService;
  let bankDataService: BankDataService;
  let bankTxService: BankTxService;
  let fiatService: FiatService;
  let buyService: BuyService;
  let buyCryptoService: BuyCryptoService;
  let feeService: FeeService;
  let transactionUtilService: TransactionUtilService;
  let userDataService: UserDataService;
  let bankTxReturnService: BankTxReturnService;
  let specialExternalAccountService: SpecialExternalAccountService;

  beforeEach(async () => {
    historyService = createMock<HistoryService>();
    transactionService = createMock<TransactionService>();
    buyCryptoWebhookService = createMock<BuyCryptoWebhookService>();
    buyFiatService = createMock<BuyFiatService>();
    refRewardService = createMock<RefRewardService>();
    bankDataService = createMock<BankDataService>();
    bankTxService = createMock<BankTxService>();
    fiatService = createMock<FiatService>();
    buyService = createMock<BuyService>();
    buyCryptoService = createMock<BuyCryptoService>();
    feeService = createMock<FeeService>();
    transactionUtilService = createMock<TransactionUtilService>();
    userDataService = createMock<UserDataService>();
    bankTxReturnService = createMock<BankTxReturnService>();
    specialExternalAccountService = createMock<SpecialExternalAccountService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TransactionController,
        { provide: HistoryService, useValue: historyService },
        { provide: TransactionService, useValue: transactionService },
        { provide: BuyCryptoWebhookService, useValue: buyCryptoWebhookService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: RefRewardService, useValue: refRewardService },
        { provide: BankDataService, useValue: bankDataService },
        { provide: BankTxService, useValue: bankTxService },
        { provide: FiatService, useValue: fiatService },
        { provide: BuyService, useValue: buyService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: FeeService, useValue: feeService },
        { provide: TransactionUtilService, useValue: transactionUtilService },
        { provide: UserDataService, useValue: userDataService },
        { provide: BankTxReturnService, useValue: bankTxReturnService },
        { provide: SpecialExternalAccountService, useValue: specialExternalAccountService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<TransactionController>(TransactionController);
  });

  const jwt: JwtPayload = {
    role: UserRole.ACCOUNT,
    ip: '1.1.1.1',
    account: 1,
  };

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return buyCrypto refund data', async () => {
    jest.spyOn(transactionService, 'getTransactionById').mockResolvedValue(
      createCustomTransaction({
        buyCrypto: createCustomBuyCrypto({
          amlCheck: CheckStatus.FAIL,
          bankTx: createDefaultBankTx(),
        }),
        bankTx: createDefaultBankTx(),
      }),
    );

    jest.spyOn(specialExternalAccountService, 'getMultiAccountIbans').mockResolvedValue([]);
    jest.spyOn(transactionUtilService, 'validateChargebackIban').mockResolvedValue(true);

    await expect(controller.getTransactionRefund(jwt, '1')).resolves.toMatchObject({
      fee: { network: 0, bank: 0 },
      refundAmount: 100,
      refundTarget: 'DE12500105170648489890',
    });
  });

  it('should return cryptoCrypto refund data', async () => {
    jest.spyOn(transactionService, 'getTransactionById').mockResolvedValue(
      createCustomTransaction({
        buyCrypto: createCustomBuyCrypto({
          amlCheck: CheckStatus.FAIL,
          cryptoInput: createDefaultCryptoInput(),
        }),
      }),
    );

    jest.spyOn(feeService, 'getBlockchainFee').mockResolvedValue(0.01);

    await expect(controller.getTransactionRefund(jwt, '1')).resolves.toMatchObject({
      fee: { network: 0.01, bank: 0 },
      refundAmount: 99.99,
      refundTarget: undefined,
    });
  });

  it('should return buyFiat refund data', async () => {
    jest.spyOn(transactionService, 'getTransactionById').mockResolvedValue(
      createCustomTransaction({
        buyFiat: createCustomBuyFiat({
          amlCheck: CheckStatus.FAIL,
          cryptoInput: createDefaultCryptoInput(),
        }),
      }),
    );

    jest.spyOn(feeService, 'getBlockchainFee').mockResolvedValue(0.01);

    await expect(controller.getTransactionRefund(jwt, '1')).resolves.toMatchObject({
      fee: { network: 0.01, bank: 0 },
      refundAmount: 0.09,
      refundTarget: undefined,
    });
  });
});
