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
import { BankTxIndicator } from '../entities/bank-tx.entity';
import { BankTxBatchRepository } from '../repositories/bank-tx-batch.repository';
import { BankTxRepository } from '../repositories/bank-tx.repository';
import { BankTxFrickService } from '../services/bank-tx-frick.service';
import { BankTxService } from '../services/bank-tx.service';
import { SepaParser } from '../services/sepa-parser.service';

// one raw aggregate row as returned by the GROUP BY currency, creditDebitIndicator query
interface FeeAggregate {
  currency: string;
  creditDebitIndicator: BankTxIndicator;
  amount: string; // Postgres returns SUM() as a string
}

describe('BankTxService', () => {
  let service: BankTxService;

  let bankTxRepo: BankTxRepository;
  let pricingService: PricingService;
  let fiatService: FiatService;

  let qb: any;

  const from = new Date('2026-07-01');

  // Distinct per-currency CHF prices. Price.convert divides the amount by the price
  // (getPrice(fiat, CHF).convert(x) = x / price), so a wrong currency->price mapping or an
  // inverted (multiply) direction produces a different total and turns these tests red.
  const chfPriceByCurrency: Record<string, number> = { EUR: 0.8, USD: 2 };

  beforeAll(() => {
    new ConfigService(); // sets module-level Config (defaultVolumeDecimal read by the CHF conversion)
  });

  beforeEach(() => {
    jest.clearAllMocks();

    bankTxRepo = createMock<BankTxRepository>();
    pricingService = createMock<PricingService>();
    fiatService = createMock<FiatService>();

    // one chainable query builder mock serves both queries: the legacy chargeAmountChf sum
    // (getRawOne) and the per-currency/direction BankAccountFee aggregation (getRawMany).
    qb = {
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      groupBy: jest.fn(() => qb),
      addGroupBy: jest.fn(() => qb),
      getRawOne: jest.fn(),
      getRawMany: jest.fn(),
    };
    (bankTxRepo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    (fiatService.getFiatByName as jest.Mock).mockImplementation((name: string) => createCustomFiat({ name }));

    service = new BankTxService(
      bankTxRepo,
      createMock<BankTxBatchRepository>(),
      createMock<BuyCryptoService>(),
      createMock<NotificationService>(),
      createMock<SettingService>(),
      createMock<OlkypayService>(),
      createMock<BankTxFrickService>(),
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

  function mockFeeAggregates(rows: FeeAggregate[]): void {
    qb.getRawMany.mockResolvedValue(rows);
  }

  // per-currency prices from chfPriceByCurrency (distinct so mapping/direction errors are caught)
  function mockChfPrices(): void {
    (pricingService.getPrice as jest.Mock).mockImplementation(async (fiat: { name: string }) =>
      createCustomPrice({ source: fiat.name, target: 'CHF', price: chfPriceByCurrency[fiat.name] }),
    );
  }

  it('converts each DBIT currency aggregate with its own price and sums the result', async () => {
    mockLegacyFee(null);
    mockFeeAggregates([
      { currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' },
      { currency: 'USD', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '200' },
    ]);
    mockChfPrices();

    // EUR 100 / 0.8 = 125 CHF; USD 200 / 2 = 100 CHF; total 225 CHF
    // (a multiply direction -> 80 + 400 = 480; a swapped currency->price -> 125 + 250 = 375)
    await expect(service.getBankTxFee(from)).resolves.toBe(225);

    expect(fiatService.getFiatByName).toHaveBeenCalledWith('EUR');
    expect(fiatService.getFiatByName).toHaveBeenCalledWith('USD');
    expect(pricingService.getPrice).toHaveBeenCalledTimes(2);
  });

  it('nets a CRDT refund against a DBIT fee in the same currency before converting', async () => {
    mockLegacyFee(null);
    mockFeeAggregates([
      { currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' },
      { currency: 'EUR', creditDebitIndicator: BankTxIndicator.CREDIT, amount: '30' },
    ]);
    mockChfPrices();

    // net EUR 70 / 0.8 = 87.5 CHF (converted once, after netting)
    await expect(service.getBankTxFee(from)).resolves.toBe(87.5);

    expect(pricingService.getPrice).toHaveBeenCalledTimes(1);
  });

  it('adds the legacy chargeAmountChf sum on top of the converted BankAccountFee aggregates', async () => {
    mockLegacyFee(5);
    mockFeeAggregates([{ currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' }]);
    mockChfPrices();

    // legacy 5 + EUR 100 / 0.8 (125) = 130
    await expect(service.getBankTxFee(from)).resolves.toBe(130);
  });

  it('rounds the assembled total to the default volume decimals', async () => {
    mockLegacyFee(0.1);
    mockFeeAggregates([{ currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '0.2' }]);
    // price 1 so the converted amount is exactly 0.2 and only the final sum needs rounding
    (pricingService.getPrice as jest.Mock).mockResolvedValue(
      createCustomPrice({ source: 'EUR', target: 'CHF', price: 1 }),
    );

    // legacy 0.1 + EUR 0.2 = 0.30000000000000004 in float -> must be rounded to 0.3
    await expect(service.getBankTxFee(from)).resolves.toBe(0.3);
  });

  it('fails loud when the price is unavailable', async () => {
    mockLegacyFee(null);
    mockFeeAggregates([{ currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' }]);
    (pricingService.getPrice as jest.Mock).mockRejectedValue(new Error('No valid price'));

    await expect(service.getBankTxFee(from)).rejects.toThrow();
  });

  it('returns only the legacy sum when there are no BankAccountFee aggregates', async () => {
    mockLegacyFee(5);
    mockFeeAggregates([]);

    await expect(service.getBankTxFee(from)).resolves.toBe(5);

    expect(pricingService.getPrice).not.toHaveBeenCalled();
  });
});
