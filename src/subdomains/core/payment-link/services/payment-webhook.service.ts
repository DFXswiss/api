import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkDtoMapper } from '../dto/payment-link-dto.mapper';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';

@Injectable()
export class PaymentWebhookService {
  private readonly logger = new DfxLogger(PaymentWebhookService);

  private readonly webhookSendQueue: QueueHandler;

  constructor(
    private readonly http: HttpService,
    private readonly paymentLinkRepo: PaymentLinkRepository,
  ) {
    this.webhookSendQueue = QueueHandler.createParallelQueueHandler(10);
  }

  async sendWebhook(paymentLink: PaymentLink): Promise<void> {
    this.webhookSendQueue
      .handle<void>(async () => this.doSendWebhook(paymentLink))
      .catch((e) => {
        this.logger.error(`Exception during webhook for payment link ${paymentLink.uniqueId}:`, e);
      });
  }

  private async doSendWebhook(paymentLink: PaymentLink) {
    if (!paymentLink.webhookUrl) return;

    // half-open during cooldown: every event still gets a single attempt (no retry storm), so a
    // recovered endpoint resumes immediately instead of dropping notifications for the rest of the window
    const isProbe = paymentLink.isWebhookInCooldown;

    const dto = PaymentLinkDtoMapper.toLinkDto(paymentLink);
    const payload = JSON.stringify(dto);
    const signature = this.createSignature(payload);

    try {
      await this.http.post(dto.webhookUrl, dto, {
        retryDelay: 5000,
        tryCount: isProbe ? 1 : 12,
        headers: {
          'X-Payload-Signature': signature,
          'Content-Type': 'application/json',
        },
      });

      await this.onSendSuccess(paymentLink);
    } catch (e) {
      await this.onSendFailure(paymentLink);
      throw e;
    }
  }

  private async onSendSuccess(paymentLink: PaymentLink): Promise<void> {
    if (!paymentLink.webhookFailCount) return;

    await this.paymentLinkRepo.update(...paymentLink.webhookSucceeded());
  }

  private async onSendFailure(paymentLink: PaymentLink): Promise<void> {
    const [id, update] = paymentLink.webhookFailed();

    // atomic increment: parallel events for the same link must not collapse N failures into one;
    // quoted explicitly so the fragment does not depend on TypeORM's property-name-to-column rewriting
    await this.paymentLinkRepo.update(id, { ...update, webhookFailCount: () => '"webhookFailCount" + 1' });
  }

  private createSignature(payload: string): string {
    const privateKey = Config.payment.webhookPrivateKey;
    if (!privateKey) {
      throw new Error('Webhook private key is not configured');
    }

    const payloadHash = Util.createHash(payload);
    return Util.createSign(payloadHash, privateKey);
  }
}
