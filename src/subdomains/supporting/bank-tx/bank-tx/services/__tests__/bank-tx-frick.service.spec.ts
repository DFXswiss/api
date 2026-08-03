import { createMock } from '@golevelup/ts-jest';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BankTx, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxRepository } from 'src/subdomains/supporting/bank-tx/bank-tx/repositories/bank-tx.repository';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { SpecialExternalAccount } from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import {
  TransactionSourceType,
  TransactionTypeInternal,
} from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { BankTxFrickService } from '../bank-tx-frick.service';
import { BankTxService } from '../bank-tx.service';

function fetchResult(transactions: Partial<BankTx>[], fullyParsed = true) {
  return { transactions, fullyParsed };
}

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
      .mockResolvedValueOnce(fetchResult([{ accountServiceRef: 'FRICK-EUR-1', bookingDate: new Date('2026-07-10') }]))
      .mockResolvedValueOnce(fetchResult([{ accountServiceRef: 'FRICK-CHF-1', bookingDate: new Date('2026-07-11') }]));
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
    frickService.getFrickTransactions
      .mockResolvedValueOnce(fetchResult([]))
      .mockRejectedValueOnce(new Error('synthetic outage'));
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
    frickService.getFrickTransactions.mockResolvedValue(
      fetchResult([{ accountServiceRef: 'SYNTHETIC-REF', bookingDate: new Date('2026-07-10') }]),
    );
    const createTx = jest
      .fn()
      .mockRejectedValueOnce(new ConflictException('duplicate'))
      .mockRejectedValueOnce(new Error('synthetic persistence failure'));

    await frickTxService.checkTransactions(createTx);

    expect(settingService.setDateMax).toHaveBeenCalledTimes(1);
    expect(settingService.setDateMax).toHaveBeenCalledWith('lastBankFrickDate:101', expect.any(Date));
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('does not advance the watermark when the parser dropped an entry, but still imports the other, well-formed entries in the same fetch', async () => {
    bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
    frickService.getFrickTransactions.mockResolvedValue(
      fetchResult([{ accountServiceRef: 'FRICK-GOOD-ENTRY', bookingDate: new Date('2026-07-10') }], false),
    );
    const createTx = jest.fn().mockResolvedValue({});

    await frickTxService.checkTransactions(createTx);

    expect(createTx).toHaveBeenCalledTimes(1);
    expect(settingService.setDateMax).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      'Bank Frick camt.053 fetch for bank row 101 contained at least one entry that failed strict validation and was dropped; the watermark will not advance past this window until it is fixed.',
    );
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
      frickService.getFrickTransactions.mockResolvedValue(
        fetchResult([
          { accountServiceRef: 'FRICK-OLD', bookingDate: olderBookingDate },
          { accountServiceRef: 'FRICK-NEW', bookingDate: maxBookingDate },
        ]),
      );
      const createTx = jest.fn().mockResolvedValue({});

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).toHaveBeenCalledWith('lastBankFrickDate:101', overlapOf(maxBookingDate));
    });

    it('clamps a future booking date to wall-clock now before applying the overlap', async () => {
      const now = new Date('2024-06-15T12:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockResolvedValue(
        fetchResult([{ accountServiceRef: 'FRICK-FUTURE', bookingDate: new Date('2024-06-20T00:00:00.000Z') }]),
      );
      const createTx = jest.fn().mockResolvedValue({});

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).toHaveBeenCalledWith('lastBankFrickDate:101', overlapOf(now));
    });

    it('leaves the watermark unchanged on an empty response', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockResolvedValue(fetchResult([]));
      const createTx = jest.fn();

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).not.toHaveBeenCalled();
    });

    it('delegates monotonicity to the atomic setting update', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      const aheadWatermark = new Date('2024-05-01T00:00:00.000Z');
      settingService.get.mockResolvedValue(aheadWatermark.toISOString());
      frickService.getFrickTransactions.mockResolvedValue(
        fetchResult([{ accountServiceRef: 'FRICK-OLD', bookingDate: new Date('2024-01-01T00:00:00.000Z') }]),
      );
      const createTx = jest.fn().mockResolvedValue({});

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).toHaveBeenCalledWith(
        'lastBankFrickDate:101',
        overlapOf(new Date('2024-01-01T00:00:00.000Z')),
      );
    });

    it('fails before importing when a parsed transaction has no valid booking date', async () => {
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true)]);
      frickService.getFrickTransactions.mockResolvedValue(
        fetchResult([{ accountServiceRef: 'FRICK-MALFORMED', bookingDate: undefined }]),
      );
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
      frickService.getFrickTransactions.mockResolvedValue(
        fetchResult([{ accountServiceRef: 'FRICK-1', bookingDate: new Date('2024-01-01T00:00:00.000Z') }]),
      );
      const createTx = jest.fn().mockRejectedValue(new Error('synthetic persistence failure'));

      await frickTxService.checkTransactions(createTx);

      expect(settingService.setDateMax).not.toHaveBeenCalled();
    });
  });

  describe('send=true/receive=false deadlock guard', () => {
    it('logs a loud error for a Frick row with send=true and receive=false but still polls other correctly-configured rows in the same cycle', async () => {
      bankService.getBanksByName.mockResolvedValue([
        bank(101, 'SYNTHETIC-FRICK-EUR', true),
        bank(102, 'SYNTHETIC-FRICK-DEADLOCKED', false, true),
      ]);
      frickService.getFrickTransactions.mockResolvedValue(fetchResult([]));
      const createTx = jest.fn();

      await frickTxService.checkTransactions(createTx);

      expect(loggerError).toHaveBeenCalledWith(
        "Bank Frick row(s) 102 have send=true and receive=false - payout reconciliation will deadlock. Fix the row's flags before further payouts are processed.",
      );
      // still polls the other, correctly-configured receiving row
      expect(frickService.getFrickTransactions).toHaveBeenCalledTimes(1);
      expect(frickService.getFrickTransactions).toHaveBeenCalledWith(expect.any(Date), 'SYNTHETIC-FRICK-EUR');
    });

    it('does not log the deadlock warning for a normally-configured row', async () => {
      bankService.getBanksByName.mockResolvedValue([bank(101, 'SYNTHETIC-FRICK-EUR', true, true)]);
      frickService.getFrickTransactions.mockResolvedValue(fetchResult([]));
      const createTx = jest.fn();

      await frickTxService.checkTransactions(createTx);

      expect(loggerError).not.toHaveBeenCalledWith(expect.stringContaining('deadlock'));
    });
  });

  function bank(id: number, iban: string, receive: boolean, send = false): Bank {
    return Object.assign(new Bank(), { id, iban, receive, send, name: IbanBankName.FRICK });
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

  it('still assigns and fills bank transactions when the Bank Frick poll fails', async () => {
    const bankService = { getBankInternal: jest.fn().mockResolvedValue(undefined) };
    const frickTxServiceMock: jest.Mocked<Pick<BankTxFrickService, 'checkTransactions'>> = {
      checkTransactions: jest.fn().mockRejectedValue(new Error('synthetic Frick outage')),
    };
    const bankTxRepo = { find: jest.fn().mockResolvedValue([]) };
    const loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({ providers: [BankTxService] })
      .useMocker((token) => {
        if (token === BankService) return bankService;
        if (token === BankTxFrickService) return frickTxServiceMock;
        if (token === BankTxRepository) return bankTxRepo;
        return createMock();
      })
      .compile();

    const service = module.get(BankTxService);

    await expect(service.checkBankTx()).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalledWith(
      'Failed to check Bank Frick transactions:',
      expect.objectContaining({ message: 'synthetic Frick outage' }),
    );

    // assignTransactions (relations: transaction) and fillBankTx (relations: buyCrypto/buyFiats)
    // must both still query for work after the failed Frick poll
    expect(bankTxRepo.find).toHaveBeenCalledTimes(2);
    expect(bankTxRepo.find).toHaveBeenNthCalledWith(1, expect.objectContaining({ relations: { transaction: true } }));
    expect(bankTxRepo.find).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ relations: { buyCrypto: true, buyFiats: true } }),
    );
    expect(Math.min(...bankTxRepo.find.mock.invocationCallOrder)).toBeGreaterThan(
      frickTxServiceMock.checkTransactions.mock.invocationCallOrder[0],
    );
  });

  it('hands Bank Frick a callback that performs the real BankTx creation', async () => {
    const bankService = {
      getBankInternal: jest.fn().mockResolvedValue(undefined),
      areKnownBankIbans: jest.fn().mockResolvedValue(false),
    };
    const frickTxServiceMock: jest.Mocked<Pick<BankTxFrickService, 'checkTransactions'>> = {
      checkTransactions: jest.fn().mockResolvedValue(undefined),
    };
    const createdTransaction = { id: 4711 };
    const transactionService = { create: jest.fn().mockResolvedValue(createdTransaction) };
    const getSenderAccount = jest.fn().mockReturnValue('SYNTHETIC-SENDER');
    const bankTxRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((entity) => ({ ...entity, getSenderAccount })),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: 4242 })),
    };
    jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({ providers: [BankTxService] })
      .useMocker((token) => {
        if (token === BankService) return bankService;
        if (token === BankTxFrickService) return frickTxServiceMock;
        if (token === BankTxRepository) return bankTxRepo;
        if (token === TransactionService) return transactionService;
        return createMock();
      })
      .compile();

    const service = module.get(BankTxService);

    await service.checkBankTx();

    const [createCallback] = frickTxServiceMock.checkTransactions.mock.calls[0];
    const multiAccounts = [{ id: 7 } as SpecialExternalAccount];

    const created = await createCallback(
      { accountServiceRef: 'FRICK-CB-1', name: 'Payward Trading Ltd' },
      multiAccounts,
    );

    // the callback must run the real create: duplicate check, sender-account resolution,
    // type mapping, transaction creation, and persistence
    expect(bankTxRepo.findOneBy).toHaveBeenCalledWith({ accountServiceRef: 'FRICK-CB-1' });
    expect(getSenderAccount).toHaveBeenCalledWith(multiAccounts);
    expect(transactionService.create).toHaveBeenCalledWith({
      sourceType: TransactionSourceType.BANK_TX,
      type: TransactionTypeInternal.KRAKEN,
    });
    expect(bankTxRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountServiceRef: 'FRICK-CB-1',
        senderAccount: 'SYNTHETIC-SENDER',
        type: BankTxType.KRAKEN,
        transaction: createdTransaction,
      }),
    );
    expect(created).toEqual(expect.objectContaining({ id: 4242, accountServiceRef: 'FRICK-CB-1' }));
  });
});
