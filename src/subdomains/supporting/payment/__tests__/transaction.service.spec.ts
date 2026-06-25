import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { TransactionRequestType } from '../entities/transaction-request.entity';
import { TransactionRepository } from '../repositories/transaction.repository';
import { SpecialExternalAccountService } from '../services/special-external-account.service';
import { TransactionService } from '../services/transaction.service';

describe('TransactionService', () => {
  let service: TransactionService;
  let repo: jest.Mocked<TransactionRepository>;

  beforeEach(async () => {
    repo = createMock<TransactionRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: TransactionRepository, useValue: repo },
        { provide: UserDataService, useValue: createMock<UserDataService>() },
        { provide: BankDataService, useValue: createMock<BankDataService>() },
        { provide: SpecialExternalAccountService, useValue: createMock<SpecialExternalAccountService>() },
        { provide: BuyCryptoRepository, useValue: createMock<BuyCryptoRepository>() },
      ],
    }).compile();

    service = module.get(TransactionService);
  });

  describe('getAssetTradingStats', () => {
    function mockQueryBuilder(rows: { type: TransactionRequestType; volume: string; count: string }[]): {
      select: jest.Mock;
      addSelect: jest.Mock;
      innerJoin: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      groupBy: jest.Mock;
      getRawMany: jest.Mock;
    } {
      const subQuery = { where: jest.fn().mockReturnThis(), orWhere: jest.fn().mockReturnThis() };
      const query = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockImplementation(function (this: unknown, arg: unknown) {
          // Execute the Brackets where-factory so its callback body is exercised.
          if (arg && typeof (arg as { whereFactory?: unknown }).whereFactory === 'function') {
            (arg as { whereFactory: (qb: unknown) => void }).whereFactory(subQuery);
          }
          return this;
        }),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      repo.createQueryBuilder.mockReturnValue(query as never);
      return query;
    }

    it('maps raw rows to numbers without date filters', async () => {
      const query = mockQueryBuilder([
        { type: TransactionRequestType.BUY, volume: '1234.5', count: '10' },
        { type: TransactionRequestType.SELL, volume: '500', count: '3' },
      ]);

      const result = await service.getAssetTradingStats(408);

      expect(result).toEqual([
        { type: TransactionRequestType.BUY, volume: 1234.5, count: 10 },
        { type: TransactionRequestType.SELL, volume: 500, count: 3 },
      ]);
      expect(query.groupBy).toHaveBeenCalledWith('request.type');
      expect(query.andWhere).not.toHaveBeenCalledWith('transaction.created >= :from', expect.anything());
      expect(query.andWhere).not.toHaveBeenCalledWith('transaction.created <= :to', expect.anything());
    });

    it('coerces null/NaN volume and count to 0', async () => {
      mockQueryBuilder([
        { type: TransactionRequestType.BUY, volume: null as unknown as string, count: undefined as unknown as string },
      ]);

      const result = await service.getAssetTradingStats(408);

      expect(result).toEqual([{ type: TransactionRequestType.BUY, volume: 0, count: 0 }]);
    });

    it('applies from and to date filters when provided', async () => {
      const query = mockQueryBuilder([]);
      const from = new Date('2024-01-01');
      const to = new Date('2024-02-01');

      const result = await service.getAssetTradingStats(408, from, to);

      expect(result).toEqual([]);
      expect(query.andWhere).toHaveBeenCalledWith('transaction.created >= :from', { from });
      expect(query.andWhere).toHaveBeenCalledWith('transaction.created <= :to', { to });
    });
  });
});
