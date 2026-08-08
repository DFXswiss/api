import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { FiatRepublicWebhookService } from '../../services/fiat-republic-webhook.service';
import { FiatRepublicService } from '../../services/fiat-republic.service';
import { FiatRepublicWebhookController } from '../fiat-republic-webhook.controller';

const BODY = JSON.stringify({ id: 'evt_synthetic', event: 'PAYMENT.STATUS_UPDATED', data: { id: 'pmt_synthetic' } });

function req(body: unknown = Buffer.from(BODY, 'utf8')): Request {
  return { body } as Request;
}

describe('FiatRepublicWebhookController', () => {
  let controller: FiatRepublicWebhookController;
  let fiatRepublicService: DeepMocked<FiatRepublicService>;
  let webhookService: DeepMocked<FiatRepublicWebhookService>;

  beforeEach(async () => {
    fiatRepublicService = createMock<FiatRepublicService>();
    webhookService = createMock<FiatRepublicWebhookService>();

    jest.spyOn(fiatRepublicService, 'isWebhookEnabled').mockReturnValue(true);
    jest.spyOn(webhookService, 'isValidSignature').mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatRepublicWebhookController,
        { provide: FiatRepublicService, useValue: fiatRepublicService },
        { provide: FiatRepublicWebhookService, useValue: webhookService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<FiatRepublicWebhookController>(FiatRepublicWebhookController);
  });

  afterEach(() => jest.restoreAllMocks());

  const call = (request = req()) =>
    controller.handleFiatRepublicWebhook('digest-value', 'fr1=("digest");created=1', 'fr1=:sig:', request);

  it('accepts a correctly signed delivery and forwards it', async () => {
    await expect(call()).resolves.toEqual({ received: true });
    expect(webhookService.processWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'evt_synthetic', event: 'PAYMENT.STATUS_UPDATED' }),
    );
  });

  it('passes the raw body and all three signature headers to the verifier', async () => {
    const body = Buffer.from(BODY, 'utf8');

    await call(req(body));

    expect(webhookService.isValidSignature).toHaveBeenCalledWith(body, {
      digest: 'digest-value',
      signatureInput: 'fr1=("digest");created=1',
      signature: 'fr1=:sig:',
    });
  });

  it('rejects everything while the rail is not released, before any parsing', async () => {
    jest.spyOn(fiatRepublicService, 'isWebhookEnabled').mockReturnValue(false);

    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(webhookService.isValidSignature).not.toHaveBeenCalled();
    expect(webhookService.processWebhook).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    jest.spyOn(webhookService, 'isValidSignature').mockReturnValue(false);

    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(webhookService.processWebhook).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty buffer', Buffer.alloc(0)],
    ['an empty string', ''],
    ['no body at all', undefined],
  ])('rejects %s without checking the signature', async (_name, body) => {
    await expect(call({ body } as Request)).rejects.toBeInstanceOf(BadRequestException);
    expect(webhookService.isValidSignature).not.toHaveBeenCalled();
  });

  it('rejects a signed but unparseable body', async () => {
    await expect(call(req(Buffer.from('{not json', 'utf8')))).rejects.toBeInstanceOf(BadRequestException);
    expect(webhookService.processWebhook).not.toHaveBeenCalled();
  });

  it('accepts a string body as well as a buffer', async () => {
    await expect(call(req(BODY))).resolves.toEqual({ received: true });
  });
});
