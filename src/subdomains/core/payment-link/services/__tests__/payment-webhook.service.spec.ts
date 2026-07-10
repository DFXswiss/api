import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import * as ConfigModule from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkDtoMapper } from '../../dto/payment-link-dto.mapper';
import { PaymentLink } from '../../entities/payment-link.entity';
import { PaymentLinkRepository } from '../../repositories/payment-link.repository';
import { PaymentWebhookService } from '../payment-webhook.service';

const WEBHOOK_URL = 'https://merchant.example.com/hook';

function createPaymentLinkMock(overrides: Partial<PaymentLink> = {}): PaymentLink {
  const link = new PaymentLink();
  link.id = 1;
  link.uniqueId = 'pl_test';
  link.webhookUrl = WEBHOOK_URL;
  link.webhookFailCount = 0;
  link.webhookLastFailedAt = undefined;

  return Object.assign(link, overrides);
}

describe('PaymentWebhookService', () => {
  let service: PaymentWebhookService;
  let httpService: jest.Mocked<HttpService>;
  let paymentLinkRepo: jest.Mocked<PaymentLinkRepository>;

  beforeAll(() => {
    (ConfigModule as Record<string, unknown>).Config = {
      payment: { webhookPrivateKey: 'test-key', webhookFailureThreshold: 3, webhookFailureCooldown: 3600 },
    };
    jest.spyOn(Util, 'createSign').mockReturnValue('mock-signature');
    jest
      .spyOn(PaymentLinkDtoMapper, 'toLinkDto')
      .mockImplementation((link: PaymentLink) => ({ webhookUrl: link.webhookUrl }) as never);
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(async () => {
    httpService = createMock<HttpService>();
    paymentLinkRepo = createMock<PaymentLinkRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentWebhookService,
        { provide: HttpService, useValue: httpService },
        { provide: PaymentLinkRepository, useValue: paymentLinkRepo },
      ],
    }).compile();

    service = module.get<PaymentWebhookService>(PaymentWebhookService);
  });

  it('sends on every event while under the failure threshold', async () => {
    const link = createPaymentLinkMock({ webhookFailCount: 2 });

    await service['doSendWebhook'](link);

    expect(httpService.post).toHaveBeenCalledTimes(1);
  });

  it('skips sending once the threshold is reached and the cooldown has not elapsed', async () => {
    const link = createPaymentLinkMock({ webhookFailCount: 3, webhookLastFailedAt: new Date() });

    await service['doSendWebhook'](link);

    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('attempts again once the cooldown has elapsed', async () => {
    const link = createPaymentLinkMock({
      webhookFailCount: 3,
      webhookLastFailedAt: Util.secondsBefore(ConfigModule.Config.payment.webhookFailureCooldown + 60),
    });

    await service['doSendWebhook'](link);

    expect(httpService.post).toHaveBeenCalledTimes(1);
  });

  it('resets the failure counter on a successful send', async () => {
    httpService.post.mockResolvedValueOnce(undefined);
    const link = createPaymentLinkMock({ webhookFailCount: 2, webhookLastFailedAt: new Date() });

    await service['doSendWebhook'](link);

    expect(link.webhookFailCount).toBe(0);
    expect(link.webhookLastFailedAt).toBeNull();
    expect(paymentLinkRepo.update).toHaveBeenCalledWith(link.id, { webhookFailCount: 0, webhookLastFailedAt: null });
  });

  it('does not touch the repo on success when the counter is already 0', async () => {
    httpService.post.mockResolvedValueOnce(undefined);
    const link = createPaymentLinkMock({ webhookFailCount: 0 });

    await service['doSendWebhook'](link);

    expect(paymentLinkRepo.update).not.toHaveBeenCalled();
  });

  it('increments the failure counter and rethrows on a failed send', async () => {
    httpService.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED 0.0.0.0:9999'));
    const link = createPaymentLinkMock({ webhookFailCount: 0 });

    await expect(service['doSendWebhook'](link)).rejects.toThrow('ECONNREFUSED');

    expect(link.webhookFailCount).toBe(1);
    expect(paymentLinkRepo.update).toHaveBeenCalledWith(link.id, {
      webhookFailCount: 1,
      webhookLastFailedAt: expect.any(Date),
    });
  });

  it('does not send when no webhookUrl is set', async () => {
    const link = createPaymentLinkMock({ webhookUrl: undefined });

    await service['doSendWebhook'](link);

    expect(httpService.post).not.toHaveBeenCalled();
  });
});
