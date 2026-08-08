import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';

import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import {
  createCustomBank,
  fiatRepublicEUR,
  frickCHF,
  frickEUR,
  olkyEUR,
  yapealEUR,
} from 'src/subdomains/supporting/bank/bank/__mocks__/bank.entity.mock';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { createCustomVirtualIban } from '../../bank/virtual-iban/__mocks__/virtual-iban.entity.mock';

import { PayInStatus } from '../../payin/entities/crypto-input.entity';
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
  let fiatRepublicService: DeepMocked<FiatOutputServiceConstructor[9]>;
  let buyFiatRepo: DeepMocked<FiatOutputServiceConstructor[1]>;
  let bankTxService: DeepMocked<FiatOutputServiceConstructor[2]>;
  let bankTxReturnService: DeepMocked<FiatOutputServiceConstructor[4]>;
  let bankTxRepeatService: DeepMocked<FiatOutputServiceConstructor[5]>;
  let sellRepo: DeepMocked<FiatOutputServiceConstructor[7]>;

  beforeEach(() => {
    fiatOutputRepo = createMock<FiatOutputServiceConstructor[0]>();
    bankService = createMock<FiatOutputServiceConstructor[6]>();
    virtualIbanService = createMock<FiatOutputServiceConstructor[8]>();
    buyCryptoRepo = createMock<FiatOutputServiceConstructor[3]>();
    fiatRepublicService = createMock<FiatOutputServiceConstructor[9]>();
    buyFiatRepo = createMock<FiatOutputServiceConstructor[1]>();
    bankTxService = createMock<FiatOutputServiceConstructor[2]>();
    bankTxReturnService = createMock<FiatOutputServiceConstructor[4]>();
    bankTxRepeatService = createMock<FiatOutputServiceConstructor[5]>();
    sellRepo = createMock<FiatOutputServiceConstructor[7]>();
    // Not released by default: createMock's auto-mocked methods return a truthy proxy, so the flag has
    // to be pinned off explicitly for the pre-integration behaviour to be what the tests observe.
    jest.spyOn(fiatRepublicService, 'isPayoutRoutingEnabled').mockReturnValue(false);
    service = new FiatOutputService(
      fiatOutputRepo,
      buyFiatRepo,
      bankTxService,
      buyCryptoRepo,
      bankTxReturnService,
      bankTxRepeatService,
      bankService,
      sellRepo,
      virtualIbanService,
      fiatRepublicService,
    );
  });

  describe('selectPayoutBank', () => {
    const country = createCustomCountry({ yapealEnable: true });

    describe('Fiat Republic routing gate', () => {
      it('does not route to a Fiat Republic virtual IBAN while routing is off', async () => {
        const userData = createMock<SelectPayoutBankUserData>();
        virtualIbanService.getActiveSendingCandidatesForUserAndCurrency.mockResolvedValue([
          createCustomVirtualIban({ bank: fiatRepublicEUR, iban: 'SYNTHETIC-FR-VIBAN' }),
        ]);
        bankService.getSenderBanks.mockResolvedValue([olkyEUR]);

        const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

        expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
      });

      it('does not route to the Fiat Republic collection account while routing is off', async () => {
        bankService.getSenderBanks.mockResolvedValue([fiatRepublicEUR, olkyEUR]);

        const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, undefined, country);

        expect(result).toEqual({ accountIban: olkyEUR.iban, bank: olkyEUR });
      });

      it('selects nothing rather than Fiat Republic when it is the only sender and routing is off', async () => {
        bankService.getSenderBanks.mockResolvedValue([fiatRepublicEUR]);

        const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, undefined, country);

        expect(result).toEqual({ accountIban: undefined, bank: undefined });
      });

      it('routes to the Fiat Republic virtual IBAN once routing is released', async () => {
        jest.spyOn(fiatRepublicService, 'isPayoutRoutingEnabled').mockReturnValue(true);
        const userData = createMock<SelectPayoutBankUserData>();
        const fiatRepublicVirtualIban = createCustomVirtualIban({
          bank: fiatRepublicEUR,
          iban: 'SYNTHETIC-FR-VIBAN',
        });
        virtualIbanService.getActiveSendingCandidatesForUserAndCurrency.mockResolvedValue([fiatRepublicVirtualIban]);

        const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, userData, country);

        expect(result).toEqual({ accountIban: 'SYNTHETIC-FR-VIBAN', bank: fiatRepublicEUR });
      });

      it('lets sendPriority, not the flag, decide between Fiat Republic and the incumbent', async () => {
        jest.spyOn(fiatRepublicService, 'isPayoutRoutingEnabled').mockReturnValue(true);
        const preferredFiatRepublic = createCustomBank({
          name: IbanBankName.FIAT_REPUBLIC,
          currency: 'EUR',
          iban: 'SYNTHETIC-FR-IBAN',
          send: true,
          sendPriority: 10,
        });
        const laterOlky = createCustomBank({
          name: IbanBankName.OLKY,
          currency: 'EUR',
          iban: 'SYNTHETIC-OLKY-IBAN',
          send: true,
          sendPriority: 20,
        });
        bankService.getSenderBanks.mockResolvedValue([laterOlky, preferredFiatRepublic]);

        const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, undefined, country);

        expect(result).toEqual({ accountIban: 'SYNTHETIC-FR-IBAN', bank: preferredFiatRepublic });
      });

      it('keeps the incumbent when it has the lower sendPriority, even with routing on', async () => {
        jest.spyOn(fiatRepublicService, 'isPayoutRoutingEnabled').mockReturnValue(true);
        const preferredOlky = createCustomBank({
          name: IbanBankName.OLKY,
          currency: 'EUR',
          iban: 'SYNTHETIC-OLKY-IBAN',
          send: true,
          sendPriority: 10,
        });
        const laterFiatRepublic = createCustomBank({
          name: IbanBankName.FIAT_REPUBLIC,
          currency: 'EUR',
          iban: 'SYNTHETIC-FR-IBAN',
          send: true,
          sendPriority: 20,
        });
        bankService.getSenderBanks.mockResolvedValue([laterFiatRepublic, preferredOlky]);

        const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, undefined, country);

        expect(result).toEqual({ accountIban: 'SYNTHETIC-OLKY-IBAN', bank: preferredOlky });
      });

      it('still excludes Bank Frick when Fiat Republic routing is on', async () => {
        jest.spyOn(fiatRepublicService, 'isPayoutRoutingEnabled').mockReturnValue(true);
        bankService.getSenderBanks.mockResolvedValue([frickEUR]);

        const result = await service.selectPayoutBank('EUR', FiatOutputType.BUY_FIAT, undefined, country);

        expect(result).toEqual({ accountIban: undefined, bank: undefined });
      });
    });

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

  describe('create', () => {
    it('refuses the admin route for a buy-crypto with a linked chargeback bank TX (double-refund guard)', async () => {
      buyCryptoRepo.existsBy.mockResolvedValue(true);

      await expect(service.create({ type: FiatOutputType.BUY_CRYPTO_FAIL, buyCryptoId: 7 } as never)).rejects.toThrow(
        'Chargeback already executed for this buy-crypto (chargeback bank TX linked)',
      );
    });

    it('lets the admin route proceed past the guard when no chargeback bank TX is linked', async () => {
      buyCryptoRepo.existsBy.mockResolvedValue(false);

      await expect(service.create({ type: FiatOutputType.BUY_CRYPTO_FAIL, buyCryptoId: 7 } as never)).rejects.toThrow(
        'Missing required creditor fields',
      );
    });

    it('does not consult the double-refund guard for other output types', async () => {
      await expect(service.create({ type: FiatOutputType.BUY_FIAT } as never)).rejects.toThrow(
        'Missing required creditor fields',
      );
      expect(buyCryptoRepo.existsBy).not.toHaveBeenCalled();
    });
  });
  describe('create', () => {
    const creditor = {
      currency: 'EUR',
      amount: 100.005,
      name: 'Synthetic Person',
      address: 'Street',
      zip: '0000',
      city: 'City',
      country: 'DE',
      iban: 'DE89370400440532013000',
    };

    function dto(overrides: Partial<CreateFiatOutputDto> = {}): CreateFiatOutputDto {
      return { type: FiatOutputType.MANUAL, ...creditor, ...overrides } as CreateFiatOutputDto;
    }

    beforeEach(() => {
      fiatOutputRepo.create.mockImplementation((values) => createCustomFiatOutput(values as never));
      fiatOutputRepo.save.mockImplementation(async (entity) => entity as FiatOutput);
      fiatOutputRepo.exists.mockResolvedValue(false);
    });

    it('rounds the amount to a readable fiat amount and defaults isInstant off', async () => {
      const created = await service.create(dto());

      expect(created.amount).toBe(100.01);
      expect(created.isInstant).toBe(false);
    });

    it.each([
      ['buyCryptoId', { buyCryptoId: 7 }],
      ['buyFiatId', { buyFiatId: 7 }],
      ['bankTxReturnId', { bankTxReturnId: 7 }],
      ['bankTxRepeatId', { bankTxRepeatId: 7 }],
    ])('refuses a second output for the same %s and type', async (_name, link) => {
      fiatOutputRepo.exists.mockResolvedValue(true);

      await expect(service.create(dto(link))).rejects.toThrow('FiatOutput already exists');
    });

    it('links the buy-fiat and rejects an unconfirmed crypto input', async () => {
      buyFiatRepo.findOneBy.mockResolvedValue({
        id: 7,
        cryptoInput: { status: PayInStatus.COMPLETED },
      } as never);

      await expect(service.create(dto({ type: FiatOutputType.BUY_FIAT, buyFiatId: 7 }))).rejects.toThrow(
        'CryptoInput not confirmed',
      );
    });

    it('accepts a buy-fiat whose crypto input is still in flight', async () => {
      buyFiatRepo.findOneBy.mockResolvedValue({ id: 7, cryptoInput: { status: PayInStatus.CREATED } } as never);

      const created = await service.create(dto({ type: FiatOutputType.BUY_FIAT, buyFiatId: 7 }));

      expect(created.buyFiats?.[0]?.id).toBe(7);
    });

    it('refuses a buy-fiat that does not exist', async () => {
      buyFiatRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create(dto({ buyFiatId: 7 }))).rejects.toThrow('BuyFiat not found');
    });

    it('links the buy-crypto refund', async () => {
      buyCryptoRepo.findOneBy.mockResolvedValue({ id: 8 } as never);

      const created = await service.create(dto({ buyCryptoId: 8 }));

      expect(created.buyCrypto?.id).toBe(8);
    });

    it('refuses a buy-crypto that does not exist', async () => {
      buyCryptoRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create(dto({ buyCryptoId: 8 }))).rejects.toThrow('BuyCrypto not found');
    });

    it('links the bank-tx return', async () => {
      bankTxReturnService.getBankTxReturn.mockResolvedValue({ id: 9 } as never);

      const created = await service.create(dto({ bankTxReturnId: 9 }));

      expect(created.bankTxReturn?.id).toBe(9);
    });

    it('refuses a bank-tx return that does not exist', async () => {
      bankTxReturnService.getBankTxReturn.mockResolvedValue(null);

      await expect(service.create(dto({ bankTxReturnId: 9 }))).rejects.toThrow('BankTxReturn not found');
    });

    it('links the bank-tx repeat', async () => {
      bankTxRepeatService.getBankTxRepeat.mockResolvedValue({ id: 10 } as never);

      const created = await service.create(dto({ bankTxRepeatId: 10 }));

      expect(created.bankTxRepeat?.id).toBe(10);
    });

    it('refuses a bank-tx repeat that does not exist', async () => {
      bankTxRepeatService.getBankTxRepeat.mockResolvedValue(null);

      await expect(service.create(dto({ bankTxRepeatId: 10 }))).rejects.toThrow('BankTxRepeat not found');
    });

    it('resolves the bank from an explicitly assigned account IBAN', async () => {
      bankService.getBankByIban.mockResolvedValue(olkyEUR);

      const created = await service.create(dto({ accountIban: olkyEUR.iban }));

      expect(created.bank).toBe(olkyEUR);
    });

    it('refuses an account IBAN that belongs to no bank of ours', async () => {
      bankService.getBankByIban.mockResolvedValue(undefined);

      await expect(service.create(dto({ accountIban: 'UNKNOWN' }))).rejects.toThrow('No bank found for account IBAN');
    });

    it('allows instant only for an explicitly assigned Bank Frick EUR output', async () => {
      bankService.getBankByIban.mockResolvedValue(frickEUR);

      const created = await service.create(dto({ isInstant: true, accountIban: frickEUR.iban }));

      expect(created.isInstant).toBe(true);
    });

    it.each([
      ['the output currency is not EUR', { currency: 'CHF', accountIban: frickEUR.iban }, frickEUR],
      ['the bank is not Bank Frick', { accountIban: olkyEUR.iban }, olkyEUR],
      ['the Bank Frick row is not the EUR one', { accountIban: frickCHF.iban }, frickCHF],
    ])('refuses instant when %s', async (_name, overrides, bank) => {
      bankService.getBankByIban.mockResolvedValue(bank);

      await expect(service.create(dto({ isInstant: true, ...overrides }))).rejects.toThrow(
        'Instant requires an explicitly assigned Bank Frick EUR output',
      );
    });

    it.each(['currency', 'amount', 'name', 'address', 'zip', 'city', 'country', 'iban'])(
      'refuses an output missing %s',
      async (field) => {
        await expect(service.create(dto({ [field]: undefined } as never))).rejects.toThrow(
          `Missing required creditor fields: ${field}`,
        );
      },
    );

    it('treats a blank creditor field as missing', async () => {
      await expect(service.create(dto({ name: '   ' }))).rejects.toThrow('Missing required creditor fields: name');
    });
  });

  describe('createInternal', () => {
    beforeEach(() => {
      fiatOutputRepo.create.mockImplementation((values) => createCustomFiatOutput(values as never));
      fiatOutputRepo.save.mockImplementation(async (entity) => entity as FiatOutput);
    });

    const userData = {
      completeName: 'Synthetic Person',
      address: { street: 'Street', houseNumber: '1', zip: '0000', city: 'City', country: { symbol: 'DE' } },
    };

    function buyFiat(overrides = {}): never {
      return {
        userData,
        sell: { iban: 'DE89370400440532013000' },
        outputAsset: { name: 'EUR' },
        outputAmount: 100,
        ...overrides,
      } as never;
    }

    it('derives the creditor data from the seller account', async () => {
      const created = await service.createInternal(FiatOutputType.BUY_FIAT, { buyFiats: [buyFiat()] }, 1);

      expect(created).toMatchObject({
        currency: 'EUR',
        amount: 100,
        name: 'Synthetic Person',
        iban: 'DE89370400440532013000',
        country: 'DE',
      });
    });

    it('sums the output amounts of every buy-fiat on the output', async () => {
      const created = await service.createInternal(
        FiatOutputType.BUY_FIAT,
        { buyFiats: [buyFiat(), buyFiat({ outputAmount: 50 })] },
        1,
      );

      expect(created.amount).toBe(150);
    });

    it('treats a buy-fiat without an output amount as zero rather than failing', async () => {
      const created = await service.createInternal(
        FiatOutputType.BUY_FIAT,
        { buyFiats: [buyFiat({ outputAmount: undefined })] },
        1,
      );

      expect(created.amount).toBe(0);
    });

    it('prefers the IBAN of the payment link payout route over the sell route', async () => {
      sellRepo.findOneBy.mockResolvedValue({ iban: 'LU116060002000005040' } as never);
      const withRoute = buyFiat({
        paymentLinkPayment: { link: { linkConfigObj: { payoutRouteId: 5 } } },
      });

      const created = await service.createInternal(FiatOutputType.BUY_FIAT, { buyFiats: [withRoute] }, 1);

      expect(created.iban).toBe('LU116060002000005040');
    });

    it('keeps the sell IBAN when the configured payout route no longer exists', async () => {
      sellRepo.findOneBy.mockResolvedValue(null);
      const withRoute = buyFiat({
        paymentLinkPayment: { link: { linkConfigObj: { payoutRouteId: 5 } } },
      });

      const created = await service.createInternal(FiatOutputType.BUY_FIAT, { buyFiats: [withRoute] }, 1);

      expect(created.iban).toBe('DE89370400440532013000');
    });

    it('derives nothing when the buy-fiat carries no account', async () => {
      await expect(
        service.createInternal(FiatOutputType.BUY_FIAT, { buyFiats: [buyFiat({ userData: undefined })] }, 1),
      ).rejects.toThrow('Failed to create fiat output for BuyFiat 1: Missing required creditor fields');
    });

    it('uses the creditor data it is handed instead of deriving any', async () => {
      const created = await service.createInternal(FiatOutputType.BUY_FIAT, { buyFiats: [buyFiat()] }, 1, false, {
        currency: 'CHF',
        amount: 42,
        name: 'Explicit Person',
        address: 'Other Street',
        zip: '1111',
        city: 'Other City',
        country: 'CH',
        iban: 'CH9300762011623852957',
      });

      expect(created).toMatchObject({ currency: 'CHF', amount: 42, name: 'Explicit Person' });
      expect(sellRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('names the output it could not create when the creditor data is incomplete', async () => {
      await expect(service.createInternal(FiatOutputType.MANUAL, {}, 42, false, { currency: 'EUR' })).rejects.toThrow(
        'Failed to create fiat output for Manual 42: Missing required creditor fields',
      );
    });

    it('marks the output for the report when asked', async () => {
      const created = await service.createInternal(FiatOutputType.BUY_FIAT, { buyFiats: [buyFiat()] }, 1, true);

      expect(created.reportCreated).toBe(false);
    });

    it('writes through the supplied entity manager so it joins the caller transaction', async () => {
      const repo = {
        create: jest.fn().mockImplementation((values) => createCustomFiatOutput(values as never)),
        save: jest.fn().mockImplementation(async (entity) => entity),
      };
      const manager = { getRepository: jest.fn().mockReturnValue(repo) };

      await service.createInternal(
        FiatOutputType.BUY_FIAT,
        { buyFiats: [buyFiat()] },
        1,
        false,
        undefined,
        manager as never,
      );

      expect(repo.save).toHaveBeenCalled();
      expect(fiatOutputRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      fiatOutputRepo.findOneBy.mockResolvedValue(createCustomFiatOutput({ id: 1 }));
      fiatOutputRepo.save.mockImplementation(async (entity) => entity as FiatOutput);
    });

    it('refuses an output that does not exist', async () => {
      fiatOutputRepo.findOneBy.mockResolvedValue(null);

      await expect(service.update(1, {} as UpdateFiatOutputDto)).rejects.toThrow('FiatOutput not found');
    });

    it('links the bank transaction', async () => {
      const bankTxRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 5 }) };
      bankTxService.getBankTxRepo.mockReturnValue(bankTxRepo as never);

      const updated = await service.update(1, { bankTxId: 5 } as UpdateFiatOutputDto);

      expect(updated.bankTx?.id).toBe(5);
    });

    it('refuses a bank transaction that does not exist', async () => {
      bankTxService.getBankTxRepo.mockReturnValue({ findOneBy: jest.fn().mockResolvedValue(null) } as never);

      await expect(service.update(1, { bankTxId: 5 } as UpdateFiatOutputDto)).rejects.toThrow('BankTx not found');
    });

    it('resolves the bank from a newly assigned account IBAN', async () => {
      bankService.getBankByIban.mockResolvedValue(olkyEUR);

      const updated = await service.update(1, { accountIban: olkyEUR.iban } as UpdateFiatOutputDto);

      expect(updated.bank).toBe(olkyEUR);
    });

    it('refuses an account IBAN that belongs to no bank of ours', async () => {
      bankService.getBankByIban.mockResolvedValue(undefined);

      await expect(service.update(1, { accountIban: 'UNKNOWN' } as UpdateFiatOutputDto)).rejects.toThrow(
        'No bank found for account IBAN',
      );
    });

    it('rounds a new amount to a readable fiat amount', async () => {
      const updated = await service.update(1, { amount: 100.005 } as UpdateFiatOutputDto);

      expect(updated.amount).toBe(100.01);
    });

    it('leaves the amount alone when the update does not carry one', async () => {
      const updated = await service.update(1, { info: 'note' } as UpdateFiatOutputDto);

      expect(updated.amount).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('refuses an output that does not exist', async () => {
      fiatOutputRepo.findOne.mockResolvedValue(null);

      await expect(service.delete(1)).rejects.toThrow('FiatOutput not found');
    });

    it('refuses to delete an output a buy-fiat still points at', async () => {
      fiatOutputRepo.findOne.mockResolvedValue(createCustomFiatOutput({ id: 1, buyFiats: [{ id: 2 } as never] }));

      await expect(service.delete(1)).rejects.toThrow('FiatOutput remaining buyFiat');
      expect(fiatOutputRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes an output nothing points at', async () => {
      fiatOutputRepo.findOne.mockResolvedValue(createCustomFiatOutput({ id: 1, buyFiats: [] }));

      await service.delete(1);

      expect(fiatOutputRepo.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('getFiatOutputByKey', () => {
    function queryBuilder() {
      const qb: Record<string, jest.Mock> = {};
      for (const method of ['select', 'leftJoinAndSelect', 'where']) qb[method] = jest.fn(() => qb);
      qb.getOne = jest.fn().mockResolvedValue(createCustomFiatOutput({ id: 1 }));
      return qb;
    }

    it('scopes a plain key to the fiat output itself', async () => {
      const qb = queryBuilder();
      fiatOutputRepo.createQueryBuilder.mockReturnValue(qb as never);

      await expect(service.getFiatOutputByKey('id', 1)).resolves.toMatchObject({ id: 1 });
      expect(qb.where).toHaveBeenCalledWith('fiatOutput.id = :param', { param: 1 });
    });

    it('leaves a qualified key untouched so a joined relation can be addressed', async () => {
      const qb = queryBuilder();
      fiatOutputRepo.createQueryBuilder.mockReturnValue(qb as never);

      await service.getFiatOutputByKey('userData.id', 7);

      expect(qb.where).toHaveBeenCalledWith('userData.id = :param', { param: 7 });
    });
  });
  // `@Inject(forwardRef(() => X))` arguments are lazy thunks Nest only calls while resolving the graph;
  // constructing the service directly never runs them. A broken (circular) import makes one resolve to
  // undefined, which surfaces as an opaque boot failure — resolving them here turns that into a failing
  // test instead.
  describe('constructor forward references', () => {
    it('resolves every forward reference to a real class', () => {
      const deps: { index: number; param: unknown }[] =
        Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, FiatOutputService) ?? [];
      const forwardRefs = deps.filter(
        (dep): dep is { index: number; param: { forwardRef: () => unknown } } =>
          typeof (dep.param as { forwardRef?: unknown })?.forwardRef === 'function',
      );
      expect(forwardRefs.length).toBeGreaterThan(0);

      for (const dep of forwardRefs) {
        expect(dep.param.forwardRef()).toBeDefined();
      }
    });
  });
});
