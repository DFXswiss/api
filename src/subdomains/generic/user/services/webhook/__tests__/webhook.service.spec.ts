import { ConfigService } from 'src/config/config';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { UserData } from '../../../models/user-data/user-data.entity';
import { KycLevel, KycStatus } from '../../../models/user-data/user-data.enum';
import { User } from '../../../models/user/user.entity';
import { UserRepository } from '../../../models/user/user.repository';
import { Wallet, WebhookConfigOption } from '../../../models/wallet/wallet.entity';
import { WalletService } from '../../../models/wallet/wallet.service';
import { WebhookNotificationService } from '../webhook-notification.service';
import { Webhook } from '../webhook.entity';
import { WebhookRepository } from '../webhook.repository';
import { WebhookService } from '../webhook.service';

describe('WebhookService', () => {
  let service: WebhookService;

  let webhookRepo: jest.Mocked<Partial<WebhookRepository>>;
  let webhookNotificationService: jest.Mocked<Partial<WebhookNotificationService>>;

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    webhookRepo = {
      existsBy: jest.fn().mockResolvedValue(false),
      create: jest.fn(),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    };
    webhookNotificationService = { triggerWebhook: jest.fn().mockResolvedValue(undefined) };

    service = new WebhookService(
      webhookRepo as unknown as WebhookRepository,
      {} as unknown as UserRepository,
      webhookNotificationService as unknown as WebhookNotificationService,
      {} as unknown as WalletService,
    );
  });

  // circular entity graph as produced by KycService.updateProgress: a freshly initiated step
  // (KycStep.create sets step.userData = user) is pushed into user.kycSteps before kycChanged fires
  const buildCircularUserData = (): UserData => {
    const wallet = Object.assign(new Wallet(), {
      id: 5,
      name: 'partner-wallet',
      apiUrl: 'https://partner.example.com/webhook',
      webhookConfig: JSON.stringify({ kyc: WebhookConfigOption.TRUE, payment: WebhookConfigOption.FALSE }),
    });

    const userData = Object.assign(new UserData(), {
      id: 1,
      mail: 'synthetic@example.com',
      kycStatus: KycStatus.NA,
      kycLevel: KycLevel.LEVEL_10,
      kycHash: 'synthetic-hash',
    });

    const user = Object.assign(new User(), { id: 2, address: 'ADDR_01', wallet, userData });
    const kycStep = Object.assign(new KycStep(), { name: KycStepName.CONTACT_DATA, sequenceNumber: 0, userData });

    userData.users = [user];
    userData.kycSteps = [kycStep];

    return userData;
  };

  describe('kycChanged', () => {
    it('sends and persists a webhook for a circular userData graph', async () => {
      const userData = buildCircularUserData();
      expect(userData.kycSteps[0].userData).toBe(userData);
      expect(userData.users[0].userData).toBe(userData);

      await expect(service.kycChanged(userData)).resolves.not.toThrow();

      expect(webhookNotificationService.triggerWebhook).toHaveBeenCalledTimes(1);
      expect(webhookRepo.save).toHaveBeenCalledTimes(1);

      const entity = webhookRepo.save.mock.calls[0][0] as Webhook;
      expect(entity).toBeInstanceOf(Webhook);
      expect(entity.userData).toBe(userData);
      expect(entity.user).toBe(userData.users[0]);
      expect(entity.wallet).toBe(userData.users[0].wallet);
      expect(entity.isComplete).toBe(true);
    });

    it('does not run the entity graph through repo.create (no cycle guard in the TypeORM transformer)', async () => {
      const userData = buildCircularUserData();

      await service.kycChanged(userData);

      expect(webhookRepo.create).not.toHaveBeenCalled();
    });
  });
});
