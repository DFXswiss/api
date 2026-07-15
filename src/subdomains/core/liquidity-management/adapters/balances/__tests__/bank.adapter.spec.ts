import { createMock } from '@golevelup/ts-jest';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { BankTxBatchService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-batch.service';
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

  function frickAsset(dexName: string): LiquidityManagementAsset {
    return Object.assign(createCustomAsset({ dexName }), { context: IbanBankName.FRICK });
  }

  it('routes FRICK to frickService.getBalances() and creates a LiquidityBalance per matching asset currency, mirroring the Yapeal case', async () => {
    jest
      .spyOn(frickService, 'getBalances')
      .mockResolvedValue([{ iban: 'LI-EUR', currency: 'EUR', balance: 1000, availableBalance: 900 }]);
    const eurAsset = frickAsset('EUR');
    const chfAsset = frickAsset('CHF');

    const result = await adapter.getForBank(IbanBankName.FRICK, [eurAsset, chfAsset]);

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
