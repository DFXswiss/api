import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { BankObserver } from '../bank.observer';

describe('BankObserver', () => {
  let observer: BankObserver;
  let repos: RepositoryFactory;
  let olkypayService: { getBalance: jest.Mock };
  let bankService: { getBankInternal: jest.Mock };
  let yapealService: { isAvailable: jest.Mock; getBalances: jest.Mock };
  let frickService: { isAvailable: jest.Mock; getBalances: jest.Mock };
  let chainableQuery: {
    select: jest.Mock;
    where: jest.Mock;
    getRawOne: jest.Mock;
  };

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    chainableQuery = {
      select: jest.fn(),
      where: jest.fn(),
      getRawOne: jest.fn().mockResolvedValue({ dbBalance: 1000 }),
    };
    chainableQuery.select.mockReturnValue(chainableQuery);
    chainableQuery.where.mockReturnValue(chainableQuery);

    // RepositoryFactory is a concrete class whose nested repositories are plain instance properties,
    // not something @golevelup/ts-jest's createMock deep-mocks automatically - build only the surface
    // getDbBalance() actually touches.
    repos = {
      bankTx: { createQueryBuilder: jest.fn().mockReturnValue(chainableQuery) },
    } as unknown as RepositoryFactory;

    olkypayService = {
      getBalance: jest.fn(),
    };
    bankService = {
      getBankInternal: jest.fn(),
    };
    yapealService = {
      isAvailable: jest.fn().mockReturnValue(false),
      getBalances: jest.fn(),
    };
    frickService = {
      isAvailable: jest.fn().mockReturnValue(false),
      getBalances: jest.fn(),
    };

    observer = new BankObserver(
      createMock<MonitoringService>(),
      olkypayService as unknown as OlkypayService,
      bankService as unknown as BankService,
      repos,
      yapealService as unknown as YapealService,
      frickService as unknown as BankFrickService,
    );
  });

  describe('getFrick', () => {
    it('maps a normal FrickBalance with finite availableBalance into a BankData row', async () => {
      chainableQuery.getRawOne.mockResolvedValue({ dbBalance: 900.456 });
      frickService.getBalances.mockResolvedValue([
        {
          iban: 'LI21088110104933K000E',
          currency: 'CHF',
          balance: 1200,
          availableBalance: 1100.5,
        },
      ]);

      const result = await observer['getFrick']();

      expect(result).toEqual([
        {
          name: 'Bank Frick',
          currency: 'CHF',
          balance: 1100.5,
          dbBalance: 900.46,
          difference: 1100.5 - 900.46,
        },
      ]);
      expect(repos.bankTx.createQueryBuilder).toHaveBeenCalledWith('bankTx');
      expect(chainableQuery.where).toHaveBeenCalledWith('bankTx.accountIban = :iban AND bankTx.currency = :currency', {
        iban: 'LI21088110104933K000E',
        currency: 'CHF',
      });
    });

    it('throws when availableBalance is undefined (not a finite number)', async () => {
      frickService.getBalances.mockResolvedValue([
        {
          iban: 'LI21088110104933K000E',
          currency: 'CHF',
          balance: 1200,
          availableBalance: undefined,
        },
      ]);

      await expect(observer['getFrick']()).rejects.toThrow(
        'Missing available balance for Bank Frick account LI21088110104933K000E',
      );
    });

    it('throws when availableBalance is NaN', async () => {
      frickService.getBalances.mockResolvedValue([
        {
          iban: 'LI21088110104933K000E',
          currency: 'EUR',
          balance: 500,
          availableBalance: Number.NaN,
        },
      ]);

      await expect(observer['getFrick']()).rejects.toThrow(
        'Missing available balance for Bank Frick account LI21088110104933K000E',
      );
    });
  });

  describe('fetch', () => {
    it('includes Frick rows in the aggregated output when frickService.isAvailable() is true', async () => {
      frickService.isAvailable.mockReturnValue(true);
      frickService.getBalances.mockResolvedValue([
        {
          iban: 'LI21088110104933K000E',
          currency: 'CHF',
          balance: 2000,
          availableBalance: 1500,
        },
      ]);
      chainableQuery.getRawOne.mockResolvedValue({ dbBalance: 1400 });

      const data = await observer.fetch();

      expect(frickService.getBalances).toHaveBeenCalled();
      expect(data).toEqual([
        {
          name: 'Bank Frick',
          currency: 'CHF',
          balance: 1500,
          dbBalance: 1400,
          difference: 100,
        },
      ]);
    });

    it('does not call frickService.getBalances when frickService.isAvailable() is false', async () => {
      frickService.isAvailable.mockReturnValue(false);

      const data = await observer.fetch();

      expect(frickService.getBalances).not.toHaveBeenCalled();
      expect(data).toEqual([]);
    });
  });
});
