import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { KycStepRepository } from '../../repositories/kyc-step.repository';
import { KycAdminService } from '../kyc-admin.service';
import { KycNotificationService } from '../kyc-notification.service';
import { KycService } from '../kyc.service';
import { NameCheckService } from '../name-check.service';

describe('KycAdminService', () => {
  let service: KycAdminService;
  let kycStepRepo: jest.Mocked<Partial<KycStepRepository>>;

  beforeEach(() => {
    kycStepRepo = { update: jest.fn() };

    service = new KycAdminService(
      kycStepRepo as unknown as KycStepRepository,
      {} as unknown as WebhookService,
      {} as unknown as KycService,
      {} as unknown as KycNotificationService,
      {} as unknown as UserDataService,
      {} as unknown as NameCheckService,
    );
  });

  describe('reassignKycSteps', () => {
    it('re-parents all steps from the source userData to the target userData', async () => {
      await service.reassignKycSteps(2, 1);

      expect(kycStepRepo.update).toHaveBeenCalledWith({ userData: { id: 2 } }, { userData: { id: 1 } });
    });
  });
});
