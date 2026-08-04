import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';

import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import {
  createCustomBank,
  frickCHF,
  frickEUR,
  olkyEUR,
  yapealEUR,
} from 'src/subdomains/supporting/bank/bank/__mocks__/bank.entity.mock';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { createCustomVirtualIban } from '../../bank/virtual-iban/__mocks__/virtual-iban.entity.mock';

import { createCustomFiatOutput } from '../__mocks__/fiat-output.entity.mock';
import { CreateFiatOutputDto } from '../dto/create-fiat-output.dto';
import { UpdateFiatOutputDto } from '../dto/update-fiat-output.dto';
import { FiatOutput, FiatOutputType } from '../fiat-output.entity';
import { FiatOutputService } from '../fiat-output.service';

type FiatOutputServiceConstructor = ConstructorParameters<typeof FiatOutputService>;
type SelectPayoutBankUserData = NonNullable<Parameters<FiatOutputService['selectPayoutBank']>[2]>;

describe('FiatOutputService', () => {
  let service: FiatOutputService;
  let fiatOutputRepo: DeepMocked<FiatOutputServiceConstructor[0]>;
  let bankService: DeepMocked<FiatOutputServiceConstructor[6]>;
  let virtualIbanService: DeepMocked<FiatOutputServiceConstructor[8]>;
  let buyCryptoRepo: DeepMocked<FiatOutputServiceConstructor[3]>;

  beforeEach(() => {
    fiatOutputRepo = createMock<FiatOutputServiceConstructor[0]>();
    bankService = createMock<FiatOutputServiceConstructor[6]>();
    virtualIbanService = createMock<FiatOutputServiceConstructor[8]>();
    buyCryptoRepo = createMock<FiatOutputServiceConstructor[3]>();
    service = new FiatOutputService(
      fiatOutputRepo,
      createMock<FiatOutputServiceConstructor[1]>(),
      createMock<FiatOutputServiceConstructor[2]>(),
      buyCryptoRepo,
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
      virtualIbanService.getActiveSendingCandidatesForUserAndCurrency.mockResolvedValue([
        createCustomVirtualIban({ bank: frickEUR, iban: 'SYNTHETIC-FRICK-VIBAN' }),
      ]);
      bankService.getSenderBanks.mockResolvedValue([olkyEUR]);

      const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

      expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
    });

    it('selects an eligible Yapeal virtual IBAN when a Frick candidate is also present', async () => {
      const userData = createMock<SelectPayoutBankUserData>();
      const yapealVirtualIban = createCustomVirtualIban({
        bank: yapealEUR,
        iban: 'SYNTHETIC-YAPEAL-VIBAN',
      });
      virtualIbanService.getActiveSendingCandidatesForUserAndCurrency.mockResolvedValue([
        createCustomVirtualIban({ bank: frickEUR, iban: 'SYNTHETIC-FRICK-VIBAN' }),
        yapealVirtualIban,
      ]);

      const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

      expect(result).toEqual({ accountIban: yapealVirtualIban.iban, bank: yapealEUR });
      expect(bankService.getSenderBanks).not.toHaveBeenCalled();
    });

    it('returns an eligible incumbent virtual IBAN without loading sender banks', async () => {
      const userData = createMock<SelectPayoutBankUserData>();
      const virtualIban = createCustomVirtualIban({ bank: olkyEUR, iban: 'SYNTHETIC-OLKY-VIBAN' });
      virtualIbanService.getActiveSendingCandidatesForUserAndCurrency.mockResolvedValue([virtualIban]);

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
      virtualIbanService.getActiveSendingCandidatesForUserAndCurrency.mockResolvedValue([]);
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
      virtualIbanService.getActiveSendingCandidatesForUserAndCurrency.mockResolvedValue([]);
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
      virtualIbanService.getActiveSendingCandidatesForUserAndCurrency.mockResolvedValue([]);
      bankService.getSenderBanks.mockResolvedValue([frick, olkyEUR]);

      const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

      expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
    });
  });

  describe('create', () => {
    const baseDto: CreateFiatOutputDto = {
      type: FiatOutputType.BUY_FIAT,
      amount: 100,
      currency: 'EUR',
      name: 'John Doe',
      address: 'Main Street',
      zip: '8000',
      city: 'Zurich',
      country: 'CH',
      iban: 'CH9300762011623852957',
      accountIban: 'LI75088110103524',
    };

    const mockCreateFromObject = () => {
      fiatOutputRepo.create.mockImplementation((data) => createCustomFiatOutput(data as Partial<FiatOutput>));
    };

    it('fails loud when accountIban has no matching bank', async () => {
      fiatOutputRepo.create.mockReturnValue(createCustomFiatOutput({ ...baseDto }));
      bankService.getBankByIban.mockResolvedValue(undefined);

      await expect(service.create(baseDto)).rejects.toThrow(BadRequestException);
      expect(bankService.getBankByIban).toHaveBeenCalledWith(baseDto.accountIban);
    });

    it('normalizes null isInstant to false before save', async () => {
      const dto = { ...baseDto, isInstant: null } as CreateFiatOutputDto;
      mockCreateFromObject();
      bankService.getBankByIban.mockResolvedValue(frickEUR);
      fiatOutputRepo.save.mockImplementation(async (entity) => entity as never);

      await service.create(dto);

      expect(fiatOutputRepo.create).toHaveBeenCalledWith(expect.objectContaining({ isInstant: false }));
      expect(fiatOutputRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isInstant: false }));
    });

    it('accepts isInstant true for explicit frickEUR and saves it', async () => {
      const dto: CreateFiatOutputDto = { ...baseDto, isInstant: true, accountIban: frickEUR.iban };
      mockCreateFromObject();
      bankService.getBankByIban.mockResolvedValue(frickEUR);
      fiatOutputRepo.save.mockImplementation(async (entity) => entity as never);

      await service.create(dto);

      expect(fiatOutputRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isInstant: true, bank: frickEUR }));
    });

    it('rejects isInstant true for frickCHF', async () => {
      const dto: CreateFiatOutputDto = {
        ...baseDto,
        isInstant: true,
        currency: 'CHF',
        accountIban: frickCHF.iban,
      };
      mockCreateFromObject();
      bankService.getBankByIban.mockResolvedValue(frickCHF);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(fiatOutputRepo.save).not.toHaveBeenCalled();
    });

    it('rejects isInstant true for EUR currency with frickCHF bank', async () => {
      const dto: CreateFiatOutputDto = {
        ...baseDto,
        isInstant: true,
        currency: 'EUR',
        accountIban: frickCHF.iban,
      };
      mockCreateFromObject();
      bankService.getBankByIban.mockResolvedValue(frickCHF);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(fiatOutputRepo.save).not.toHaveBeenCalled();
    });

    it('rejects isInstant true for olkyEUR', async () => {
      const dto: CreateFiatOutputDto = { ...baseDto, isInstant: true, accountIban: olkyEUR.iban };
      mockCreateFromObject();
      bankService.getBankByIban.mockResolvedValue(olkyEUR);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(fiatOutputRepo.save).not.toHaveBeenCalled();
    });

    it('rejects isInstant true without accountIban / resolved bank', async () => {
      const { accountIban: _accountIban, ...dtoWithoutIban } = baseDto;
      const dto: CreateFiatOutputDto = { ...dtoWithoutIban, isInstant: true };
      mockCreateFromObject();

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(fiatOutputRepo.save).not.toHaveBeenCalled();
      expect(bankService.getBankByIban).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('resolves and persists bank when accountIban is set', async () => {
      const id = 1;
      const dto: UpdateFiatOutputDto = { accountIban: 'LI75088110103524' };
      fiatOutputRepo.findOneBy.mockResolvedValue(createCustomFiatOutput({ id }));
      bankService.getBankByIban.mockResolvedValue(olkyEUR);
      fiatOutputRepo.save.mockImplementation(async (entity) => entity as never);

      await service.update(id, dto);

      expect(bankService.getBankByIban).toHaveBeenCalledWith(dto.accountIban);
      expect(fiatOutputRepo.save).toHaveBeenCalledWith(expect.objectContaining({ bank: olkyEUR }));
    });

    it('fails loud when accountIban has no matching bank', async () => {
      const id = 1;
      const dto: UpdateFiatOutputDto = { accountIban: 'LI75088110103524' };
      fiatOutputRepo.findOneBy.mockResolvedValue(createCustomFiatOutput({ id }));
      bankService.getBankByIban.mockResolvedValue(undefined);

      await expect(service.update(id, dto)).rejects.toThrow(BadRequestException);
      expect(bankService.getBankByIban).toHaveBeenCalledWith(dto.accountIban);
    });
  });

  describe('createInternal', () => {
    it('refuses a BuyCryptoFail output once a chargeback bank TX is linked (double-refund guard)', async () => {
      buyCryptoRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.createInternal(FiatOutputType.BUY_CRYPTO_FAIL, { buyCrypto: { id: 7 } as never }, 7),
      ).rejects.toThrow('Chargeback already executed for this buy-crypto (chargeback bank TX linked)');
    });
  });
});
