import { Test, TestingModule } from '@nestjs/testing';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { PartnerConsentRepository } from '../partner-consent.repository';
import { PartnerConsentService } from '../partner-consent.service';

describe('PartnerConsentService', () => {
  let service: PartnerConsentService;
  let repo: jest.Mocked<PartnerConsentRepository>;
  let queryBuilder: {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    getRawMany: jest.Mock;
  };

  const partner = Object.assign(new Wallet(), { id: 5 });
  const userData = Object.assign(new UserData(), { id: 10 });

  beforeEach(async () => {
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerConsentService,
        {
          provide: PartnerConsentRepository,
          useValue: {
            createQueryBuilder: jest.fn(() => queryBuilder),
            create: jest.fn((x) => x),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(PartnerConsentService);
    repo = module.get(PartnerConsentRepository);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getConfirmedVersions', () => {
    it('maps the highest version per topic and filters by user and partner id', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        { topic: 'A', version: 2 },
        { topic: 'B', version: 1 },
      ]);

      const result = await service.getConfirmedVersions(userData, partner);

      expect(result).toEqual(
        new Map([
          ['A', 2],
          ['B', 1],
        ]),
      );
      expect(queryBuilder.where).toHaveBeenCalledWith('consent.userDataId = :userDataId', { userDataId: 10 });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('consent.partnerId = :partnerId', { partnerId: 5 });
      expect(queryBuilder.groupBy).toHaveBeenCalledWith('consent.topic');
    });
  });

  describe('getMissingTopics', () => {
    it('returns topics whose required version exceeds the confirmed version', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        { topic: 'A', version: 2 },
        { topic: 'B', version: 1 },
      ]);

      const required = new Map([
        ['A', 2],
        ['B', 2],
        ['C', 1],
      ]);
      const result = await service.getMissingTopics(userData, partner, required);

      // A: confirmed 2 >= required 2 -> ok; B: 1 < 2 -> missing; C: nothing < 1 -> missing
      expect(result).toEqual(['B', 'C']);
    });

    it('treats every required topic as missing when nothing is confirmed', async () => {
      queryBuilder.getRawMany.mockResolvedValue([]);

      const required = new Map([
        ['A', 1],
        ['B', 1],
      ]);
      const result = await service.getMissingTopics(userData, partner, required);

      expect(result).toEqual(['A', 'B']);
    });
  });

  describe('confirm', () => {
    it('appends one row per entry referencing the user and partner id', async () => {
      await service.confirm(userData, partner, [
        { topic: 'A', version: 1 },
        { topic: 'B', version: 3 },
      ]);

      expect(repo.create).toHaveBeenCalledTimes(2);
      expect(repo.save).toHaveBeenCalledWith([
        { userData: { id: 10 }, partner: { id: 5 }, topic: 'A', version: 1 },
        { userData: { id: 10 }, partner: { id: 5 }, topic: 'B', version: 3 },
      ]);
    });

    it('does nothing for an empty entry list', async () => {
      await service.confirm(userData, partner, []);

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
