import { createMock } from '@golevelup/ts-jest';
import { createCustomBank, frickEUR } from '../__mocks__/bank.entity.mock';
import { BankController } from '../bank.controller';
import { BankService } from '../bank.service';
import { IbanBankName } from '../dto/bank.dto';

describe('BankController', () => {
  let controller: BankController;
  let bankService: BankService;

  beforeEach(() => {
    bankService = createMock<BankService>();
    controller = new BankController(bankService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAllBanks', () => {
    it('calls bankService.getPublicBanks (not getAllBanks), so Bank Frick is never exposed publicly', async () => {
      const getPublicBanksSpy = jest.spyOn(bankService, 'getPublicBanks').mockResolvedValue([]);
      const getAllBanksSpy = jest.spyOn(bankService, 'getAllBanks').mockResolvedValue([frickEUR]);

      await controller.getAllBanks();

      expect(getPublicBanksSpy).toHaveBeenCalledTimes(1);
      expect(getAllBanksSpy).not.toHaveBeenCalled();
    });

    it('maps the returned banks through BankMapper.toDto', async () => {
      const olky = createCustomBank({
        name: IbanBankName.OLKY,
        iban: 'LU116060002000005040',
        bic: 'OLKILUL1',
        currency: 'EUR',
      });
      jest.spyOn(bankService, 'getPublicBanks').mockResolvedValue([olky]);

      const result = await controller.getAllBanks();

      expect(result).toEqual([
        {
          name: IbanBankName.OLKY,
          iban: 'LU116060002000005040',
          bic: 'OLKILUL1',
          currency: 'EUR',
        },
      ]);
    });
  });
});
