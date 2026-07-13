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
import { BankTxFrickService } from '../bank-tx-frick.service';
import { BankTxService } from '../bank-tx.service';

describe('BankTxFrickService', () => {
  let frickTxService: BankTxFrickService;
  let frickService: jest.Mocked<Pick<BankFrickService, 'isAvailable' | 'getFrickTransactions'>>;
  let bankService: jest.Mocked<Pick<BankService, 'getBanksByName'>>;
  let settingService: jest.Mocked<Pick<SettingService, 'get' | 'setDateMax'>>;
  let specialAccountService: jest.Mocked<Pick<SpecialExternalAccountService, 'getMultiAccounts'>>;
  let loggerWarn: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(async () => {
    frickService = { isAvailable: jest.fn().mockReturnValue(true), getFrickTransactions: jest.fn() };
    bankService = { getBanksByName: jest.fn() };
    settingService = {
      get: jest.fn().mockResolvedValue(new Date(0).toISOString()),
      setDateMax: jest.fn().mockResolvedValue(undefined),
    };
    specialAccountService = { getMultiAccounts: jest.fn().mockResolvedValue([]) };
    loggerWarn = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();
    loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({ providers: [BankTxFrickService] })
      .useMocker((token) => {
        if (token === BankFrickService) return frickService;
        if (token === BankService) return bankService;
        if (token === SettingService) return settingService;
        if (token === SpecialExternalAccountService) return specialAccountService;
        return createMock();
      })
      .compile();

    frickTxService = module.get(BankTxFrickService);
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
      .mockResolvedValueOnce([{ accountServiceRef: 'FRICK-EUR-1', bookingDate: new Date('2026-07-10') }])
      .mockResolvedValueOnce([{ accountServiceRef: 'FRICK-CHF-1', bookingDate: new Date('2026-07-11') }]);
    const createTx = jest.fn().mockResolvedValue({});

    await frickTxService.checkTransactions(createTx);

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
    expect(settingService.setDateMax.mock.calls.map((call) => call[0])).toEqual([
      'lastBankFrickDate:101',
      'lastBankFrickDate:102',
    ]);
    expect(specialAccountService.getMultiAccounts).toHaveBeenCalledTimes(1);
  });

  it('does not advance the watermark after an empty response or a fetch failure', async () => {
    bankService.getBanksByName.mockResolvedValue([
      bank(101, 'SYNTHETIC-FRICK-EUR', true),
      bank(102, 'SYNTHETIC-FRICK-CHF', true),
    ]);
    frickService.getFrickTransactions.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('synthetic outage'));
    const createTx = jest.fn();

    await frickTxService.checkTransactions(createTx);

    expect(settingService.setDateMax).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('treats duplicate conflicts as successfully processed but blocks advancement on other import errors', async () => {
    bankService.getBanksByName.mockResolvedValue([
      bank(101, 'SYNTHETIC-FRICK-EUR', true),
      bank(102, 'SYNTHETIC-FRICK-CHF', true),
    ]);
    frickService.getFrickTransactions.mockResolvedValue([
      { accountServiceRef: 'SYNTHETIC-REF', bookingDate: new Date('2026-07-10') },
    ]);
    const createTx = jest
      .fn()
      .mockRejectedValueOnce(new ConflictException('duplicate'))
      .mockRejectedValueOnce(new Error('synthetic persistence failure'));

    await frickTxService.checkTransactions(createTx);

    expect(settingService.setDateMax).toHaveBeenCalledTimes(1);
    expect(settingService.setDateMax).toHaveBeenCalledWith('lastBankFrickDate:101', expect.any(Date));
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('warns only once while the integration is unconfigured', async () => {
    frickService.isAvailable.mockReturnValue(false);
    const createTx = jest.fn();

    await frickTxService.checkTransactions(createTx);
    await frickTxService.checkTransactions(createTx);

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(bankService.getBanksByName).not.toHaveBeenCalled();
  });

  it('stops safely when the Bank Frick registry cannot be loaded', async () => {
    bankService.getBanksByName.mockRejectedValue(new Error('synthetic registry outage'));
    const createTx = jest.fn();

    await frickTxService.checkTransactions(createTx);

    expect(loggerError).toHaveBeenCalledWith('Failed to load Bank Frick account registry:', expect.any(Error));
    expect(specialAccountService.getMultiAccounts).not.toHaveBeenCalled();
    expect(frickService.getFrickTransactions).not.toHaveBeenCalled();
  });

  it('warns and stops when no receiving Bank Frick account is registered', async () => {
    bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-NON-RECEIVING', false)]);
    const createTx = jest.fn();

    await frickTxService.checkTransactions(createTx);

    expect(loggerWarn).toHaveBeenCalledWith(
      'No receiving Bank Frick accounts configured - skipping transaction import',
    );
    expect(specialAccountService.getMultiAccounts).not.toHaveBeenCalled();
    expect(frickService.getFrickTransactions).not.toHaveBeenCalled();
  });

  it('stops safely when special accounts cannot be loaded', async () => {
    bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
    specialAccountService.getMultiAccounts.mockRejectedValue(new Error('synthetic special-account outage'));
    const createTx = jest.fn();

    await frickTxService.checkTransactions(createTx);

    expect(loggerError).toHaveBeenCalledWith(
      'Failed to load special accounts for Bank Frick transaction import:',
      expect.any(Error),
    );
    expect(frickService.getFrickTransactions).not.toHaveBeenCalled();
  });

  it.each([0, Number.NaN, 1.5])('skips a Bank Frick row with invalid id %s', async (id) => {
    bankService.getBanksByName.mockResolvedValue([bank(id, 'SYNTHETIC-FRICK-EUR', true)]);
    const createTx = jest.fn();

    await frickTxService.checkTransactions(createTx);

    expect(loggerError).toHaveBeenCalledWith('Failed to import Bank Frick transactions: invalid bank row id');
    expect(frickService.getFrickTransactions).not.toHaveBeenCalled();
    expect(settingService.setDateMax).not.toHaveBeenCalled();
  });

  describe('watermark overlap', () => {
    const OVERLAP_DAYS = (BankTxFrickService as unknown as { FRICK_WATERMARK_OVERLAP_DAYS: number })
      .FRICK_WATERMARK_OVERLAP_DAYS;

    function overlapOf(date: Date): Date {
      const result = new Date(date);
      result.setUTCDate(result.getUTCDate() - OVERLAP_DAYS);
      return result;
    }

    it('sets the watermark to the newest processed booking date minus the overlap', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      const olderBookingDate = new Date('2024-01-05T00:00:00.000Z');
      const maxBookingDate = new Date('2024-01-10T00:00:00.000Z');
      frickService.getFrickTransactions.mockResolvedValue([
        { accountServiceRef: 'FRICK-OLD', bookingDate: olderBookingDate },
        { accountServiceRef: 'FRICK-NEW', bookingDate: maxBookingDate },
      ]);
      const createTx = jest.fn().mockResolvedValue({});

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).toHaveBeenCalledWith('lastBankFrickDate:101', overlapOf(maxBookingDate));
    });

    it('clamps a future booking date to wall-clock now before applying the overlap', async () => {
      const now = new Date('2024-06-15T12:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockResolvedValue([
        { accountServiceRef: 'FRICK-FUTURE', bookingDate: new Date('2024-06-20T00:00:00.000Z') },
      ]);
      const createTx = jest.fn().mockResolvedValue({});

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).toHaveBeenCalledWith('lastBankFrickDate:101', overlapOf(now));
    });

    it('leaves the watermark unchanged on an empty response', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockResolvedValue([]);
      const createTx = jest.fn();

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).not.toHaveBeenCalled();
    });

    it('delegates monotonicity to the atomic setting update', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      const aheadWatermark = new Date('2024-05-01T00:00:00.000Z');
      settingService.get.mockResolvedValue(aheadWatermark.toISOString());
      frickService.getFrickTransactions.mockResolvedValue([
        { accountServiceRef: 'FRICK-OLD', bookingDate: new Date('2024-01-01T00:00:00.000Z') },
      ]);
      const createTx = jest.fn().mockResolvedValue({});

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).toHaveBeenCalledWith(
        'lastBankFrickDate:101',
        overlapOf(new Date('2024-01-01T00:00:00.000Z')),
      );
    });

    it('fails before importing when a parsed transaction has no valid booking date', async () => {
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockResolvedValue([
        { accountServiceRef: 'FRICK-MALFORMED', bookingDate: undefined },
      ]);
      const createTx = jest.fn();

      await frickTxService.checkTransactions(createTx);

      expect(createTx).not.toHaveBeenCalled();
      expect(settingService.setDateMax).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(
        'Failed to fetch Bank Frick transactions for bank row 101:',
        expect.objectContaining({ message: 'Invalid booking date in parsed Bank Frick transaction' }),
      );
    });

    it('leaves the watermark unchanged when the statement fetch itself fails', async () => {
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockRejectedValue(new Error('synthetic outage'));
      const createTx = jest.fn();

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).not.toHaveBeenCalled();
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
      const createTx = jest.fn().mockRejectedValue(new Error('synthetic persistence failure'));

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).not.toHaveBeenCalled();
    });
  });

  function bank(id: number, iban: string, receive: boolean): Bank {
    return { id, iban, receive } as Bank;
  }
});

describe('BankTxService Bank Frick wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('still checks Bank Frick when the Olkypay poll fails', async () => {
    const bankService = { getBankInternal: jest.fn().mockRejectedValue(new Error('synthetic Olkypay outage')) };
    const frickTxServiceMock: jest.Mocked<Pick<BankTxFrickService, 'checkTransactions'>> = {
      checkTransactions: jest.fn().mockResolvedValue(undefined),
    };
    const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({ providers: [BankTxService] })
      .useMocker((token) => {
        if (token === BankService) return bankService;
        if (token === BankTxFrickService) return frickTxServiceMock;
        return createMock();
      })
      .compile();

    const service = module.get(BankTxService);

    await service.checkBankTx();

    expect(frickTxServiceMock.checkTransactions).toHaveBeenCalledTimes(1);
    expect(frickTxServiceMock.checkTransactions).toHaveBeenCalledWith(expect.any(Function));
    expect(loggerError).toHaveBeenCalledWith('Failed to check Olkypay transactions:', expect.any(Error));
  });
});
