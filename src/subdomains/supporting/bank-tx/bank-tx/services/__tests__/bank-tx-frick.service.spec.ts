import { createMock } from '@golevelup/ts-jest';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { BankTxRepository } from '../../repositories/bank-tx.repository';
import { BankTxService } from '../bank-tx.service';

describe('BankTxService Bank Frick polling', () => {
  let service: BankTxService;
  let frickService: jest.Mocked<Pick<BankFrickService, 'isAvailable' | 'getFrickTransactions'>>;
  let bankService: jest.Mocked<Pick<BankService, 'getBanksByName' | 'getBankInternal'>>;
  let settingService: jest.Mocked<Pick<SettingService, 'get' | 'set'>>;
  let specialAccountService: jest.Mocked<Pick<SpecialExternalAccountService, 'getMultiAccounts'>>;
  let bankTxRepo: jest.Mocked<Pick<BankTxRepository, 'find'>>;
  let loggerWarn: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(async () => {
    frickService = { isAvailable: jest.fn().mockReturnValue(true), getFrickTransactions: jest.fn() };
    bankService = { getBanksByName: jest.fn(), getBankInternal: jest.fn() };
    settingService = {
      get: jest.fn().mockResolvedValue(new Date(0).toISOString()),
      set: jest.fn().mockResolvedValue(undefined),
    };
    specialAccountService = { getMultiAccounts: jest.fn().mockResolvedValue([]) };
    bankTxRepo = { find: jest.fn().mockResolvedValue([]) };
    loggerWarn = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();
    loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({ providers: [BankTxService] })
      .useMocker((token) => {
        if (token === BankFrickService) return frickService;
        if (token === BankService) return bankService;
        if (token === SettingService) return settingService;
        if (token === SpecialExternalAccountService) return specialAccountService;
        if (token === BankTxRepository) return bankTxRepo;
        return createMock();
      })
      .compile();

    service = module.get(BankTxService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('polls every receiving account with an account-specific watermark and loads multi-accounts once', async () => {
    bankService.getBanksByName.mockResolvedValue([
      bank(101, 'SYNTHETIC-FRICK-EUR', true),
      bank(102, 'SYNTHETIC-FRICK-CHF', true),
      bank(103, 'SYNTHETIC-NON-RECEIVING', false),
    ]);
    frickService.getFrickTransactions
      .mockResolvedValueOnce([{ accountServiceRef: 'FRICK-EUR-1' }])
      .mockResolvedValueOnce([{ accountServiceRef: 'FRICK-CHF-1' }]);
    jest.spyOn(service, 'create').mockResolvedValue({});

    await service['checkFrickTransactions']();

    expect(bankService.getBanksByName).toHaveBeenCalledWith(IbanBankName.FRICK);
    expect(frickService.getFrickTransactions).toHaveBeenCalledTimes(2);
    expect(frickService.getFrickTransactions.mock.calls.map((call) => call[1])).toEqual([
      'SYNTHETIC-FRICK-EUR',
      'SYNTHETIC-FRICK-CHF',
    ]);
    expect(settingService.get.mock.calls.map((call) => call[0])).toEqual([
      'lastBankFrickDate:101',
      'lastBankFrickDate:102',
    ]);
    expect(settingService.set.mock.calls.map((call) => call[0])).toEqual([
      'lastBankFrickDate:101',
      'lastBankFrickDate:102',
    ]);
    expect(specialAccountService.getMultiAccounts).toHaveBeenCalledTimes(1);
  });

  it('advances the watermark after an empty response but not after a fetch failure', async () => {
    bankService.getBanksByName.mockResolvedValue([
      bank(101, 'SYNTHETIC-FRICK-EUR', true),
      bank(102, 'SYNTHETIC-FRICK-CHF', true),
    ]);
    frickService.getFrickTransactions.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('synthetic outage'));
    jest.spyOn(service, 'create');

    await service['checkFrickTransactions']();

    expect(settingService.set).toHaveBeenCalledTimes(1);
    expect(settingService.set).toHaveBeenCalledWith('lastBankFrickDate:101', expect.any(String));
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('treats duplicate conflicts as successfully processed but blocks advancement on other import errors', async () => {
    bankService.getBanksByName.mockResolvedValue([
      bank(101, 'SYNTHETIC-FRICK-EUR', true),
      bank(102, 'SYNTHETIC-FRICK-CHF', true),
    ]);
    frickService.getFrickTransactions.mockResolvedValue([{ accountServiceRef: 'SYNTHETIC-REF' }]);
    const create = jest
      .fn()
      .mockRejectedValueOnce(new ConflictException('duplicate'))
      .mockRejectedValueOnce(new Error('synthetic persistence failure'));
    jest.spyOn(service, 'create').mockImplementation(create);

    await service['checkFrickTransactions']();

    expect(settingService.set).toHaveBeenCalledTimes(1);
    expect(settingService.set).toHaveBeenCalledWith('lastBankFrickDate:101', expect.any(String));
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('warns only once while the integration is unconfigured', async () => {
    frickService.isAvailable.mockReturnValue(false);

    await service['checkFrickTransactions']();
    await service['checkFrickTransactions']();

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(bankService.getBanksByName).not.toHaveBeenCalled();
  });

  it('stops safely when the Bank Frick registry cannot be loaded', async () => {
    bankService.getBanksByName.mockRejectedValue(new Error('synthetic registry outage'));

    await service['checkFrickTransactions']();

    expect(loggerError).toHaveBeenCalledWith('Failed to load Bank Frick account registry:', expect.any(Error));
    expect(specialAccountService.getMultiAccounts).not.toHaveBeenCalled();
    expect(frickService.getFrickTransactions).not.toHaveBeenCalled();
  });

  it('warns and stops when no receiving Bank Frick account is registered', async () => {
    bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-NON-RECEIVING', false)]);

    await service['checkFrickTransactions']();

    expect(loggerWarn).toHaveBeenCalledWith(
      'No receiving Bank Frick accounts configured - skipping transaction import',
    );
    expect(specialAccountService.getMultiAccounts).not.toHaveBeenCalled();
    expect(frickService.getFrickTransactions).not.toHaveBeenCalled();
  });

  it('stops safely when special accounts cannot be loaded', async () => {
    bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
    specialAccountService.getMultiAccounts.mockRejectedValue(new Error('synthetic special-account outage'));

    await service['checkFrickTransactions']();

    expect(loggerError).toHaveBeenCalledWith(
      'Failed to load special accounts for Bank Frick transaction import:',
      expect.any(Error),
    );
    expect(frickService.getFrickTransactions).not.toHaveBeenCalled();
  });

  it.each([0, Number.NaN, 1.5])('skips a Bank Frick row with invalid id %s', async (id) => {
    bankService.getBanksByName.mockResolvedValue([bank(id, 'SYNTHETIC-FRICK-EUR', true)]);

    await service['checkFrickTransactions']();

    expect(loggerError).toHaveBeenCalledWith('Failed to import Bank Frick transactions: invalid bank row id');
    expect(frickService.getFrickTransactions).not.toHaveBeenCalled();
    expect(settingService.set).not.toHaveBeenCalled();
  });

  it('still checks Bank Frick when the Olkypay poll fails', async () => {
    bankService.getBankInternal.mockRejectedValue(new Error('synthetic Olkypay outage'));
    bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
    frickService.getFrickTransactions.mockResolvedValue([]);

    await service.checkBankTx();

    expect(frickService.getFrickTransactions).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith('Failed to check Olkypay transactions:', expect.any(Error));
  });

  describe('watermark overlap', () => {
    const OVERLAP_DAYS = (BankTxService as unknown as { FRICK_WATERMARK_OVERLAP_DAYS: number })
      .FRICK_WATERMARK_OVERLAP_DAYS;

    function overlapOf(date: Date): Date {
      const result = new Date(date);
      result.setDate(result.getDate() - OVERLAP_DAYS);
      return result;
    }

    it('sets the watermark to the newest processed booking date minus the overlap when it precedes now', async () => {
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      const olderBookingDate = new Date('2024-01-05T00:00:00.000Z');
      const maxBookingDate = new Date('2024-01-10T00:00:00.000Z');
      frickService.getFrickTransactions.mockResolvedValue([
        { accountServiceRef: 'FRICK-OLD', bookingDate: olderBookingDate },
        { accountServiceRef: 'FRICK-NEW', bookingDate: maxBookingDate },
      ]);
      jest.spyOn(service, 'create').mockResolvedValue({});

      await service['checkFrickTransactions']();

      expect(settingService.set).toHaveBeenCalledWith('lastBankFrickDate:101', overlapOf(maxBookingDate).toISOString());
    });

    it('sets the watermark to now minus the overlap on an empty response', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockResolvedValue([]);

      await service['checkFrickTransactions']();

      expect(settingService.set).toHaveBeenCalledWith(
        'lastBankFrickDate:101',
        overlapOf(new Date('2024-06-15T12:00:00.000Z')).toISOString(),
      );
    });

    it('never moves the watermark backwards when it is already ahead of the computed candidate', async () => {
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      const aheadWatermark = new Date('2024-05-01T00:00:00.000Z');
      settingService.get.mockResolvedValue(aheadWatermark.toISOString());
      frickService.getFrickTransactions.mockResolvedValue([
        { accountServiceRef: 'FRICK-OLD', bookingDate: new Date('2024-01-01T00:00:00.000Z') },
      ]);
      jest.spyOn(service, 'create').mockResolvedValue({});

      await service['checkFrickTransactions']();

      expect(settingService.set).toHaveBeenCalledWith('lastBankFrickDate:101', aheadWatermark.toISOString());
    });

    it('leaves the watermark unchanged when the statement fetch itself fails', async () => {
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockRejectedValue(new Error('synthetic outage'));

      await service['checkFrickTransactions']();

      expect(settingService.set).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(
        'Failed to fetch Bank Frick transactions for bank row 101:',
        expect.any(Error),
      );
    });

    it('leaves the watermark unchanged when an import fails with a non-conflict error', async () => {
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockResolvedValue([
        { accountServiceRef: 'FRICK-1', bookingDate: new Date('2024-01-01T00:00:00.000Z') },
      ]);
      jest.spyOn(service, 'create').mockRejectedValue(new Error('synthetic persistence failure'));

      await service['checkFrickTransactions']();

      expect(settingService.set).not.toHaveBeenCalled();
    });
  });

  function bank(id: number, iban: string, receive: boolean): Bank {
    return { id, iban, receive } as Bank;
  }
});
