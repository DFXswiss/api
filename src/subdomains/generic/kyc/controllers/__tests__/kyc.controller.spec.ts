import { createMock } from '@golevelup/ts-jest';
import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { Config, Environment } from 'src/config/config';
import { SumsubService } from '../../services/integration/sum-sub.service';
import { KycService } from '../../services/kyc.service';
import { TfaService } from '../../services/tfa.service';
import { KycController } from '../kyc.controller';

jest.mock('src/config/config', () => {
  const actual = jest.requireActual('src/config/config');
  return { ...actual, Config: { ...actual.GetConfig(), environment: undefined } };
});

describe('KycController.sumsubWebhook', () => {
  let controller: KycController;
  let kycService: KycService;

  const webhookBody = (sandboxMode: boolean): string =>
    JSON.stringify({ applicantId: 'a1', externalUserId: 'tx', sandboxMode });

  beforeEach(() => {
    kycService = createMock<KycService>();
    const tfaService = createMock<TfaService>();
    controller = new KycController(kycService, tfaService);
    jest.spyOn(SumsubService, 'checkWebhook').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (Config as { environment?: Environment }).environment = undefined;
  });

  it('rejects a sandbox webhook on production and never touches the ident step', async () => {
    (Config as { environment?: Environment }).environment = Environment.PRD;
    const data = webhookBody(true);
    const req = createMock<Request>();

    await expect(controller.sumsubWebhook(req, data)).rejects.toThrow(ForbiddenException);
    expect(kycService.updateSumsubIdent).not.toHaveBeenCalled();
  });

  it('forwards a production webhook on production', async () => {
    (Config as { environment?: Environment }).environment = Environment.PRD;
    const data = webhookBody(false);
    const req = createMock<Request>();

    await expect(controller.sumsubWebhook(req, data)).resolves.toBeUndefined();
    expect(kycService.updateSumsubIdent).toHaveBeenCalledWith(JSON.parse(data));
  });

  it('forwards a sandbox webhook on dev', async () => {
    (Config as { environment?: Environment }).environment = Environment.DEV;
    const data = webhookBody(true);
    const req = createMock<Request>();

    await expect(controller.sumsubWebhook(req, data)).resolves.toBeUndefined();
    expect(kycService.updateSumsubIdent).toHaveBeenCalledWith(JSON.parse(data));
  });

  it('rejects a webhook with an invalid signature', async () => {
    jest.spyOn(SumsubService, 'checkWebhook').mockReturnValue(false);
    const data = webhookBody(false);
    const req = createMock<Request>();

    await expect(controller.sumsubWebhook(req, data)).rejects.toThrow(ForbiddenException);
    expect(kycService.updateSumsubIdent).not.toHaveBeenCalled();
  });
});
