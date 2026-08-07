import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { RefRewardDexService } from '../services/ref-reward-dex.service';
import { RefRewardJobService } from '../services/ref-reward-job.service';
import { RefRewardNotificationService } from '../services/ref-reward-notification.service';
import { RefRewardOutService } from '../services/ref-reward-out.service';
import { RefRewardService } from '../services/ref-reward.service';

describe('RefRewardJobService', () => {
  let service: RefRewardJobService;
  let refRewardNotificationService: RefRewardNotificationService;
  let refRewardDexService: RefRewardDexService;
  let refRewardOutService: RefRewardOutService;
  let refRewardService: RefRewardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefRewardJobService,
        { provide: RefRewardNotificationService, useValue: createMock<RefRewardNotificationService>() },
        { provide: RefRewardDexService, useValue: createMock<RefRewardDexService>() },
        { provide: RefRewardOutService, useValue: createMock<RefRewardOutService>() },
        { provide: RefRewardService, useValue: createMock<RefRewardService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get(RefRewardJobService);
    refRewardNotificationService = module.get(RefRewardNotificationService);
    refRewardDexService = module.get(RefRewardDexService);
    refRewardOutService = module.get(RefRewardOutService);
    refRewardService = module.get(RefRewardService);
  });

  it('createPendingRefRewards should call refRewardService.createPendingRefRewards once', async () => {
    await service.createPendingRefRewards();

    expect(refRewardService.createPendingRefRewards).toHaveBeenCalledTimes(1);
  });

  it('createRefBonusRewards should call refRewardService.createRefBonusRewards once', async () => {
    await service.createRefBonusRewards();

    expect(refRewardService.createRefBonusRewards).toHaveBeenCalledTimes(1);
  });

  it('processPendingRefRewards should call all four services in order', async () => {
    await service.processPendingRefRewards();

    expect(refRewardDexService.secureLiquidity).toHaveBeenCalledTimes(1);
    expect(refRewardOutService.checkPaidTransaction).toHaveBeenCalledTimes(1);
    expect(refRewardOutService.payoutNewTransactions).toHaveBeenCalledTimes(1);
    expect(refRewardNotificationService.sendNotificationMails).toHaveBeenCalledTimes(1);

    const secureOrder = (refRewardDexService.secureLiquidity as jest.Mock).mock.invocationCallOrder[0];
    const checkPaidOrder = (refRewardOutService.checkPaidTransaction as jest.Mock).mock.invocationCallOrder[0];
    const payoutOrder = (refRewardOutService.payoutNewTransactions as jest.Mock).mock.invocationCallOrder[0];
    const notifyOrder = (refRewardNotificationService.sendNotificationMails as jest.Mock).mock.invocationCallOrder[0];

    expect(secureOrder).toBeLessThan(checkPaidOrder);
    expect(checkPaidOrder).toBeLessThan(payoutOrder);
    expect(payoutOrder).toBeLessThan(notifyOrder);
  });
});
