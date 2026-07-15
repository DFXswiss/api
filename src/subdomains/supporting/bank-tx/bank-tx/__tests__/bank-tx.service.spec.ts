import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { createCustomPrice } from 'src/integration/exchange/dto/__mocks__/price.dto.mock';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionNotificationService } from 'src/subdomains/supporting/payment/services/transaction-notification.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { BankTxRepeatService } from '../../bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx-return/bank-tx-return.service';
import { createCustomBankTx } from '../__mocks__/bank-tx.entity.mock';
import { BankTx, BankTxIndicator, BankTxType } from '../entities/bank-tx.entity';
import { BankTxBatchRepository } from '../repositories/bank-tx-batch.repository';
import { BankTxRepository } from '../repositories/bank-tx.repository';
import { BankTxService } from '../services/bank-tx.service';
import { SepaParser } from '../services/sepa-parser.service';

describe('BankTxService', () => {
  let service: BankTxService;

  let bankTxRepo: BankTxRepository;
  let pricingService: PricingService;
  let fiatService: FiatService;

  let qb: any;

  const from = new Date('2026-07-01');

  beforeAll(() => {
    new ConfigService(); // sets module-level Config (defaultVolumeDecimal read by the CHF conversion)
  });

  beforeEach(() => {
    jest.clearAllMocks();

    bankTxRepo = createMock<BankTxRepository>();
    pricingService = createMock<PricingService>();
    fiatService = createMock<FiatService>();

    // legacy chargeAmountChf sum query builder
    qb = { select: jest.fn(() => qb), where: jest.fn(() => qb), getRawOne: jest.fn() };
    (bankTxRepo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    (fiatService.getFiatByName as jest.Mock).mockImplementation((name: string) => createCustomFiat({ name }));

    service = new BankTxService(
      bankTxRepo,
      createMock<BankTxBatchRepository>(),
      createMock<BuyCryptoService>(),
      createMock<NotificationService>(),
      createMock<SettingService>(),
      createMock<OlkypayService>(),
      createMock<BankTxReturnService>(),
      createMock<BankTxRepeatService>(),
      createMock<BuyService>(),
      createMock<BankService>(),
      createMock<YapealService>(),
      createMock<TransactionService>(),
      createMock<SpecialExternalAccountService>(),
      createMock<SepaParser>(),
      createMock<BankDataService>(),
      createMock<VirtualIbanService>(),
      createMock<TransactionNotificationService>(),
      pricingService,
      fiatService,
    );
  });

  function mockLegacyFee(fee: number | null): void {
    qb.getRawOne.mockResolvedValue({ fee });
  }

  function mockFeeRows(rows: Partial<BankTx>[]): void {
    (bankTxRepo.findBy as jest.Mock).mockResolvedValue(rows.map((r) => createCustomBankTx(r)));
  }

  // identity conversion: Price.convert divides by price, so price 1 keeps the amount unchanged
  function mockIdentityChfPrice(): void {
    (pricingService.getPrice as jest.Mock).mockResolvedValue(
      createCustomPrice({ source: 'EUR', target: 'CHF', price: 1 }),
    );
  }

  it('adds DBIT BankAccountFee rows converted to CHF into the fee', async () => {
    mockLegacyFee(null);
    mockFeeRows([
      {
        id: 1,
        type: BankTxType.BANK_ACCOUNT_FEE,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        amount: 100,
        currency: 'EUR',
      },
      {
        id: 2,
        type: BankTxType.BANK_ACCOUNT_FEE,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        amount: 200,
        currency: 'CHF',
      },
    ]);
    mockIdentityChfPrice();

    await expect(service.getBankTxFee(from)).resolves.toBe(300);

    expect(fiatService.getFiatByName).toHaveBeenCalledTimes(2);
    expect(pricingService.getPrice).toHaveBeenCalledTimes(2);
  });

  it('nets a CRDT refund against a DBIT fee in the same currency', async () => {
    mockLegacyFee(null);
    mockFeeRows([
      {
        id: 1,
        type: BankTxType.BANK_ACCOUNT_FEE,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        amount: 100,
        currency: 'EUR',
      },
      {
        id: 2,
        type: BankTxType.BANK_ACCOUNT_FEE,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        amount: 30,
        currency: 'EUR',
      },
    ]);
    mockIdentityChfPrice();

    await expect(service.getBankTxFee(from)).resolves.toBe(70);

    expect(fiatService.getFiatByName).toHaveBeenCalledTimes(1);
    expect(pricingService.getPrice).toHaveBeenCalledTimes(1);
  });

  it('adds the legacy chargeAmountChf sum on top of the BankAccountFee rows', async () => {
    mockLegacyFee(5);
    mockFeeRows([
      {
        id: 1,
        type: BankTxType.BANK_ACCOUNT_FEE,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        amount: 100,
        currency: 'EUR',
      },
    ]);
    mockIdentityChfPrice();

    await expect(service.getBankTxFee(from)).resolves.toBe(105);
  });

  it('fails loud when the price is unavailable', async () => {
    mockLegacyFee(null);
    mockFeeRows([
      {
        id: 1,
        type: BankTxType.BANK_ACCOUNT_FEE,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        amount: 100,
        currency: 'EUR',
      },
    ]);
    (pricingService.getPrice as jest.Mock).mockRejectedValue(new Error('No valid price'));

    await expect(service.getBankTxFee(from)).rejects.toThrow();
  });

  it('returns only the legacy sum when there are no BankAccountFee rows', async () => {
    mockLegacyFee(5);
    mockFeeRows([]);

    await expect(service.getBankTxFee(from)).resolves.toBe(5);

    expect(pricingService.getPrice).not.toHaveBeenCalled();
  });
});
