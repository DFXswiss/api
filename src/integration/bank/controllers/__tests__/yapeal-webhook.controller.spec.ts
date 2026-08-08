import { ForbiddenException } from '@nestjs/common';
import { Config, ConfigService } from 'src/config/config';
import { YapealWebhookService } from '../../services/yapeal-webhook.service';
import { YapealWebhookController } from '../yapeal-webhook.controller';

describe('YapealWebhookController', () => {
  let controller: YapealWebhookController;
  let yapealWebhookService: jest.Mocked<Partial<YapealWebhookService>>;

  const setExpectedKey = (key: string | undefined): void => {
    (Config.bank.yapeal as { webhookApiKey?: string }).webhookApiKey = key;
  };

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    yapealWebhookService = { processWebhook: jest.fn() };
    controller = new YapealWebhookController(yapealWebhookService as unknown as YapealWebhookService);
  });

  it('processes the webhook when the api key matches', async () => {
    setExpectedKey('secret');

    await expect(controller.handleYapealWebhook('secret', { foo: 'bar' })).resolves.toEqual({ received: true });
    expect(yapealWebhookService.processWebhook).toHaveBeenCalledWith({ foo: 'bar' });
  });

  it('rejects a wrong api key', async () => {
    setExpectedKey('secret');

    await expect(controller.handleYapealWebhook('wrong', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(yapealWebhookService.processWebhook).not.toHaveBeenCalled();
  });

  it('fails closed: rejects every request when no expected key is configured', async () => {
    setExpectedKey(undefined);

    await expect(controller.handleYapealWebhook('anything', {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.handleYapealWebhook(undefined, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(yapealWebhookService.processWebhook).not.toHaveBeenCalled();
  });
});
