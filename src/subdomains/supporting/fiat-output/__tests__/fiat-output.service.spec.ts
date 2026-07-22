import { createMock, DeepMocked } from '@golevelup/ts-jest';

import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { createCustomBank, frickEUR, olkyEUR } from 'src/subdomains/supporting/bank/bank/__mocks__/bank.entity.mock';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { createCustomVirtualIban } from '../../bank/virtual-iban/__mocks__/virtual-iban.entity.mock';

import { FiatOutputType } from '../fiat-output.entity';
import { FiatOutputService } from '../fiat-output.service';

type FiatOutputServiceConstructor = ConstructorParameters<typeof FiatOutputService>;
type SelectPayoutBankUserData = NonNullable<Parameters<FiatOutputService['selectPayoutBank']>[2]>;

describe('FiatOutputService', () => {
  let service: FiatOutputService;
  let bankService: DeepMocked<FiatOutputServiceConstructor[6]>;
  let virtualIbanService: DeepMocked<FiatOutputServiceConstructor[8]>;

  beforeEach(() => {
    bankService = createMock<FiatOutputServiceConstructor[6]>();
    virtualIbanService = createMock<FiatOutputServiceConstructor[8]>();
    service = new FiatOutputService(
      createMock<FiatOutputServiceConstructor[0]>(),
      createMock<FiatOutputServiceConstructor[1]>(),
      createMock<FiatOutputServiceConstructor[2]>(),
      createMock<FiatOutputServiceConstructor[3]>(),
      createMock<FiatOutputServiceConstructor[4]>(),
      createMock<FiatOutputServiceConstructor[5]>(),
      bankService,
      createMock<FiatOutputServiceConstructor[7]>(),
      virtualIbanService,
    );
  });

  describe('selectPayoutBank', () => {
    const country = createCustomCountry({ yapealEnable: true });

    it('skips a Bank Frick virtual IBAN and falls back to an incumbent sender bank', async () => {
      const userData = createMock<SelectPayoutBankUserData>();
      virtualIbanService.getActiveForUserAndCurrency.mockResolvedValue(
        createCustomVirtualIban({ bank: frickEUR, iban: 'SYNTHETIC-FRICK-VIBAN' }),
      );
      bankService.getSenderBanks.mockResolvedValue([olkyEUR]);

      const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

      expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
    });

    it('returns an eligible incumbent virtual IBAN without loading sender banks', async () => {
      const userData = createMock<SelectPayoutBankUserData>();
      const virtualIban = createCustomVirtualIban({ bank: olkyEUR, iban: 'SYNTHETIC-OLKY-VIBAN' });
      virtualIbanService.getActiveForUserAndCurrency.mockResolvedValue(virtualIban);

      const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

      expect(result).toEqual({ accountIban: virtualIban.iban, bank: olkyEUR });
      expect(bankService.getSenderBanks).not.toHaveBeenCalled();
    });

    it('selects the incumbent sender when Bank Frick has lower priority', async () => {
      const userData = createMock<SelectPayoutBankUserData>();
      const frick = createCustomBank({
        name: IbanBankName.FRICK,
        currency: 'EUR',
        iban: 'SYNTHETIC-FRICK-ACCOUNT',
        send: true,
        sendPriority: 2000,
      });
      virtualIbanService.getActiveForUserAndCurrency.mockResolvedValue(null);
      bankService.getSenderBanks.mockResolvedValue([olkyEUR, frick]);

      const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

      expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
    });

    it('does not auto-select Bank Frick as the last available sender', async () => {
      const userData = createMock<SelectPayoutBankUserData>();
      const frick = createCustomBank({
        name: IbanBankName.FRICK,
        currency: 'EUR',
        iban: 'SYNTHETIC-FRICK-ACCOUNT',
        send: true,
        sendPriority: 1000,
      });
      virtualIbanService.getActiveForUserAndCurrency.mockResolvedValue(null);
      bankService.getSenderBanks.mockResolvedValue([frick]);

      const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

      expect(result).toEqual({ accountIban: undefined, bank: undefined });
    });

    it('selects the incumbent without throwing when Bank Frick has the same priority', async () => {
      const userData = createMock<SelectPayoutBankUserData>();
      const frick = createCustomBank({
        name: IbanBankName.FRICK,
        currency: 'EUR',
        iban: 'SYNTHETIC-FRICK-ACCOUNT',
        send: true,
        sendPriority: olkyEUR.sendPriority,
      });
      virtualIbanService.getActiveForUserAndCurrency.mockResolvedValue(null);
      bankService.getSenderBanks.mockResolvedValue([frick, olkyEUR]);

      const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

      expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
    });
  });
});
