import { createMock } from '@golevelup/ts-jest';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { BankTxBatchService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-batch.service';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { LiquidityManagementAsset } from '../../../interfaces';
import { BankAdapter } from '../bank.adapter';

describe('BankAdapter', () => {
  let adapter: BankAdapter;
  let bankService: BankService;
  let bankTxBatchService: BankTxBatchService;
  let olkypayService: OlkypayService;
  let checkoutService: CheckoutService;
  let yapealService: YapealService;
  let frickService: BankFrickService;

  beforeEach(() => {
    bankService = createMock<BankService>();
    bankTxBatchService = createMock<BankTxBatchService>();
    olkypayService = createMock<OlkypayService>();
    checkoutService = createMock<CheckoutService>();
    yapealService = createMock<YapealService>();
    frickService = createMock<BankFrickService>();

    adapter = new BankAdapter(
      bankService,
      bankTxBatchService,
      olkypayService,
      checkoutService,
      yapealService,
      frickService,
    );
  });

  function frickAsset(dexName: string, id?: number): LiquidityManagementAsset {
    return Object.assign(createCustomAsset({ dexName, id }), { context: IbanBankName.FRICK });
  }

  function frickBank(asset: LiquidityManagementAsset, iban: string): Bank {
    return createMock<Bank>({ asset, iban });
  }

  it('matches same-currency Bank Frick accounts to assets by their linked IBAN', async () => {
    const firstEurAsset = frickAsset('EUR', 1);
    const secondEurAsset = frickAsset('EUR', 2);
    jest
      .spyOn(bankService, 'getBanksWithAsset')
      .mockResolvedValue([
        frickBank(firstEurAsset, 'LI01 0000 0000 0000 0001'),
        frickBank(secondEurAsset, 'LI02 0000 0000 0000 0002'),
      ]);
    jest.spyOn(frickService, 'getBalances').mockResolvedValue([
      {
        iban: 'LI010000000000000001',
        currency: 'EUR',
        balance: 1000,
        availableBalance: 900,
      },
      {
        iban: 'li020000000000000002',
        currency: 'EUR',
        balance: 2000,
        availableBalance: 1800,
      },
    ]);

    const result = await adapter.getForBank(IbanBankName.FRICK, [firstEurAsset, secondEurAsset]);

    expect(result).toHaveLength(2);
    expect(result[0].asset).toBe(firstEurAsset);
    expect(result[0].amount).toBe(900);
    expect(result[1].asset).toBe(secondEurAsset);
    expect(result[1].amount).toBe(1800);
  });

  it('fails closed when a Bank Frick asset has no linked bank account', async () => {
    jest.spyOn(bankService, 'getBanksWithAsset').mockResolvedValue([]);
    jest
      .spyOn(frickService, 'getBalances')
      .mockResolvedValue([{ iban: 'LI-EUR', currency: 'EUR', balance: 1000, availableBalance: 900 }]);

    await expect(adapter.getForBank(IbanBankName.FRICK, [frickAsset('EUR', 1)])).rejects.toThrow(
      'Bank Frick account is not linked to asset',
    );
  });

  it('fails closed when the linked Bank Frick IBAN is missing from the API response', async () => {
    const eurAsset = frickAsset('EUR', 1);
    jest.spyOn(bankService, 'getBanksWithAsset').mockResolvedValue([frickBank(eurAsset, 'LI-LINKED')]);
    jest
      .spyOn(frickService, 'getBalances')
      .mockResolvedValue([{ iban: 'LI-OTHER', currency: 'EUR', balance: 1000, availableBalance: 900 }]);

    await expect(adapter.getForBank(IbanBankName.FRICK, [eurAsset])).rejects.toThrow(
      'No Bank Frick account found for IBAN LI-LINKED',
    );
  });

  it('ignores Bank Frick API accounts that are not linked to a liquidity asset', async () => {
    const eurAsset = frickAsset('EUR', 1);
    jest.spyOn(bankService, 'getBanksWithAsset').mockResolvedValue([frickBank(eurAsset, 'LI-LINKED')]);
    jest.spyOn(frickService, 'getBalances').mockResolvedValue([
      { iban: 'LI-LINKED', currency: 'EUR', balance: 1000, availableBalance: 900 },
      { iban: 'LI-OPERATING', currency: 'EUR', balance: 5000, availableBalance: 4500 },
    ]);

    const result = await adapter.getForBank(IbanBankName.FRICK, [eurAsset]);

    expect(result).toHaveLength(1);
    expect(result[0].asset).toBe(eurAsset);
    expect(result[0].amount).toBe(900);
  });

  it('fails closed when Bank Frick reports no available balance for an account, instead of silently using the booked balance', async () => {
    jest.spyOn(frickService, 'getBalances').mockResolvedValue([{ iban: 'LI-EUR', currency: 'EUR', balance: 1000 }]);

    await expect(adapter.getForBank(IbanBankName.FRICK, [frickAsset('EUR')])).rejects.toThrow(
      'Missing available balance for Bank Frick account LI-EUR',
    );
  });

  it('propagates and logs a getBalances() failure the same way as the other cases', async () => {
    jest.spyOn(frickService, 'getBalances').mockRejectedValue(new Error('Bank Frick unavailable'));

    await expect(adapter.getForBank(IbanBankName.FRICK, [frickAsset('EUR')])).rejects.toThrow('Bank Frick unavailable');
  });
});
