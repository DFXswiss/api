import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { ReviewStatus } from '../enums/review-status.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';
import { KycAdminService } from '../services/kyc-admin.service';
import { KycNotificationService } from '../services/kyc-notification.service';
import { KycService } from '../services/kyc.service';
import { NameCheckService } from '../services/name-check.service';

describe('KycAdminService', () => {
  let service: KycAdminService;
  let kycStepRepo: jest.Mocked<KycStepRepository>;

  beforeEach(async () => {
    kycStepRepo = createMock<KycStepRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycAdminService,
        { provide: KycStepRepository, useValue: kycStepRepo },
        { provide: WebhookService, useValue: createMock<WebhookService>() },
        { provide: KycService, useValue: createMock<KycService>() },
        { provide: KycNotificationService, useValue: createMock<KycNotificationService>() },
        { provide: UserDataService, useValue: createMock<UserDataService>() },
        { provide: NameCheckService, useValue: createMock<NameCheckService>() },
      ],
    }).compile();

    service = module.get(KycAdminService);
  });

  describe('getKycStepCounts', () => {
    function mockQueryBuilder(rows: { name: KycStepName; status: ReviewStatus; count: string }[]): {
      select: jest.Mock;
      addSelect: jest.Mock;
      where: jest.Mock;
      groupBy: jest.Mock;
      addGroupBy: jest.Mock;
      andWhere: jest.Mock;
      getRawMany: jest.Mock;
    } {
      const query = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      kycStepRepo.createQueryBuilder.mockReturnValue(query as never);
      return query;
    }

    it('returns an empty array and skips querying when names is empty', async () => {
      const result = await service.getKycStepCounts([]);

      expect(result).toEqual([]);
      expect(kycStepRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('maps raw rows and coerces count to number, without date filters', async () => {
      const query = mockQueryBuilder([
        { name: KycStepName.IDENT, status: ReviewStatus.COMPLETED, count: '5' },
        { name: KycStepName.IDENT, status: ReviewStatus.IN_PROGRESS, count: '2' },
      ]);

      const result = await service.getKycStepCounts([KycStepName.IDENT]);

      expect(result).toEqual([
        { name: KycStepName.IDENT, status: ReviewStatus.COMPLETED, count: 5 },
        { name: KycStepName.IDENT, status: ReviewStatus.IN_PROGRESS, count: 2 },
      ]);
      expect(query.where).toHaveBeenCalledWith('kycStep.name IN (:...names)', { names: [KycStepName.IDENT] });
      expect(query.andWhere).not.toHaveBeenCalled();
    });

    it('applies from and to date filters when provided', async () => {
      const query = mockQueryBuilder([]);
      const from = new Date('2024-01-01');
      const to = new Date('2024-02-01');

      const result = await service.getKycStepCounts([KycStepName.CONTACT_DATA], from, to);

      expect(result).toEqual([]);
      expect(query.andWhere).toHaveBeenCalledWith('kycStep.created >= :from', { from });
      expect(query.andWhere).toHaveBeenCalledWith('kycStep.created <= :to', { to });
    });
  });
});
